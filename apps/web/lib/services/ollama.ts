// HaS 脱敏内核：正则兜底（格式固定 PII）+ HaS NER（语义 PII）+ 确定性替换。
// 相比"让模型重写全文"，本方案只做定位、替换在代码里完成，因此永不丢内容，
// 且通过全局映射（占位符↔原值）保证跨块/跨页同一实体拿到同一占位符。

// 占位符 → 原值。跨块传递以维持一致性，并支持断点续传后恢复。
export type DesensMapping = Record<string, string>

export interface DesensResult {
  masked: string
  mapping: DesensMapping
}

// 需要语义理解、交给 HaS NER 的类型（银行账号格式松散，也交给模型）
const NER_TYPES = ['人名', '组织', '地址', '银行账号', '金额']

// 永不脱敏：法域/地区等公共名词，模型偶尔会误标成"组织/地址"，脱敏它们会破坏法律条款语义
const NEVER_MASK = new Set([
  '中华人民共和国', '中国',
  '香港特别行政区', '澳门特别行政区', '台湾地区',
  '香港', '澳门', '台湾',
])

// ── 正则兜底层：格式固定、高置信的 PII，强制命中并锁定类型 ──
function regexEntities(text: string): Array<{ type: string; value: string }> {
  const out: Array<{ type: string; value: string }> = []
  const collect = (type: string, re: RegExp, validate?: (s: string) => boolean) => {
    for (const m of text.matchAll(re)) {
      if (!validate || validate(m[0])) out.push({ type, value: m[0] })
    }
  }
  collect('邮箱', /[\w.\-]+@[\w.\-]+\.[A-Za-z]{2,}/g)
  collect('身份证号', /(?<!\d)\d{17}[\dXx](?!\d)/g)
  // 统一社会信用代码：第 3-8 位为行政区划数字，作为强判别，避免误伤任意 18 位串
  collect('统一社会信用代码', /(?<![0-9A-Za-z])[0-9A-Z]{2}\d{6}[0-9A-Z]{10}(?![0-9A-Za-z])/g)
  // 手机号：11 位。1[3-9]\d 已占 3 位，其余 8 位允许组间空格/连字符（扫描件常见）
  collect('电话', /(?<!\d)1[3-9]\d(?:[ \-]?\d){8}(?!\d)/g, s => s.replace(/\D/g, '').length === 11)
  // 座机：区号 + 分隔 + 7~8 位，允许内部空格（如 "021-3915 1110"）
  collect('电话', /(?<!\d)0\d{2,3}(?:[ \-]?\d){7,8}(?!\d)/g, s => {
    const n = s.replace(/\D/g, '').length
    return n >= 10 && n <= 12
  })
  return out
}

// ── HaS NER 调用（一轮）：输出落在 message.thinking 字段，须兜底读取 ──
async function callHasNer(text: string): Promise<Record<string, string[]>> {
  const prompt =
    `Recognize the following entity types in the text.\n` +
    `Specified types:${JSON.stringify(NER_TYPES)}\n` +
    `<text>${text}</text>`

  const res = await fetch(process.env.OLLAMA_API_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_DESENS_MODEL,
      stream: false,
      options: { temperature: 0, num_predict: 2048 }, // 防实体密集块 JSON 被截断
      messages: [{ role: 'user', content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) throw new Error('HaS error: ' + res.status)
  const data = await res.json()
  const raw: string = data.message?.content || data.message?.thinking || ''
  return parseNer(raw)
}

function parseNer(raw: string): Record<string, string[]> {
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start < 0 || end <= start) throw new Error('NER 输出非 JSON')
  const obj = JSON.parse(raw.slice(start, end + 1))
  const out: Record<string, string[]> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) out[k] = v.filter((x): x is string => typeof x === 'string' && x.length > 0)
  }
  return out
}

async function callHasNerWithRetry(text: string): Promise<Record<string, string[]>> {
  const delays = [2000, 4000, 8000]
  for (let attempt = 0; attempt <= 3; attempt++) {
    try {
      return await callHasNer(text)
    } catch (err: any) {
      console.warn('[HaS] NER 失败, attempt:', attempt, 'error:', err.message)
      if (attempt < 3) await new Promise(r => setTimeout(r, delays[attempt]))
      else throw err
    }
  }
  return {}
}

// ── 单块脱敏：合并正则 + NER 实体，长实体优先做确定性替换 ──
export async function desensitizeChunk(text: string, mapping: DesensMapping = {}): Promise<DesensResult> {
  // 从既有 mapping 重建反查表与各类型计数器，保证跨块编号连续、同实体复用
  const value2tag: Record<string, string> = {}
  const counters: Record<string, number> = {}
  for (const [tag, val] of Object.entries(mapping)) {
    value2tag[val] = tag
    const m = tag.match(/^\[(.+?)(\d+)\]$/)
    if (m) counters[m[1]] = Math.max(counters[m[1]] ?? 0, Number(m[2]))
  }

  // 收集实体：正则（格式固定）+ HaS NER（语义）。NER 整块失败则仅正则脱敏（内容仍无损）
  const entities = regexEntities(text)
  let nerOut: Record<string, string[]> = {}
  try {
    nerOut = await callHasNerWithRetry(text)
  } catch (err: any) {
    console.warn('[HaS] 本块 NER 最终失败，仅正则脱敏:', err.message)
  }
  for (const type of NER_TYPES) {
    for (const v of nerOut[type] ?? []) entities.push({ type, value: v })
  }

  // 去重 + 长实体优先（避免短实体是长实体子串导致的替换冲突）
  const seen = new Set<string>()
  const uniq = entities
    .filter(e => e.value && !NEVER_MASK.has(e.value) && !seen.has(e.value) && seen.add(e.value))
    .sort((a, b) => b.value.length - a.value.length)

  let masked = text
  for (const { type, value } of uniq) {
    if (!masked.includes(value)) continue
    let tag = value2tag[value]
    if (!tag) {
      counters[type] = (counters[type] ?? 0) + 1
      tag = `[${type}${counters[type]}]`
      mapping[tag] = value
      value2tag[value] = tag
    }
    masked = masked.split(value).join(tag)
  }

  console.log('[HaS] 块脱敏完成, 原文:', text.length, '实体:', uniq.length, '累计映射:', Object.keys(mapping).length)
  return { masked, mapping }
}

// Ollama 脱敏调用：重试 + 输出校验 + 兜底返回原文

const SYSTEM_PROMPT = [
  '你是一个合同脱敏助手。将输入文本中的以下信息替换为占位符，其余内容完全保持原样不做任何修改：',
  '- 公司名称（包括全称、简称、品牌名、缩写、部分字） → [公司名]',
  '  例如："北京华夏科技有限公司" → [公司名]，"华夏科技" → [公司名]，"莱珀妮" → [公司名]，"LPG" → [公司名]',
  '  注意：合同中反复出现的公司简称、品牌名（如"莱珀妮"、"LPG"等）也必须替换为[公司名]',
  '- 自然人姓名 → [姓名]',
  '- 身份证号 → [证件号]',
  '- 银行账号 → [账号]',
  '- 具体金额数字 → [金额]',
  '- 手机/电话号码 → [电话]',
  '- 详细地址 → [地址]',
  '- 邮箱地址 → [邮箱]',
  '重要：只输出脱敏后的文本，不要添加任何前缀、后缀或解释。',
].join('\n')

async function callOllama(text: string): Promise<string> {
  const baseUrl = process.env.OLLAMA_API_URL
  const model = process.env.OLLAMA_DESENS_MODEL
  if (!baseUrl || !model) {
    throw new Error('Ollama 未配置（OLLAMA_API_URL / OLLAMA_DESENS_MODEL）')
  }
  const endpoint = `${baseUrl.replace(/\/+$/, '')}/api/chat`
  let res: Response
  try {
    res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        stream: false,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: text },
        ],
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (err: any) {
    throw new Error(`Ollama 请求失败: ${endpoint} (${err?.message ?? 'unknown error'})`)
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error(`Ollama error ${res.status}: ${errText.slice(0, 300)}`)
  }
  const data = await res.json()
  return data.message?.content ?? ''
}

function cleanOutput(output: string): string {
  let text = output.trim()
  const prefixes = [
    '好的，以下是脱敏后的文本：',
    '好的，以下是脱敏结果：',
    '脱敏后的文本如下：',
    '以下是脱敏后的文本：',
    '以下是脱敏结果：',
  ]
  for (const p of prefixes) {
    if (text.startsWith(p)) text = text.slice(p.length).trim()
  }
  return text
}

// 校验：输出不能比原文短太多（脱敏只是替换，不会大幅缩短）
function isValidOutput(original: string, desensitized: string): boolean {
  if (desensitized.length === 0) return false
  if (desensitized.length < original.length * 0.3) return false
  return true
}

export async function desensitizeChunk(text: string): Promise<string> {
  const maxRetries = 3
  const delays = [2000, 4000, 8000]

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const raw = await callOllama(text)
      const cleaned = cleanOutput(raw)
      if (cleaned.length > 0 && isValidOutput(text, cleaned)) {
        console.log('[Ollama] OK, 原文:', text.length, '脱敏:', cleaned.length)
        return cleaned
      }
      console.warn('[Ollama] 输出异常, attempt:', attempt, '原文:', text.length, '输出:', cleaned.length)
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delays[attempt]))
    } catch (err: any) {
      console.warn('[Ollama] 请求失败, attempt:', attempt, 'error:', err.message)
      if (attempt < maxRetries) await new Promise(r => setTimeout(r, delays[attempt]))
      else throw err
    }
  }

  console.warn('[Ollama] 所有重试失败, 返回原文')
  return text
}

// Ollama 脱敏调用：重试 + 输出校验 + 兜底返回原文

const SYSTEM_PROMPT = [
  '你是一个合同脱敏助手。将输入文本中的以下信息替换为占位符，其余内容完全保持原样不做任何修改：',
  '- 公司名称 → [公司名]',
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
  const res = await fetch(process.env.OLLAMA_API_URL + '/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_DESENS_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: text },
      ],
    }),
    signal: AbortSignal.timeout(120_000),
  })

  if (!res.ok) throw new Error('Ollama error: ' + res.status)
  const data = await res.json()
  return data.message?.content ?? ''
}

function cleanOutput(output: string): string {
  let text = output.trim()
  // 去掉模型可能添加的前缀
  const prefixes = [
    '好的，以下是脱敏后的文本：',
    '好的，以下是脱敏结果：',
    '脱敏后的文本如下：',
    '以下是脱敏后的文本：',
    '以下是脱敏结果：',
  ]
  for (const p of prefixes) {
    if (text.startsWith(p)) {
      text = text.slice(p.length).trim()
    }
  }
  // 去掉末尾可能的解释
  if (text.endsWith('。') && text.length > 200) {
    // 保留，中文文本正常以句号结尾
  }
  return text
}

// 校验：输出不能比原文短太多（模型可能返回截断或错误）
function isValidOutput(original: string, desensitized: string): boolean {
  if (desensitized.length === 0) return false
  // 脱敏后文本不应比原文短过 30%（脱敏只是替换，不会大幅缩短）
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

      // 输出异常，重试
      console.warn('[Ollama] 输出异常, attempt:', attempt, '原文:', text.length, '输出:', cleaned.length)
      if (attempt < maxRetries) {
        console.log('[Ollama] 等待', delays[attempt] + 'ms 后重试...')
        await new Promise(resolve => setTimeout(resolve, delays[attempt]))
      }
    } catch (err: any) {
      console.warn('[Ollama] 请求失败, attempt:', attempt, 'error:', err.message)
      if (attempt < maxRetries) {
        console.log('[Ollama] 等待', delays[attempt] + 'ms 后重试...')
        await new Promise(resolve => setTimeout(resolve, delays[attempt]))
      } else {
        throw err
      }
    }
  }

  // 所有重试都失败，返回原文兜底（宁可不脱敏，不能丢内容）
  console.warn('[Ollama] 所有重试失败, 返回原文')
  return text
}

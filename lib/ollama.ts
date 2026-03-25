// 调用 Ollama 脱敏，单块文本
export async function desensitizeChunk(text: string): Promise<string> {
  const res = await fetch(`${process.env.OLLAMA_API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_DESENS_MODEL,
      stream: false,
      messages: [
        {
          role: 'system',
          content: `你是一个合同脱敏助手。将输入文本中的以下信息替换为占位符，其余内容完全保持原样不做任何修改：
- 公司名称 → [公司名]
- 自然人姓名 → [姓名]
- 身份证号 → [证件号]
- 银行账号 → [账号]
- 具体金额数字 → [金额]
- 手机/电话号码 → [电话]
- 详细地址 → [地址]
- 邮箱地址 → [邮箱]
只输出脱敏后的文本，不要任何解释。`
        },
        { role: 'user', content: text }
      ]
    }),
    // 单块超时30秒，防止模型卡死
    signal: AbortSignal.timeout(30_000)
  })

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`)
  const data = await res.json()
  return data.message?.content ?? text
}

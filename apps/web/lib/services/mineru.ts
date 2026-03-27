// 调用 MinerU 解析 PDF，返回纯文本
// PDF 合同页数多时 MinerU 可能需要几分钟，设 10 分钟超时
export async function parsePdfWithMinerU(pdfBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append('files', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }), filename)

  console.log('[MinerU] 开始解析:', filename)

  const res = await fetch(process.env.MINERU_API_URL + '/file_parse', {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(600_000), // 10 分钟
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    throw new Error('MinerU error ' + res.status + ': ' + errText.slice(0, 300))
  }

  const text = await res.text()
  console.log('[MinerU] 响应长度:', text.length)

  if (!text || text.trim().length === 0) {
    throw new Error('MinerU 返回为空')
  }

  // MinerU 返回格式可能是 JSON 编码的字符串 "xxx"，或嵌套对象
  try {
    const parsed = JSON.parse(text)
    if (typeof parsed === 'string') return parsed
    return parsed.text ?? parsed.result ?? parsed.content ?? JSON.stringify(parsed)
  } catch {
    return text
  }
}

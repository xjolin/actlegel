// 调用本地 MinerU 解析 PDF，返回纯文本
export async function parsePdfWithMinerU(pdfBuffer: Buffer, filename: string): Promise<string> {
  const formData = new FormData()
  formData.append('file', new Blob([new Uint8Array(pdfBuffer)], { type: 'application/pdf' }), filename)

  const res = await fetch(`${process.env.MINERU_API_URL}/api/v1/extract`, {
    method: 'POST',
    body: formData,
    signal: AbortSignal.timeout(120_000) // PDF解析最多等2分钟
  })

  if (!res.ok) throw new Error(`MinerU error: ${res.status}`)
  const data = await res.json()
  // 根据你实际 MinerU 返回结构调整这里
  return data.result?.text ?? data.text ?? ''
}

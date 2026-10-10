// 调用 MinerU 解析文档（PDF/Word），返回 Markdown 文本
// 适配 MinerU 新版异步任务 API（POST /v1/uploads → PUT content → complete → POST /v1/parse/jobs → 轮询 → GET /v1/files/{id}/content）
// 合同页数多时 MinerU 可能需要几分钟，设 10 分钟超时
export async function parseWithMinerU(buffer: Buffer, filename: string): Promise<string> {
  const safeFilename = toSafeMultipartFilename(filename)
  const ext = (filename || '').toLowerCase().match(/\.(\w+)$/)?.[1] || 'pdf'
  const mimeTypes: Record<string, string> = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  }
  const contentType = mimeTypes[ext] || 'application/pdf'

  console.log('[MinerU] 开始解析:', filename)

  const baseUrl = process.env.MINERU_API_URL
  if (!baseUrl) {
    throw new Error('MINERU_API_URL 未配置')
  }
  const api = baseUrl.replace(/\/+$/, '')

  // 1. 创建 upload
  const uploadRes = await fetch(`${api}/v1/uploads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: safeFilename,
      bytes: buffer.byteLength,
      mime_type: contentType,
      purpose: 'parse',
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!uploadRes.ok) {
    throw new Error(`MinerU 创建上传失败: ${uploadRes.status} ${await safeText(uploadRes)}`)
  }
  const upload = await uploadRes.json() as { id: string }
  const uploadId = upload.id
  console.log('[MinerU] upload 已创建:', uploadId)

  // 2. PUT 上传内容
  const putRes = await fetch(`${api}/v1/uploads/${uploadId}/content`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: new Uint8Array(buffer),
    signal: AbortSignal.timeout(300_000),
  })
  if (!putRes.ok) {
    throw new Error(`MinerU 上传内容失败: ${putRes.status} ${await safeText(putRes)}`)
  }

  // 3. complete → 拿到 file_id
  const completeRes = await fetch(`${api}/v1/uploads/${uploadId}/complete`, {
    method: 'POST',
    signal: AbortSignal.timeout(30_000),
  })
  if (!completeRes.ok) {
    throw new Error(`MinerU complete 失败: ${completeRes.status} ${await safeText(completeRes)}`)
  }
  const complete = await completeRes.json() as { file?: { id?: string } | null }
  const fileId = complete.file?.id
  if (!fileId) {
    throw new Error('MinerU complete 响应里没有 file.id')
  }
  console.log('[MinerU] file 已就绪:', fileId)

  // 4. 创建 parse job
  const jobRes = await fetch(`${api}/v1/parse/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      files: [{ source: { type: 'file_id', file_id: fileId } }],
      tier: 'flash',
      output_formats: ['markdown'],
    }),
    signal: AbortSignal.timeout(30_000),
  })
  if (!jobRes.ok) {
    throw new Error(`MinerU 创建解析任务失败: ${jobRes.status} ${await safeText(jobRes)}`)
  }
  const job = await jobRes.json() as { job_id: string }
  const jobId = job.job_id
  console.log('[MinerU] parse job 已创建:', jobId)

  // 5. 轮询直到完成（最多 10 分钟）
  const deadline = Date.now() + 600_000
  let jobStatus: JobAsyncResponse | null = null
  while (Date.now() < deadline) {
    await sleep(3000)
    const pollRes = await fetch(`${api}/v1/parse/jobs/${jobId}`, {
      signal: AbortSignal.timeout(30_000),
    })
    if (!pollRes.ok) {
      throw new Error(`MinerU 轮询失败: ${pollRes.status} ${await safeText(pollRes)}`)
    }
    jobStatus = (await pollRes.json()) as JobAsyncResponse
    console.log('[MinerU] job status:', jobStatus.status)
    if (jobStatus.status === 'completed' || jobStatus.status === 'partial') break
    if (jobStatus.status === 'failed' || jobStatus.status === 'canceled') {
      const errMsg = jobStatus.files?.[0]?.error?.message ?? jobStatus.status
      throw new Error(`MinerU 解析失败: ${errMsg}`)
    }
  }
  if (!jobStatus || (jobStatus.status !== 'completed' && jobStatus.status !== 'partial')) {
    throw new Error('MinerU 解析超时（10 分钟未完成）')
  }

  // 6. 拿 markdown 输出文件的 file_id
  const mdRef = jobStatus.files?.[0]?.output_files?.markdown
  const mdFileId = mdRef?.file_id
  if (!mdFileId) {
    throw new Error('MinerU 任务完成但未返回 markdown 输出文件')
  }

  // 7. 下载 markdown 内容
  const contentRes = await fetch(`${api}/v1/files/${mdFileId}/content`, {
    signal: AbortSignal.timeout(60_000),
  })
  if (!contentRes.ok) {
    throw new Error(`MinerU 下载 markdown 失败: ${contentRes.status} ${await safeText(contentRes)}`)
  }
  const text = await contentRes.text()
  console.log('[MinerU] 响应长度:', text.length)
  if (!text || text.trim().length === 0) {
    throw new Error('MinerU 返回为空')
  }
  return text
}

async function safeText(res: Response): Promise<string> {
  try { return (await res.text()).slice(0, 300) } catch { return '' }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

function toSafeMultipartFilename(filename: string) {
  const raw = (filename || '').trim()
  const hasKnownExt = /\.(pdf|docx?|PDF|DOCX?)$/i.test(raw)
  const base = raw.replace(/[\\/]/g, '_').replace(/\s+/g, ' ')
  const ascii = base.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/_+/g, '_').trim()
  const normalized = ascii.length > 0 ? ascii : 'contract'
  return hasKnownExt ? normalized : `${normalized}.pdf`
}

type JobAsyncResponse = {
  job_id: string
  status: 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'canceled'
  files?: Array<{
    file_id?: string | null
    name: string
    status: 'queued' | 'running' | 'completed' | 'failed'
    output_files?: {
      markdown?: { file_id: string; bytes: number } | null
    } | null
    error?: { type: string; message: string; code?: string | null } | null
  }>
}

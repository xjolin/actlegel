import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

// 代理 PDF 文件流，前端用 iframe 显示
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).end()

  const supabase = createServerClient()
  const { data: task } = await supabase
    .from('review_tasks')
    .select('pdf_storage_path')
    .eq('id', id)
    .single()

  if (!task || !task.pdf_storage_path) return res.status(404).end()

  const { data: fileData } = await supabase.storage
    .from('contracts')
    .download(task.pdf_storage_path)

  if (!fileData) return res.status(404).end()

  const buffer = Buffer.from(await fileData.arrayBuffer())
  res.setHeader('Content-Type', 'application/pdf')
  res.setHeader('Content-Length', buffer.length)
  res.setHeader('Content-Disposition', 'inline')
  res.send(buffer)
}

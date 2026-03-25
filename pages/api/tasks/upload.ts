import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import { createServerClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: false } }

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const form = formidable({ maxFileSize: 50 * 1024 * 1024 }) // 50MB上限
  const [, files] = await form.parse(req)
  const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf
  if (!file) return res.status(400).json({ error: '没有收到文件' })

  const supabase = createServerClient()
  const buffer = fs.readFileSync(file.filepath)
  const storagePath = `contracts/${Date.now()}_${file.originalFilename}`

  // 上传到 Supabase Storage
  const { error: storageError } = await supabase.storage
    .from('contracts')
    .upload(storagePath, buffer, { contentType: 'application/pdf' })

  if (storageError) return res.status(500).json({ error: storageError.message })

  // 创建任务记录，状态 pending
  const { data: task, error: dbError } = await supabase
    .from('review_tasks')
    .insert({
      filename: file.originalFilename,
      pdf_storage_path: storagePath,
      status: 'pending'
    })
    .select()
    .single()

  if (dbError) return res.status(500).json({ error: dbError.message })

  res.status(200).json({ taskId: task.id })
}

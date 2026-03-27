import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import { createServerClient } from '@/lib/supabase/server'
import { enqueueTask } from '@/lib/pipeline'

export const config = {
  api: {
    bodyParser: false,
    // MinerU + Ollama + 分析大模型，整条流水线可能需要十几分钟
    externalResolver: true,
  },
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const form = formidable({
    maxFileSize: 50 * 1024 * 1024,
    // 确保正确解析中文文件名
    encoding: 'utf-8',
    // 保持原始文件名
    keepExtensions: true,
  })
  const [, files] = await form.parse(req)
  const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf
  if (!file) return res.status(400).json({ error: '没有收到文件' })

  const supabase = createServerClient()
  const buffer = fs.readFileSync(file.filepath)
  const safeName = encodeURIComponent(file.originalFilename || 'unnamed.pdf')
  const storagePath = `contracts/${Date.now()}_${safeName}`

  const { error: storageError } = await supabase.storage
    .from('contracts')
    .upload(storagePath, buffer, { contentType: 'application/pdf' })

  if (storageError) return res.status(500).json({ error: storageError.message })

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

  // 入队，串行处理（一次只处理一个任务）
  enqueueTask(task)

  res.status(200).json({ taskId: task.id })
}

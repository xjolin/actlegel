import type { NextApiRequest, NextApiResponse } from 'next'
import formidable from 'formidable'
import fs from 'fs'
import { randomUUID } from 'crypto'
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

  try {
    const form = formidable({
      maxFileSize: 50 * 1024 * 1024,
      // 确保正确解析中文文件名
      encoding: 'utf-8',
      // 保持原始文件名
      keepExtensions: true,
    })
    const [fields, files] = await form.parse(req)
    const file = Array.isArray(files.pdf) ? files.pdf[0] : files.pdf
    if (!file) return res.status(400).json({ error: '没有收到文件' })

    const partyRoleValue = Array.isArray(fields.partyRole) ? fields.partyRole[0] : fields.partyRole
    const userRoleValue = Array.isArray(fields.userRole) ? fields.userRole[0] : fields.userRole
    const partyRole = (partyRoleValue || userRoleValue || '').toString()
    if (!['party_a', 'party_b'].includes(partyRole)) {
      return res.status(400).json({ error: '请先选择甲方或乙方' })
    }

    // 根据文件扩展名确定 MIME 类型和存储扩展名
    const ext = (file.originalFilename || '').toLowerCase().match(/\.(\w+)$/)?.[1] || 'pdf'
    const mimeTypes: Record<string, string> = {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }
    const contentType = mimeTypes[ext] || 'application/pdf'

    const supabase = createServerClient()
    const buffer = fs.readFileSync(file.filepath)
    const storagePath = `contracts/${Date.now()}_${randomUUID()}.${ext}`
    const { error: storageError } = await supabase.storage
      .from('contracts')
      .upload(storagePath, buffer, { contentType })

    if (storageError) return res.status(500).json({ error: storageError.message })

    const { data: task, error: dbError } = await supabase
      .from('review_tasks')
      .insert({
        filename: file.originalFilename,
        pdf_storage_path: storagePath,
        status: 'pending',
        party_role: partyRole,
      })
      .select()
      .single()

    if (dbError) return res.status(500).json({ error: dbError.message })

    // 入队（串行处理，内部会去重）
    enqueueTask(task)

    res.status(200).json({ taskId: task.id })
  } catch (err: any) {
    res.status(500).json({ error: err.message })
  }
}

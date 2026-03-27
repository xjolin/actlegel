import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).end()
  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).end()

  const supabase = createServerClient()

  // 查任务获取 storage 路径
  const { data: task } = await supabase
    .from('review_tasks')
    .select('pdf_storage_path')
    .eq('id', id)
    .single()

  // 删除数据库记录（analysis_items、chat_messages 会级联删除）
  const { error } = await supabase.from('review_tasks').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  // 删除 Storage 中的 PDF 文件
  if (task?.pdf_storage_path) {
    await supabase.storage.from('contracts').remove([task.pdf_storage_path]).catch(() => {})
  }

  res.status(200).json({ ok: true })
}

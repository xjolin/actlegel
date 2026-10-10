import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'DELETE') return res.status(405).end()

  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).end()

  const supabase = createServerClient()

  const { data: task } = await supabase
    .from('review_tasks')
    .select('pdf_storage_path')
    .eq('id', id)
    .single()

  const { error } = await supabase.from('review_tasks').delete().eq('id', id)
  if (error) return res.status(500).json({ error: error.message })

  if (task?.pdf_storage_path) {
    await supabase.storage.from('contracts').remove([task.pdf_storage_path]).catch(() => {})
  }

  res.status(200).json({ ok: true })
}

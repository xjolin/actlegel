import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  const supabase = createServerClient()

  const { data: task, error } = await supabase
    .from('review_tasks')
    .select('*, analysis_items(*)')
    .eq('id', id)
    .single()

  if (error) return res.status(404).json({ error: '任务不存在' })
  res.status(200).json(task)
}

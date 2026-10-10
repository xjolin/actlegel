import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import { enqueueTask } from '@/lib/pipeline'

/**
 * pg_cron 每 15 秒调用（或手动 POST 触发），从 DB 拉取待处理任务入队。
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const supabase = createServerClient()
    const { data: pending, error } = await supabase
      .from('review_tasks')
      .select('*')
      .in('status', ['pending', 'parsing_failed', 'desens_failed', 'analyze_failed'])
      .order('created_at')
      .limit(8)

    if (error) return res.status(500).json({ error: error.message })

    for (const task of pending ?? []) {
      enqueueTask(task)
    }

    return res.status(200).json({ count: pending?.length ?? 0 })
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? 'dispatch failed' })
  }
}

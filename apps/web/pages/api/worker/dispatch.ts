import type { NextApiRequest, NextApiResponse } from 'next'
import { enqueueTask } from '@/lib/pipeline'

// pg_cron 或手动触发时，拉取 pending 任务入队
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()

  const WORKER_SECRET = process.env.WORKER_SECRET || 'dev-secret'
  if (req.headers['x-worker-secret'] !== WORKER_SECRET) {
    return res.status(401).end()
  }

  const { createServerClient } = require('@/lib/supabase/server')
  const supabase = createServerClient()

  // 拉所有待处理任务，按创建时间排序
  const { data: tasks } = await supabase
    .from('review_tasks')
    .select('*')
    .in('status', ['pending', 'parsing_failed', 'desens_failed', 'analyze_failed'])
    .order('created_at')

  if (!tasks || tasks.length === 0) {
    return res.status(200).json({ message: '没有待处理任务' })
  }

  // 全部入队（队列会自动串行处理）
  for (const task of tasks) {
    enqueueTask(task)
  }

  res.status(200).json({ enqueued: tasks.length })
}

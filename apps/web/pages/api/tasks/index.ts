import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).end()

  try {
    const supabase = createServerClient()
    const { data, error } = await supabase
      .from('review_tasks')
      .select('id, filename, party_role, status, desens_cursor, desens_total, created_at, updated_at')
      .order('created_at', { ascending: false })

    if (error) return res.status(500).json({ error: error.message })
    res.status(200).json(data)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    if (!res.headersSent) res.status(500).json({ error: message })
  }
}

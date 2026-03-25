import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).end()
  const { id } = req.query
  const { message, history } = req.body
  const supabase = createServerClient()

  const { data: task } = await supabase
    .from('review_tasks')
    .select('desensitized_text')
    .eq('id', id)
    .single()

  if (!task?.desensitized_text) {
    return res.status(400).json({ error: '脱敏文本尚未就绪' })
  }

  // 保存用户消息
  await supabase.from('chat_messages').insert({
    task_id: id, role: 'user', content: message
  })

  // 流式返回（SSE 格式）
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')

  // TODO: 换成你的实际分析模型，这里用 Ollama 示例
  const upstream = await fetch(`${process.env.OLLAMA_API_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OLLAMA_DESENS_MODEL,
      stream: true,
      messages: [
        {
          role: 'system',
          content: `你是合同法务助理。以下是经过脱敏的合同全文：\n<contract>\n${task.desensitized_text}\n</contract>\n请基于合同内容回答问题。`
        },
        ...(history ?? []),
        { role: 'user', content: message }
      ]
    })
  })

  let fullReply = ''
  const reader = upstream.body!.getReader()
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const lines = decoder.decode(value).split('\n').filter(Boolean)
    for (const line of lines) {
      try {
        const json = JSON.parse(line)
        const token = json.message?.content ?? ''
        if (token) {
          fullReply += token
          res.write(`data: ${JSON.stringify({ token })}\n\n`)
        }
      } catch {}
    }
  }

  // 保存完整回复
  await supabase.from('chat_messages').insert({
    task_id: id, role: 'assistant', content: fullReply
  })

  res.write('data: [DONE]\n\n')
  res.end()
}

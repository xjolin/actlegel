import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatMessage } from '@/lib/types'
import ChatMessageBubble from './ChatMessage'

export default function ChatPanel({ taskId, enabled }: { taskId: string; enabled: boolean }) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const send = useCallback(async () => {
    const text = input.trim()
    if (!text || streaming) return

    const userMsg: ChatMessage = { role: 'user', content: text }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setStreaming(true)

    // 添加一个占位助手消息
    const assistantMsg: ChatMessage = { role: 'assistant', content: '' }
    setMessages(prev => [...prev, assistantMsg])

    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }))
      const res = await fetch(`/api/tasks/${taskId}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, history }),
      })

      if (!res.ok || !res.body) throw new Error('请求失败')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let fullText = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') continue
          try {
            const parsed = JSON.parse(data)
            if (parsed.token) {
              fullText += parsed.token
              setMessages(prev => {
                const updated = [...prev]
                updated[updated.length - 1] = { role: 'assistant', content: fullText }
                return updated
              })
            }
          } catch {}
        }
      }
    } catch {
      setMessages(prev => {
        const updated = [...prev]
        updated[updated.length - 1] = { role: 'assistant', content: '请求失败，请重试' }
        return updated
      })
    } finally {
      setStreaming(false)
    }
  }, [input, streaming, messages, taskId])

  if (!enabled) {
    return (
      <div className="flex flex-col h-full">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">合同问答</h2>
        <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
          分析完成后即可开始对话
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">合同问答</h2>
      <div className="flex-1 overflow-y-auto space-y-3 mb-4 min-h-0">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 text-sm py-8">针对合同内容提问</div>
        )}
        {messages.map((msg, i) => (
          <ChatMessageBubble key={i} role={msg.role} content={msg.content} />
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          placeholder="输入问题..."
          rows={1}
          disabled={streaming}
          className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-light focus:border-transparent disabled:opacity-50"
        />
        <button
          onClick={send}
          disabled={streaming || !input.trim()}
          className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {streaming ? '...' : '发送'}
        </button>
      </div>
    </div>
  )
}

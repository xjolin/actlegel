import { useState } from 'react'
import type { TaskSummary } from '@/lib/types'
import StatusBadge from './StatusBadge'
import ProgressBar from './ProgressBar'

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000)
  if (seconds < 60) return '刚刚'
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时前`
  return `${Math.floor(seconds / 86400)} 天前`
}

export default function TaskCard({
  task,
  onClick,
  onDeleted,
}: {
  task: TaskSummary
  onClick: () => void
  onDeleted: (id: string) => void
}) {
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    if (deleting) return
    setDeleting(true)
    try {
      const res = await fetch('/api/tasks/' + task.id + '/delete', { method: 'DELETE' })
      if (res.ok) onDeleted(task.id)
    } catch {}
    setDeleting(false)
  }

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md cursor-pointer transition-shadow group relative"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-medium text-gray-900 truncate" title={task.filename}>
          {task.filename}
        </p>
        <div className="flex items-center gap-2">
          <StatusBadge status={task.status} />
          <button
            onClick={handleDelete}
            disabled={deleting}
            className="opacity-0 group-hover:opacity-100 transition-opacity p-1 text-gray-400 hover:text-red-500 disabled:opacity-50"
            title="删除"
          >
            {deleting ? (
              <div className="w-4 h-4 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin" />
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            )}
          </button>
        </div>
      </div>
      {(task.status === 'desensitizing') && (
        <ProgressBar cursor={task.desens_cursor} total={task.desens_total} />
      )}
      <p className="text-xs text-gray-400 mt-2">{timeAgo(task.updated_at)}</p>
    </div>
  )
}

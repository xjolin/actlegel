import type { TaskStatus } from '@/lib/types'

const STATUS_MAP: Record<TaskStatus, { label: string; classes: string }> = {
  pending:        { label: '等待中',   classes: 'bg-gray-100 text-gray-700' },
  parsing:        { label: '解析中',   classes: 'bg-blue-100 text-blue-700 animate-pulse' },
  desensitizing:  { label: '脱敏中',   classes: 'bg-blue-100 text-blue-700 animate-pulse' },
  analyzing:      { label: '分析中',   classes: 'bg-purple-100 text-purple-700 animate-pulse' },
  done:           { label: '已完成',   classes: 'bg-green-100 text-green-700' },
  parsing_failed: { label: '解析失败', classes: 'bg-red-100 text-red-700' },
  desens_failed:  { label: '脱敏失败', classes: 'bg-red-100 text-red-700' },
  analyze_failed: { label: '分析失败', classes: 'bg-red-100 text-red-700' },
  failed:         { label: '失败',     classes: 'bg-red-100 text-red-700' },
}

export default function StatusBadge({ status }: { status: TaskStatus }) {
  const { label, classes } = STATUS_MAP[status] ?? STATUS_MAP.failed
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${classes}`}>
      {label}
    </span>
  )
}

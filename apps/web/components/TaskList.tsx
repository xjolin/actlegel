import { useEffect } from 'react'
import { supabase } from '@/lib/supabase/client'
import type { TaskSummary } from '@/lib/types'
import TaskCard from './TaskCard'

export default function TaskList({
  tasks,
  setTasks,
  onSelect,
  onDeleted,
}: {
  tasks: TaskSummary[]
  setTasks: React.Dispatch<React.SetStateAction<TaskSummary[]>>
  onSelect: (id: string) => void
  onDeleted?: (id: string) => void
}) {
  useEffect(() => {
    const channel = supabase
      .channel('tasks-list')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'review_tasks' },
        (payload: any) => {
          if (payload.eventType === 'INSERT') {
            setTasks(prev => [payload.new as TaskSummary, ...prev])
          } else if (payload.eventType === 'UPDATE') {
            setTasks(prev =>
              prev.map(t =>
                t.id === payload.new.id ? { ...t, ...payload.new } : t
              )
            )
          } else if (payload.eventType === 'DELETE') {
            setTasks(prev => prev.filter(t => t.id !== payload.old.id))
          }
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [setTasks])

  if (tasks.length === 0) {
    return (
      <div className="text-center py-20 text-gray-400">
        <svg className="w-12 h-12 mx-auto mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p>暂无审查任务，请上传合同文件</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {tasks.map(task => (
        <TaskCard key={task.id} task={task} onClick={() => onSelect(task.id)} onDeleted={onDeleted ?? (() => {})} />
      ))}
    </div>
  )
}

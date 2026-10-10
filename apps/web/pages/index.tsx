import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import type { TaskSummary } from '@/lib/types'
import Layout from '@/components/Layout'
import UploadButton from '@/components/UploadButton'
import TaskList from '@/components/TaskList'

export default function Home() {
  const router = useRouter()
  const [tasks, setTasks] = useState<TaskSummary[]>([])

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const res = await fetch('/api/tasks')
        if (!res.ok) {
          if (!cancelled) setTasks([])
          return
        }
        const data: unknown = await res.json()
        if (!cancelled) setTasks(Array.isArray(data) ? (data as TaskSummary[]) : [])
      } catch {
        if (!cancelled) setTasks([])
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col gap-4 mb-6 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl font-bold text-gray-900">合同审查任务</h1>
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/usage-history"
              className="inline-flex items-center justify-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
            >
              使用记录
            </Link>
            <UploadButton onSuccess={(taskId) => router.push(`/tasks/${taskId}`)} />
          </div>
        </div>
        <TaskList
          tasks={tasks}
          setTasks={setTasks}
          onSelect={(id) => router.push(`/tasks/${id}`)}
          onDeleted={(id) => setTasks(prev => prev.filter(t => t.id !== id))}
        />
      </div>
    </Layout>
  )
}

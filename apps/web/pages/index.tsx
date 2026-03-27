import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import type { TaskSummary } from '@/lib/types'
import Layout from '@/components/Layout'
import UploadButton from '@/components/UploadButton'
import TaskList from '@/components/TaskList'

export default function Home() {
  const router = useRouter()
  const [tasks, setTasks] = useState<TaskSummary[]>([])

  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.json())
      .then((data: TaskSummary[]) => setTasks(Array.isArray(data) ? data : []))
  }, [])

  return (
    <Layout>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold text-gray-900">合同审查任务</h1>
          <UploadButton onSuccess={(taskId) => router.push(`/tasks/${taskId}`)} />
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

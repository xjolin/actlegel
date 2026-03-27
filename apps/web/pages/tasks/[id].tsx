import { useState, useEffect } from 'react'
import { useRouter } from 'next/router'
import Link from 'next/link'
import { supabase } from '@/lib/supabase/client'
import type { TaskDetail, AnalysisItem } from '@/lib/types'
import Layout from '@/components/Layout'
import StatusBadge from '@/components/StatusBadge'
import ProgressBar from '@/components/ProgressBar'
import AnalysisPanel from '@/components/AnalysisPanel'
import ChatDrawer from '@/components/ChatDrawer'

export default function TaskDetail() {
  const router = useRouter()
  const { id } = router.query
  const [task, setTask] = useState<TaskDetail | null>(null)
  const [items, setItems] = useState<AnalysisItem[]>([])
  const [chatOpen, setChatOpen] = useState(false)

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    fetch('/api/tasks/' + id)
      .then(r => r.json())
      .then((data: TaskDetail) => {
        setTask(data)
        setItems(data.analysis_items ?? [])
      })
  }, [id])

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    const ch = supabase
      .channel('task-' + id)
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'review_tasks',
        filter: 'id=eq.' + id,
      }, (payload: any) => {
        setTask(prev => prev ? { ...prev, ...payload.new } : null)
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  useEffect(() => {
    if (!id || typeof id !== 'string') return
    const ch = supabase
      .channel('analysis-' + id)
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'analysis_items',
        filter: 'task_id=eq.' + id,
      }, (payload: any) => {
        setItems(prev => [...prev, payload.new as AnalysisItem])
      })
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [id])

  if (!task) {
    return (
      <Layout showHeader={false}>
        <div className="flex items-center justify-center h-64 text-gray-400">加载中...</div>
      </Layout>
    )
  }

  const isProcessing = ['pending', 'parsing', 'desensitizing', 'analyzing'].includes(task.status)
  const isFailed = ['parsing_failed', 'desens_failed', 'analyze_failed', 'failed'].includes(task.status)
  const isDone = task.status === 'done'

  return (
    <Layout showHeader={false}>
      <div className="h-screen flex flex-col">
        {/* 顶栏 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <Link href="/" className="text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-base font-semibold text-gray-900 truncate">{task.filename}</h1>
            <StatusBadge status={task.status} />
          </div>

          {/* 问答按钮 */}
          <button
            onClick={() => setChatOpen(true)}
            disabled={!isDone}
            className="flex items-center gap-2 px-4 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            <span className="text-sm text-gray-700">合同问答</span>
          </button>
        </div>

        {/* 进度条 */}
        {isProcessing && (
          <div className="mx-6 mt-4 bg-blue-50 border border-blue-100 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <div className="w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-gray-700">
                {task.status === 'pending' && '等待处理...'}
                {task.status === 'parsing' && '正在解析 PDF 文档...'}
                {task.status === 'desensitizing' && '正在脱敏处理...'}
                {task.status === 'analyzing' && '正在 AI 分析合同风险...'}
              </p>
              {task.status === 'desensitizing' && (
                <span className="text-sm text-gray-500 ml-auto">
                  {task.desens_cursor} / {task.desens_total}
                </span>
              )}
            </div>
            {task.status === 'desensitizing' && (
              <div className="mt-2">
                <ProgressBar cursor={task.desens_cursor} total={task.desens_total} />
              </div>
            )}
          </div>
        )}

        {/* 错误 */}
        {isFailed && (
          <div className="mx-6 mt-4 bg-red-50 border border-red-200 rounded-lg p-3">
            <p className="text-sm text-red-700">
              <span className="font-medium">处理失败：</span>{task.error_message || '未知错误'}
            </p>
          </div>
        )}

        {/* 主布局 */}
        <div className="flex-1 flex overflow-hidden p-6 gap-6">
          {/* 左栏：PDF 原文预览 */}
          <div className="w-[55%] flex-shrink-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">合同原文</h2>
            </div>
            <div className="flex-1">
              {id && typeof id === 'string' ? (
                <iframe
                  src={'/api/tasks/' + id + '/preview'}
                  className="w-full h-full border-0"
                  title="PDF 预览"
                />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-400 text-sm">
                  加载中...
                </div>
              )}
            </div>
          </div>

          {/* 右栏：分析结果 */}
          <div className="flex-1 min-w-0 flex flex-col bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
              <h2 className="text-sm font-semibold text-gray-700">分析结果</h2>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isDone ? (
                <AnalysisPanel items={items} />
              ) : !isFailed ? (
                <div className="h-full flex flex-col items-center justify-center text-gray-400">
                  <svg className="w-12 h-12 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
                  </svg>
                  <p className="text-sm">分析完成后将在此展示结果</p>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      {/* 问答抽屉 */}
      <ChatDrawer
        taskId={id as string}
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        enabled={isDone}
      />
    </Layout>
  )
}

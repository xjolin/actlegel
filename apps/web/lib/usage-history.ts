import { createServerClient } from '@/lib/supabase/server'
import type { TaskStatus, UsageHistoryData, WeeklyUsageCount } from '@/lib/types'

const FAILED_STATUSES: TaskStatus[] = [
  'parsing_failed',
  'desens_failed',
  'analyze_failed',
  'failed',
]

const FAILED_STATUS_SET = new Set<TaskStatus>(FAILED_STATUSES)
const DAY_MS = 24 * 60 * 60 * 1000
const CHINA_TZ_OFFSET_MS = 8 * 60 * 60 * 1000

type UsageTaskRecord = {
  filename: string | null
  status: TaskStatus
  created_at: string
}

function getShiftedDate(dateStr: string): Date {
  return new Date(new Date(dateStr).getTime() + CHINA_TZ_OFFSET_MS)
}

function formatShiftedDate(dateMs: number): string {
  const date = new Date(dateMs)
  const year = date.getUTCFullYear()
  const month = String(date.getUTCMonth() + 1).padStart(2, '0')
  const day = String(date.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function getWeekRange(dateStr: string) {
  const shiftedDate = getShiftedDate(dateStr)
  const dayOfWeek = shiftedDate.getUTCDay()
  const daysSinceMonday = (dayOfWeek + 6) % 7
  const shiftedMidnightMs = Date.UTC(
    shiftedDate.getUTCFullYear(),
    shiftedDate.getUTCMonth(),
    shiftedDate.getUTCDate(),
  )
  const weekStartMs = shiftedMidnightMs - daysSinceMonday * DAY_MS
  const weekEndMs = weekStartMs + 6 * DAY_MS
  const weekStart = formatShiftedDate(weekStartMs)
  const weekEnd = formatShiftedDate(weekEndMs)

  return {
    weekStart,
    weekEnd,
    label: `${weekStart} 至 ${weekEnd}`,
  }
}

function normalizeFilename(filename: string | null): string {
  return (filename ?? '').trim().toLocaleLowerCase('zh-CN')
}

export async function getUsageHistoryData(): Promise<UsageHistoryData> {
  const supabase = createServerClient()
  const { data, error } = await supabase
    .from('review_tasks')
    .select('filename, status, created_at')
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(`加载使用记录失败: ${error.message}`)
  }

  const tasks = (data ?? []) as UsageTaskRecord[]
  const errorFiles = new Set<string>()
  const weeklyUsageMap = new Map<string, WeeklyUsageCount>()

  for (const task of tasks) {
    const { weekStart, weekEnd, label } = getWeekRange(task.created_at)
    const existing = weeklyUsageMap.get(weekStart)

    if (existing) {
      existing.count += 1
    } else {
      weeklyUsageMap.set(weekStart, {
        weekStart,
        weekEnd,
        label,
        count: 1,
      })
    }

    if (FAILED_STATUS_SET.has(task.status)) {
      const normalized = normalizeFilename(task.filename)
      if (normalized) errorFiles.add(normalized)
    }
  }

  return {
    totalAnalysisCount: tasks.length,
    uniqueErrorFileCount: errorFiles.size,
    weeklyUsageCounts: Array.from(weeklyUsageMap.values()).sort((a, b) =>
      b.weekStart.localeCompare(a.weekStart),
    ),
  }
}

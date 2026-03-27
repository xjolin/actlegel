import { createServerClient } from '@/lib/supabase/server'
import { parsePdfWithMinerU } from '@/lib/services/mineru'
import { desensitizeChunk } from '@/lib/services/ollama'
import { analyzeContract } from '@/lib/services/analysis'
import { splitIntoChunks } from '@/lib/chunks'

// ── 全局串行队列 ──
let queueRunning = false
const taskQueue: any[] = []

export async function enqueueTask(task: any) {
  taskQueue.push(task)
  if (!queueRunning) {
    // 不等待队列处理完成，避免阻塞 upload 响应
    processQueue().catch(err => {
      console.error('[Queue] 处理异常:', err)
    })
  }
}

async function processQueue() {
  queueRunning = true
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!
    console.log('[Queue] 开始处理任务:', task.id, '剩余队列:', taskQueue.length)
    try {
      await runPipeline(task)
    } catch (err: any) {
      console.error('[Queue] 任务处理异常:', task.id, err.message)
    }
  }
  queueRunning = false
  console.log('[Queue] 队列清空')
}

async function runPipeline(task: any) {
  const supabase = createServerClient()
  const taskId = task.id

  try {
    // ── 僵尸任务检测：针对不同阶段设置不同的超时时间
    // 注意：desensitizing 阶段每块都会更新 updated_at，所以只有卡住才会超时
    const staleThresholds: Record<string, number> = {
      'parsing': 15 * 60 * 1000,        // 15 分钟（MinerU 有 10 分钟内部超时）
      'desensitizing': 10 * 60 * 1000,  // 10 分钟（每块有 120s 超时，10 分钟没更新说明某块卡住了）
      'analyzing': 20 * 60 * 1000,      // 20 分钟（分析有 3 分钟超时 + 3 次重试）
    }

    if (task.status in staleThresholds) {
      const lastUpdate = new Date(task.updated_at).getTime()
      const now = Date.now()
      const threshold = staleThresholds[task.status]!

      if (now - lastUpdate > threshold) {
        const staleMinutes = Math.round((now - lastUpdate) / 60000)
        console.warn(`[Pipeline] 检测到僵尸任务, 状态: ${task.status}, 已卡住 ${staleMinutes} 分钟`)

        const failedStatus = task.status === 'parsing' ? 'parsing_failed'
          : task.status === 'desensitizing' ? 'desens_failed'
          : 'analyze_failed'

        await supabase.from('review_tasks').update({
          status: failedStatus,
          error_message: `任务在 ${task.status} 阶段无响应超过 ${staleMinutes} 分钟`,
          retry_count: (task.retry_count ?? 0) + 1,
        }).eq('id', taskId)
        return // 不继续处理，等待下次重试
      }
    }

    // ── 阶段1：PDF 解析 ──
    if (task.status === 'pending' || task.status === 'parsing_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'parsing' }).eq('id', taskId)

      const { data: fileData } = await supabase.storage
        .from('contracts')
        .download(task.pdf_storage_path)

      if (!fileData) throw new Error('Storage 下载失败')
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const rawText = await parsePdfWithMinerU(buffer, task.filename)

      if (!rawText || rawText.trim().length === 0) {
        throw new Error('MinerU 解析结果为空')
      }

      console.log('[Pipeline] rawText length:', rawText.length)

      await supabase.from('review_tasks').update({
        raw_text: rawText,
        desens_total: splitIntoChunks(rawText).length,
        desens_cursor: 0,
        desens_chunks: [],
        status: 'desensitizing',
      }).eq('id', taskId)

      task = { ...task, raw_text: rawText, status: 'desensitizing', desens_cursor: 0, desens_chunks: [] }
    }

    // ── 阶段2：脱敏（分块 + 断点续传）──
    if (task.status === 'desensitizing' || task.status === 'desens_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'desensitizing' }).eq('id', taskId)

      const { data: latest } = await supabase
        .from('review_tasks').select('raw_text, desens_cursor, desens_chunks, desens_total')
        .eq('id', taskId).single()

      if (!latest?.raw_text) throw new Error('raw_text 为空，无法脱敏')

      const chunks = splitIntoChunks(latest.raw_text, 500)
      const completedChunks: string[] = (latest.desens_chunks as string[]) ?? []

      for (let i = latest.desens_cursor; i < chunks.length; i++) {
        console.log('[Pipeline] 脱敏块:', i + 1, '/', chunks.length)
        const result = await desensitizeChunk(chunks[i])
        completedChunks.push(result)

        await supabase.from('review_tasks').update({
          desens_chunks: completedChunks,
          desens_cursor: i + 1,
        }).eq('id', taskId)
      }

      const desensitizedText = completedChunks.join('')
      await supabase.from('review_tasks').update({
        desensitized_text: desensitizedText,
        status: 'analyzing',
      }).eq('id', taskId)

      task = { ...task, desensitized_text: desensitizedText, status: 'analyzing' }
    }

    // ── 阶段3：大模型分析 ──
    if (task.status === 'analyzing' || task.status === 'analyze_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'analyzing' }).eq('id', taskId)

      const { data: latest } = await supabase
        .from('review_tasks').select('desensitized_text')
        .eq('id', taskId).single()

      if (!latest?.desensitized_text) throw new Error('desensitized_text 为空，无法分析')

      const items = await analyzeContract(latest.desensitized_text)

      // 逐条插入，防止单条异常导致整批失败
      if (items.length > 0) {
        for (const item of items) {
          const { error } = await supabase.from('analysis_items').insert({
            ...item,
            task_id: taskId,
          })
          if (error) {
            console.warn('[Pipeline] 插入分析项失败:', item.item_index, error.message)
          }
        }
      }

      await supabase.from('review_tasks').update({
        status: 'done',
        analysis_result: items,
      }).eq('id', taskId)
    }

  } catch (err: any) {
    console.error('[Pipeline Error]', err.message)
    const current = (await supabase.from('review_tasks')
      .select('status').eq('id', taskId).single()).data?.status

    const failedStatus = current === 'parsing' ? 'parsing_failed'
      : current === 'desensitizing' ? 'desens_failed'
      : current === 'analyzing' ? 'analyze_failed'
      : 'failed'

    await supabase.from('review_tasks').update({
      status: failedStatus,
      error_message: err.message,
      retry_count: task.retry_count + 1,
    }).eq('id', taskId)
  }
}

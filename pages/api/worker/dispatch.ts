import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import { parsePdfWithMinerU } from '@/lib/mineru'
import { desensitizeChunk } from '@/lib/ollama'
import { analyzeContract } from '@/lib/analysis'
import { splitIntoChunks } from '@/lib/chunks'

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // 验证来源是 pg_cron，防止外部随意触发
  if (req.headers['x-worker-secret'] !== 'your-secret-key-here') {
    return res.status(401).end()
  }

  const supabase = createServerClient()

  // 捞一条待处理任务（for update skip locked 防并发重复领取）
  const { data: task } = await supabase
    .from('review_tasks')
    .select('*')
    .in('status', ['pending', 'parsing_failed', 'desens_failed', 'analyze_failed'])
    .order('created_at')
    .limit(1)
    .single()

  if (!task) return res.status(200).json({ message: '没有待处理任务' })

  // 立刻返回 200 给 pg_cron，实际处理异步进行（防止 pg_cron 超时报错）
  res.status(200).json({ taskId: task.id })

  // 异步执行流水线，不阻塞响应
  runPipeline(task).catch(console.error)
}

async function runPipeline(task: any) {
  const supabase = createServerClient()

  try {
    // ── 阶段1：PDF 解析 ──
    if (task.status === 'pending' || task.status === 'parsing_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'parsing' }).eq('id', task.id)

      // 从 Storage 下载 PDF
      const { data: fileData } = await supabase.storage
        .from('contracts')
        .download(task.pdf_storage_path)

      if (!fileData) throw new Error('Storage 下载失败')
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const rawText = await parsePdfWithMinerU(buffer, task.filename)

      // 写入原始文本，准备进入脱敏阶段
      await supabase.from('review_tasks').update({
        raw_text: rawText,
        desens_total: splitIntoChunks(rawText).length,
        desens_cursor: 0,
        desens_chunks: [],
        status: 'desensitizing'
      }).eq('id', task.id)

      task = { ...task, raw_text: rawText, status: 'desensitizing', desens_cursor: 0, desens_chunks: [] }
    }

    // ── 阶段2：脱敏（分块 + 断点续传）──
    if (task.status === 'desensitizing' || task.status === 'desens_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'desensitizing' }).eq('id', task.id)

      // 拿最新游标（可能是上次中断后的续传）
      const { data: latest } = await supabase
        .from('review_tasks').select('raw_text, desens_cursor, desens_chunks, desens_total')
        .eq('id', task.id).single()

      const chunks = splitIntoChunks(latest!.raw_text, 500)
      const completedChunks: string[] = latest!.desens_chunks as string[] ?? []

      for (let i = latest!.desens_cursor; i < chunks.length; i++) {
        const result = await desensitizeChunk(chunks[i])
        completedChunks.push(result)

        // 每块完成立即写库，中断后从这里续传
        await supabase.from('review_tasks').update({
          desens_chunks: completedChunks,
          desens_cursor: i + 1,
        }).eq('id', task.id)
      }

      // 全部完成，合并全文
      const desensitizedText = completedChunks.join('')
      await supabase.from('review_tasks').update({
        desensitized_text: desensitizedText,
        status: 'analyzing'
      }).eq('id', task.id)

      task = { ...task, desensitized_text: desensitizedText, status: 'analyzing' }
    }

    // ── 阶段3：大模型分析 ──
    if (task.status === 'analyzing' || task.status === 'analyze_failed') {
      await supabase.from('review_tasks')
        .update({ status: 'analyzing' }).eq('id', task.id)

      const { data: latest } = await supabase
        .from('review_tasks').select('desensitized_text')
        .eq('id', task.id).single()

      const items = await analyzeContract(latest!.desensitized_text)

      // 逐条写入 analysis_items 表（前端 Realtime 可以逐条收到）
      if (items.length > 0) {
        await supabase.from('analysis_items').insert(
          items.map(item => ({ ...item, task_id: task.id }))
        )
      }

      await supabase.from('review_tasks').update({
        status: 'done',
        analysis_result: items  // 同时冗余存一份在主表，查询方便
      }).eq('id', task.id)
    }

  } catch (err: any) {
    // 根据当前阶段记录对应的 failed 状态
    const current = (await supabase.from('review_tasks')
      .select('status').eq('id', task.id).single()).data?.status

    const failedStatus = current === 'parsing' ? 'parsing_failed'
      : current === 'desensitizing' ? 'desens_failed'
      : current === 'analyzing' ? 'analyze_failed'
      : 'failed'

    await supabase.from('review_tasks').update({
      status: failedStatus,
      error_message: err.message,
      retry_count: task.retry_count + 1
    }).eq('id', task.id)
  }
}

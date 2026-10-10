import { createServerClient } from '@/lib/supabase/server'
import { parseWithMinerU } from '@/lib/services/mineru'
import { desensitizeChunk } from '@/lib/services/ollama'
import { analyzeContract } from '@/lib/services/analysis'
import { splitIntoChunks } from '@/lib/chunks'
import { writeFileSync, mkdirSync, existsSync } from 'fs'
import { join, extname } from 'path'

// ── 后处理：正则替换 LLM 遗漏的公司名称 ──
function postProcessCompanyNames(rawText: string, desensitizedText: string): string {
  let result = desensitizedText

  // 1. 从原文提取公司名全称（含 公司/有限公司/集团/股份有限公司 等后缀）
  const companyPattern = /([A-Za-z\u4e00-\u9fa5·•&\s]{2,30}?)(?:（[^）]*）)?(?:有限公司|股份有限公司|集团有限公司|有限责任公司|集团|公司|（上海）有限公司|科技.*?有限公司)/g
  const fullNames = new Set<string>()
  let m: RegExpExecArray | null
  while ((m = companyPattern.exec(rawText)) !== null) {
    const name = m[0].trim()
    if (name.length >= 3) fullNames.add(name)
  }

  // 2. 从全称推导简称（取公司名前缀，去掉后缀部分）
  const shortNames = new Set<string>()
  for (const full of fullNames) {
    // 去掉括号及后缀，取核心名
    const core = full.replace(/（[^）]*）/g, '').replace(/(有限公司|股份有限公司|集团有限公司|有限责任公司|集团|公司)$/, '').trim()
    if (core.length >= 2) shortNames.add(core)

    // 如果有括号内的地域信息，也单独提取（如"莱珀妮"来自"莱珀妮科技(上海)有限公司"）
    const brandMatch = full.match(/^([A-Za-z\u4e00-\u9fa5·•&]{2,15}?)(?:科技|贸易|实业|投资|发展|控股|管理|服务|商贸|国际|实业)/)
    if (brandMatch) shortNames.add(brandMatch[1])
  }

  // 3. 按长度降序排列，先替换长名称避免短名称先匹配
  const allNames = [...fullNames, ...shortNames].sort((a, b) => b.length - a.length)

  for (const name of allNames) {
    // 跳过已经脱敏的占位符
    if (name === '[公司名]' || name.length < 2) continue
    // 转义正则特殊字符
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    // 替换所有出现的该名称（但不要替换已经在 [公司名] 占位符内的内容）
    const regex = new RegExp(`(?<!\\[公司名\\])${escaped}`, 'g')
    result = result.replace(regex, '[公司名]')
  }

  return result
}

// ── 本地串行队列（单进程内保证 once-per-task） ──
let queueRunning = false
const taskQueue: any[] = []

/** 将刚上传的新任务直接入队（上传者无需等 15s cron） */
export function enqueueTask(task: any) {
  if (!task?.id) return
  taskQueue.push(task)
  if (!queueRunning) {
    processQueue().catch(err => console.error('[Queue] 处理异常:', err))
  }
}

async function processQueue() {
  queueRunning = true
  while (taskQueue.length > 0) {
    const task = taskQueue.shift()!
    const id = task.id
    console.log('[Queue] 开始处理任务:', id, '剩余队列:', taskQueue.length)
    try {
      await runPipeline(task)
    } catch (err: any) {
      console.error('[Queue] 任务处理异常:', id, err.message)
    }
  }
  queueRunning = false
  console.log('[Queue] 队列清空')
}

/** 不同阶段的僵尸超时 */
const STALE_THRESHOLDS_MS: Record<string, number> = {
  parsing: 15 * 60 * 1000,
  desensitizing: 10 * 60 * 1000,
  analyzing: 40 * 60 * 1000,
}

async function runPipeline(task: any) {
  const supabase = createServerClient()
  const taskId: string = task.id

  try {
    // ── 僵尸任务检测：直接把状态翻到 *_failed，等待下次调度重试 ──
    if (task.status in STALE_THRESHOLDS_MS) {
      const lastUpdate = new Date(task.updated_at).getTime()
      const now = Date.now()
      const threshold = STALE_THRESHOLDS_MS[task.status]!
      if (now - lastUpdate > threshold) {
        const staleMin = Math.round((now - lastUpdate) / 60000)
        console.warn(`[Pipeline] 僵尸任务: ${task.status} 卡住 ${staleMin} 分钟`)
        const failedStatus =
          task.status === 'parsing' ? 'parsing_failed' :
          task.status === 'desensitizing' ? 'desens_failed' : 'analyze_failed'

        await supabase.from('review_tasks').update({
          status: failedStatus,
          error_message: `任务在 ${task.status} 阶段无响应超过 ${staleMin} 分钟`,
          retry_count: (task.retry_count ?? 0) + 1,
        }).eq('id', taskId)
        return
      }
    }

    // ── 阶段1：MinerU PDF 解析 ──
    if (task.status === 'pending' || task.status === 'parsing_failed') {
      await supabase.from('review_tasks').update({ status: 'parsing' }).eq('id', taskId)

      const { data: fileData } = await supabase.storage
        .from('contracts')
        .download(task.pdf_storage_path)

      if (!fileData) throw new Error('Storage 下载失败')
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const rawText = await parseWithMinerU(buffer, task.filename)
      if (!rawText || rawText.trim().length === 0) throw new Error('MinerU 解析结果为空')

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
      await supabase.from('review_tasks').update({ status: 'desensitizing' }).eq('id', taskId)

      const { data: latest } = await supabase
        .from('review_tasks')
        .select('raw_text, desens_cursor, desens_chunks, desens_total')
        .eq('id', taskId)
        .single()

      if (!latest?.raw_text) throw new Error('raw_text 为空，无法脱敏')
      const chunks = splitIntoChunks(latest.raw_text, 500)
      const completedChunks: string[] = (latest.desens_chunks as string[]) ?? []

      for (let i = latest.desens_cursor ?? 0; i < chunks.length; i++) {
        console.log('[Pipeline] 脱敏块:', i + 1, '/', chunks.length)
        const result = await desensitizeChunk(chunks[i])
        completedChunks.push(result)
        await supabase.from('review_tasks').update({
          desens_chunks: completedChunks,
          desens_cursor: i + 1,
        }).eq('id', taskId)
      }

      const desensitizedText = postProcessCompanyNames(latest.raw_text, completedChunks.join(''))

      // 将脱敏后的合同内容保存到 TEMP 目录
      const tempDir = join(process.cwd(), '..', '..', 'TEMP')
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
      const baseName = extname(task.filename || 'unknown')
        ? (task.filename || 'unknown').replace(/\.[^.]+$/, '')
        : (task.filename || 'unknown')
      const tempFile = join(tempDir, `${baseName}.txt`)
      try {
        writeFileSync(tempFile, desensitizedText, 'utf-8')
        console.log('[Pipeline] 脱敏文本已保存:', tempFile)
      } catch (e: any) {
        console.warn('[Pipeline] 保存脱敏文本失败:', e.message)
      }

      await supabase.from('review_tasks').update({
        desensitized_text: desensitizedText,
        status: 'analyzing',
      }).eq('id', taskId)
      task = { ...task, desensitized_text: desensitizedText, status: 'analyzing' }
    }

    // ── 阶段3：大模型分析 ──
    if (task.status === 'analyzing' || task.status === 'analyze_failed') {
      await supabase.from('review_tasks').update({ status: 'analyzing' }).eq('id', taskId)

      const { data: latest } = await supabase
        .from('review_tasks')
        .select('desensitized_text')
        .eq('id', taskId)
        .single()

      if (!latest?.desensitized_text) throw new Error('desensitized_text 为空，无法分析')

      const role = task.party_role === 'party_b' ? 'party_b' : 'party_a'
      const items = await analyzeContract(latest.desensitized_text, role)

      if (items.length > 0) {
        for (const item of items) {
          const { error } = await supabase.from('analysis_items').insert({
            ...item,
            task_id: taskId,
          })
          if (error) console.warn('[Pipeline] 插入 analysis_item 失败:', item.item_index, error.message)
        }
      }

      await supabase.from('review_tasks').update({
        status: 'done',
        analysis_result: items,
      }).eq('id', taskId)
    }
  } catch (err: any) {
    console.error('[Pipeline Error]', err.message)

    const failedStatus =
      task.status === 'parsing' ? 'parsing_failed' :
      task.status === 'desensitizing' ? 'desens_failed' :
      task.status === 'analyzing' ? 'analyze_failed' : 'failed'

    await supabase.from('review_tasks').update({
      status: failedStatus,
      error_message: err.message,
      retry_count: (task.retry_count ?? 0) + 1,
    }).eq('id', taskId)
  }
}

export interface AnalysisItem {
  item_index: number
  category: string
  severity: 'high' | 'medium' | 'low'
  description: string
  suggestion: string
  clause_ref: string
}

async function callAnalysisModel(desensitizedText: string): Promise<AnalysisItem[]> {
  const systemPrompt = [
    '你是资深合同法务顾问。分析合同中存在的法律风险和问题，严格以JSON格式返回，结构如下：',
    '{"items":[{"item_index":1,"category":"问题分类","severity":"high/medium/low","description":"问题描述","suggestion":"修改建议","clause_ref":"对应合同原文片段"}]}',
    '只返回JSON，不要包含markdown代码块标记，不要返回任何其他文字。',
  ].join('')

  const res = await fetch(process.env.ANALYSIS_API_URL!, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + process.env.ANALYSIS_API_KEY!,
    },
    body: JSON.stringify({
      model: process.env.ANALYSIS_MODEL,
      stream: false,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: '请分析以下合同：\n\n' + desensitizedText },
      ],
    }),
    signal: AbortSignal.timeout(180_000),
  })

  if (!res.ok) {
    const errBody = await res.text()
    throw new Error('Analysis model error ' + res.status + ': ' + errBody)
  }

  const data = await res.json()
  let content = data.choices?.[0]?.message?.content ?? '{}'

  // 清理可能出现的 markdown 标记
  content = content.replace(/^```json\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim()

  try {
    const parsed = JSON.parse(content)
    return parsed.items ?? []
  } catch {
    console.error('[Analysis] JSON parse failed, content:', content.slice(0, 200))
    throw new Error('大模型返回格式异常')
  }
}

export async function analyzeContract(desensitizedText: string): Promise<AnalysisItem[]> {
  if (!process.env.ANALYSIS_API_URL || !process.env.ANALYSIS_API_KEY || !process.env.ANALYSIS_MODEL) {
    throw new Error('分析大模型配置未完成')
  }

  const maxRetries = 3
  const delays = [3000, 5000, 10000] // 3s, 5s, 10s

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      console.log('[Analysis] 尝试分析, attempt:', attempt)
      const items = await callAnalysisModel(desensitizedText)
      console.log('[Analysis] 成功, 发现', items.length, '条风险')
      return items
    } catch (err: any) {
      console.warn('[Analysis] 失败, attempt:', attempt, 'error:', err.message)

      if (attempt < maxRetries) {
        console.log('[Analysis] 等待', delays[attempt] + 'ms 后重试...')
        await new Promise(resolve => setTimeout(resolve, delays[attempt]))
      } else {
        console.error('[Analysis] 所有重试失败')
        throw err
      }
    }
  }

  // 理论上不会到这里，但 TypeScript 需要 return
  throw new Error('分析失败')
}

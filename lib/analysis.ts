export interface AnalysisItem {
  item_index: number
  category: string
  severity: 'high' | 'medium' | 'low'
  description: string
  suggestion: string
  clause_ref: string
}

// 调用大模型分析合同，返回结构化问题列表
// 现在用占位，后面填入真实 API
export async function analyzeContract(desensitizedText: string): Promise<AnalysisItem[]> {
  if (!process.env.ANALYSIS_API_URL || !process.env.ANALYSIS_API_KEY || !process.env.ANALYSIS_MODEL) {
    throw new Error('分析大模型配置未完成，请检查 ANALYSIS_API_URL / ANALYSIS_API_KEY / ANALYSIS_MODEL')
  }

  // 通用 OpenAI 兼容格式，Claude/OpenAI/本地模型都支持
  const res = await fetch(`${process.env.ANALYSIS_API_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.ANALYSIS_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.ANALYSIS_MODEL,
      stream: false,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: `你是资深合同法务顾问。分析合同中存在的法律风险和问题，以JSON格式返回，结构如下：
{
  "items": [
    {
      "item_index": 1,
      "category": "问题分类（如：违约条款、付款条件、保密条款）",
      "severity": "high/medium/low",
      "description": "问题描述",
      "suggestion": "修改建议",
      "clause_ref": "对应合同原文片段"
    }
  ]
}
只返回JSON，不要任何其他文字。`
        },
        {
          role: 'user',
          content: `请分析以下合同：\n\n${desensitizedText}`
        }
      ]
    }),
    signal: AbortSignal.timeout(120_000)
  })

  if (!res.ok) throw new Error(`Analysis model error: ${res.status}`)
  const data = await res.json()
  const content = data.choices?.[0]?.message?.content ?? '{}'
  const parsed = JSON.parse(content)
  return parsed.items ?? []
}

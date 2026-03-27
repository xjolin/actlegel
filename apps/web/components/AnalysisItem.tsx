import type { AnalysisItem as AnalysisItemType } from '@/lib/types'

const SEVERITY_CONFIG = {
  high: {
    label: '高风险',
    bg: 'bg-red-50',
    border: 'border-red-200',
    text: 'text-red-700',
    dot: 'bg-red-500'
  },
  medium: {
    label: '中风险',
    bg: 'bg-yellow-50',
    border: 'border-yellow-200',
    text: 'text-yellow-700',
    dot: 'bg-yellow-500'
  },
  low: {
    label: '低风险',
    bg: 'bg-green-50',
    border: 'border-green-200',
    text: 'text-green-700',
    dot: 'bg-green-500'
  },
}

export default function AnalysisItem({ item }: { item: AnalysisItemType }) {
  const config = SEVERITY_CONFIG[item.severity] ?? SEVERITY_CONFIG.low

  return (
    <div className={`border ${config.border} rounded-xl overflow-hidden`}>
      {/* 标题栏 */}
      <div className={`flex items-center gap-3 px-4 py-3 ${config.bg} ${config.border} border-b`}>
        <span className={`w-2 h-2 rounded-full ${config.dot}`} />
        <span className={`text-xs font-semibold ${config.text}`}>{config.label}</span>
        <span className="text-sm font-medium text-gray-700">{item.category}</span>
      </div>

      {/* 内容区域 */}
      <div className="p-4 space-y-3">
        <p className="text-sm text-gray-800 leading-relaxed">{item.description}</p>

        {item.suggestion && (
          <div className="bg-blue-50 rounded-lg p-3">
            <p className="text-xs font-medium text-blue-700 mb-1.5 flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              修改建议
            </p>
            <p className="text-sm text-blue-800 leading-relaxed">{item.suggestion}</p>
          </div>
        )}

        {item.clause_ref && (
          <details className="group">
            <summary className="flex items-center gap-2 text-xs font-medium text-gray-500 cursor-pointer hover:text-gray-700 transition-colors select-none">
              <svg className="w-4 h-4 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              合同原文片段
            </summary>
            <div className="mt-2 bg-gray-50 rounded-lg p-3">
              <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap font-mono">
                {item.clause_ref}
              </p>
            </div>
          </details>
        )}
      </div>
    </div>
  )
}

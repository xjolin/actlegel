import type { AnalysisItem } from '@/lib/types'
import AnalysisItemCard from './AnalysisItem'

export default function AnalysisPanel({ items }: { items: AnalysisItem[] }) {
  const sorted = [...items].sort((a, b) => {
    const order = { high: 0, medium: 1, low: 2 }
    return (order[a.severity] ?? 2) - (order[b.severity] ?? 2) || a.item_index - b.item_index
  })

  if (sorted.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-6">
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <svg className="w-12 h-12 mx-auto mb-3 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-green-700 font-medium">未发现风险问题</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {sorted.length} 条风险</p>
        <div className="flex gap-4 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-red-500"></span>
            高 {sorted.filter(i => i.severity === 'high').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-yellow-500"></span>
            中 {sorted.filter(i => i.severity === 'medium').length}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-green-500"></span>
            低 {sorted.filter(i => i.severity === 'low').length}
          </span>
        </div>
      </div>
      <div className="space-y-3">
        {sorted.map(item => (
          <AnalysisItemCard key={item.item_index} item={item} />
        ))}
      </div>
    </div>
  )
}

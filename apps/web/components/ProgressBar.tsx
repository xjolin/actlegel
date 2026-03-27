export default function ProgressBar({ cursor, total }: { cursor: number; total: number }) {
  if (total <= 0) return null
  const pct = Math.round((cursor / total) * 100)
  return (
    <div className="mt-2">
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className="bg-blue-500 h-2 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p className="text-xs text-gray-500 mt-1">脱敏进度: {cursor}/{total} ({pct}%)</p>
    </div>
  )
}

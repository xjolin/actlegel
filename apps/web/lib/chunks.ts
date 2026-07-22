// 把长文本按字数分块，中文合同建议 500 字/块。
// 软切：在目标字数附近就近找自然边界（换行 > 句末标点 > 逗号/分号），
// 避免把公司名/地址等实体从中间切断导致脱敏漏识别。
// 保持"分块后顺序拼接 === 原文"的无损特性（下游用 join('') 合并）。
export function splitIntoChunks(text: string, size = 500): string[] {
  const chunks: string[] = []
  let i = 0
  while (i < text.length) {
    let end = Math.min(i + size, text.length)
    if (end < text.length) {
      // 在 [i+size*0.6, i+size] 窗口内就近找边界，尽量不切碎实体
      const windowStart = i + Math.floor(size * 0.6)
      const rel = lastBoundary(text.slice(windowStart, end))
      if (rel >= 0) end = windowStart + rel + 1
    }
    chunks.push(text.slice(i, end))
    i = end
  }
  return chunks
}

// 返回片段中最靠后的自然边界下标；优先硬边界（换行/句末），退而求其次软边界（逗号/分号）
function lastBoundary(s: string): number {
  const hard = Math.max(
    s.lastIndexOf('\n'), s.lastIndexOf('。'),
    s.lastIndexOf('！'), s.lastIndexOf('？'),
  )
  if (hard >= 0) return hard
  return Math.max(
    s.lastIndexOf('；'), s.lastIndexOf('，'),
    s.lastIndexOf(';'), s.lastIndexOf(','),
  )
}

// 把长文本按字数分块，中文合同建议500字/块
export function splitIntoChunks(text: string, size = 500): string[] {
  const chunks: string[] = []
  for (let i = 0; i < text.length; i += size) {
    chunks.push(text.slice(i, i + size))
  }
  return chunks
}

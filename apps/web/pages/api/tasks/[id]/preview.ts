import type { NextApiRequest, NextApiResponse } from 'next'
import { createServerClient } from '@/lib/supabase/server'
import { Readable } from 'stream'
import mammoth from 'mammoth'

export const config = {
  api: {
    responseLimit: false,
  },
}

// 代理文档预览：PDF 直接流式返回，Word 转 HTML 返回
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query
  if (!id || typeof id !== 'string') return res.status(400).end()

  const supabase = createServerClient()
  const { data: task } = await supabase
    .from('review_tasks')
    .select('pdf_storage_path')
    .eq('id', id)
    .single()

  if (!task || !task.pdf_storage_path) return res.status(404).end()

  const { data: fileData } = await supabase.storage
    .from('contracts')
    .download(task.pdf_storage_path)

  if (!fileData) return res.status(404).end()

  const ext = task.pdf_storage_path.toLowerCase().match(/\.(\w+)$/)?.[1] || 'pdf'

  if (ext === 'pdf') {
    // PDF 直接流式返回，浏览器原生渲染
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'inline')

    const stream = Readable.fromWeb(fileData.stream() as any)
    stream.on('error', () => {
      if (!res.headersSent) res.status(500).end()
      else res.end()
    })
    stream.pipe(res)
  } else if (ext === 'docx' || ext === 'doc') {
    // Word 文件用 mammoth 转为 HTML
    try {
      const buffer = Buffer.from(await fileData.arrayBuffer())
      const result = await mammoth.convertToHtml({ buffer })
      const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  body { font-family: "Microsoft YaHei", "SimSun", sans-serif; padding: 24px; line-height: 1.8; color: #1a1a1a; }
  table { border-collapse: collapse; width: 100%; margin: 12px 0; }
  td, th { border: 1px solid #ddd; padding: 8px; }
  h1, h2, h3 { margin-top: 20px; }
  p { margin: 8px 0; }
</style>
</head>
<body>${result.value}</body>
</html>`
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.status(200).send(html)
    } catch (err: any) {
      res.status(500).json({ error: 'Word 文档解析失败: ' + err.message })
    }
  } else {
    res.status(415).json({ error: '不支持的文件格式: .' + ext })
  }
}

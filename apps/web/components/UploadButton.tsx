import { useRef, useState } from 'react'

export default function UploadButton({ onSuccess }: { onSuccess: (taskId: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')

  const selectFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (!f.name.endsWith('.pdf')) {
      setError('请选择 PDF 文件')
      return
    }
    setError('')
    setFile(f)
    e.target.value = ''
  }

  const upload = () => {
    if (!file) return
    setUploading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append('pdf', file)

    const xhr = new XMLHttpRequest()
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      setUploading(false)
      if (xhr.status === 200) {
        const { taskId } = JSON.parse(xhr.responseText)
        setFile(null)
        onSuccess(taskId)
      } else {
        try {
          const { error: msg } = JSON.parse(xhr.responseText)
          setError(msg || '上传失败')
        } catch {
          setError('上传失败')
        }
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setError('网络错误')
    }
    xhr.open('POST', '/api/tasks/upload')
    xhr.send(formData)
  }

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  // 预览状态
  if (file) {
    return (
      <div className="border border-gray-300 rounded-lg p-4 bg-white w-80">
        <div className="flex items-center gap-3 mb-3">
          <svg className="w-8 h-8 text-red-400 flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/>
          </svg>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{file.name}</p>
            <p className="text-xs text-gray-400">{formatSize(file.size)}</p>
          </div>
        </div>
        {uploading ? (
          <div>
            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className="bg-primary h-2 rounded-full transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center">上传中 {progress}%</p>
          </div>
        ) : (
          <div className="flex gap-2">
            <button
              onClick={upload}
              className="flex-1 px-3 py-1.5 bg-primary text-white text-sm rounded-lg hover:bg-primary-light transition-colors"
            >
              确认上传
            </button>
            <button
              onClick={() => { setFile(null); setError('') }}
              className="flex-1 px-3 py-1.5 border border-gray-300 text-sm rounded-lg hover:bg-gray-50 transition-colors"
            >
              取消
            </button>
          </div>
        )}
        {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
      </div>
    )
  }

  // 默认按钮
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={selectFile}
      />
      <button
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-light transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
        上传合同 PDF
      </button>
      {error && <p className="text-sm text-red-600 mt-2">{error}</p>}
    </div>
  )
}

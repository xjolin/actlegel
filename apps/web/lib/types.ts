export type TaskStatus =
  | 'pending' | 'parsing' | 'parsing_failed'
  | 'desensitizing' | 'desens_failed'
  | 'analyzing' | 'analyze_failed'
  | 'done' | 'failed'

export interface TaskSummary {
  id: string
  filename: string
  status: TaskStatus
  desens_cursor: number
  desens_total: number
  created_at: string
  updated_at: string
}

export interface AnalysisItem {
  item_index: number
  category: string
  severity: 'high' | 'medium' | 'low'
  description: string
  suggestion: string
  clause_ref: string
}

export interface TaskDetail extends TaskSummary {
  pdf_storage_path: string | null
  raw_text: string | null
  desensitized_text: string | null
  analysis_result: AnalysisItem[] | null
  error_message: string | null
  retry_count: number
  analysis_items: AnalysisItem[]
}

export interface ChatMessage {
  id?: string
  role: 'user' | 'assistant'
  content: string
  created_at?: string
}

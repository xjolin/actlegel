# ActLegal - AI 合同审查系统

基于大语言模型的智能合同审查平台。上传 PDF 合同文件，自动完成解析、脱敏、风险分析，并提供交互式问答。

> **新机器部署**：请参阅 [DEPLOY.md](./DEPLOY.md) 完整部署手册，包含 Supabase 本地部署、MinerU、Ollama、数据库初始化的逐步指引。

## 技术栈

| 层级 | 技术 |
|---|---|
| 前端 | Next.js 16 (Pages Router)、React 19、Tailwind CSS 4 |
| 后端 API | Next.js API Routes |
| 数据库 | Supabase (PostgreSQL)、Supabase Storage、Supabase Realtime |
| PDF 解析 | MinerU (本地部署) |
| 文本脱敏 | Ollama + Qwen3 本地大模型 |
| 合同分析 | 智谱 AI (GLM-4-Flash) |

## 目录结构

```
actlegal/
├── apps/
│   └── web/                    # Next.js 全栈应用
│       ├── components/         # 前端 React 组件
│       │   ├── AnalysisPanel   # 分析结果面板
│       │   ├── ChatPanel       # AI 问答面板 (SSE 流式)
│       │   ├── TaskCard        # 任务卡片
│       │   ├── TaskList        # 任务列表 (Realtime 订阅)
│       │   └── UploadButton    # 文件上传组件
│       ├── lib/
│       │   ├── services/       # 后端外部服务集成
│       │   │   ├── mineru.ts   # MinerU PDF 解析适配
│       │   │   ├── ollama.ts   # Ollama 脱敏 (重试 + 校验)
│       │   │   └── analysis.ts # 智谱 AI 合同分析
│       │   ├── pipeline.ts     # 三阶段流水线 + 串行队列
│       │   ├── chunks.ts       # 文本分块工具
│       │   ├── types.ts        # 前后端共享类型定义
│       │   └── supabase/       # Supabase 客户端 (browser/server)
│       ├── pages/
│       │   ├── api/            # API 路由 (后端)
│       │   │   ├── tasks/      # 任务 CRUD + 上传
│       │   │   └── worker/     # 定时任务调度
│       │   ├── index.tsx       # 任务列表页
│       │   └── tasks/[id].tsx  # 任务详情页 (PDF 预览 + 分析 + 问答)
│       └── styles/
├── packages/
│   └── db/                     # 数据库
│       └── supabase/migrations/# SQL 迁移脚本
├── .env.local.example          # 环境变量模板
└── README.md
```

## 环境变量配置

复制模板并填入实际值：

```bash
cp apps/web/.env.local.example apps/web/.env.local
```

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# MinerU PDF 解析服务
MINERU_API_URL=http://your-mineru-host:8888

# Ollama 脱敏服务
OLLAMA_API_URL=http://your-ollama-host:11434
OLLAMA_DESENS_MODEL=qwen3-ACT

# 智谱 AI 合同分析
ANALYSIS_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
ANALYSIS_API_KEY=your_api_key
ANALYSIS_MODEL=glm-4-flash

# Worker 调度密钥 (生产环境使用)
WORKER_SECRET=your_secret_key
```

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 启动生产服务
npm start
```

访问 `http://localhost:3000`。

## 数据库初始化

在 Supabase SQL Editor 中执行迁移脚本：

```
packages/db/supabase/migrations/001_init.sql
```

该脚本会创建：
- `review_tasks` — 主任务表 (状态、解析文本、分析结果)
- `analysis_items` — 分析结果明细 (逐条风险项)
- `chat_messages` — 对话历史
- Realtime 发布订阅
- `updated_at` 自动更新触发器

## 架构说明

### 处理流水线

合同审查分为三个阶段，由 `lib/pipeline.ts` 串行编排：

```
上传 PDF → [阶段1] MinerU 解析 → [阶段2] Ollama 分块脱敏 → [阶段3] 智谱 AI 分析 → 完成
```

1. **PDF 解析** — 将 PDF 文件发送到 MinerU 服务，提取纯文本
2. **文本脱敏** — 将文本分块 (每块约 500 字)，逐块通过 Ollama 本地大模型脱敏，支持断点续传
3. **合同分析** — 将脱敏后文本发送给智谱 AI，生成风险分析报告

### 串行任务队列

使用内存级 Promise 链实现串行队列，确保同一时间只处理一个任务，避免 MinerU/Ollama 资源竞争。

### Ollama 输出容错

- 3 次重试 + 指数退避 (2s, 4s, 8s)
- 输出长度校验 (不低于原文 30%)
- 自动清洗模型添加的前缀废话
- 校验失败时保留原文作为兜底

### 实时更新

前端通过 Supabase Realtime 订阅数据库变更，实时更新任务状态和进度，无需轮询。

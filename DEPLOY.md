# ActLegal 部署手册

从零开始在新机器上部署完整的 AI 合同审查系统。

## 目录

1. [系统要求](#1-系统要求)
2. [部署本地 Supabase](#2-部署本地-supabase)
3. [部署 MinerU](#3-部署-mineru)
4. [部署 Ollama](#4-部署-ollama)
5. [获取智谱 AI 密钥](#5-获取智谱-ai-密钥)
6. [部署 ActLegal 应用](#6-部署-actlegal-应用)
7. [初始化数据库](#7-初始化数据库)
8. [创建 Storage 桶](#8-创建-storage-桶)
9. [配置环境变量](#9-配置环境变量)
10. [启动并验证](#10-启动并验证)
11. [可选：pg_cron 自动调度](#11-可选pg_cron-自动调度)
12. [故障排查](#12-故障排查)

---

## 1. 系统要求

| 组件 | 最低配置 |
|---|---|
| 操作系统 | Linux (Ubuntu 20.04+) / macOS |
| Node.js | >= 18.x |
| npm | >= 9.x |
| Docker | >= 20.x（用于 Supabase 本地部署） |
| Docker Compose | >= 2.x |
| GPU | NVIDIA GPU + CUDA（Ollama 推理用，显存 >= 16GB） |
| 磁盘 | >= 50GB 可用空间 |
| 内存 | >= 16GB（建议 32GB） |

## 2. 部署本地 Supabase

### 2.1 安装 Supabase CLI

```bash
# macOS
brew install supabase/tap/supabase

# Linux
curl -sSL https://storage.googleapis.com/supabase-cli/install.sh | bash
```

### 2.2 初始化并启动本地 Supabase

```bash
# 创建项目目录
mkdir actlegal-infra && cd actlegal-infra

# 初始化 Supabase（会生成 supabase/ 目录和 docker-compose.yml）
supabase init

# 拉取并启动所有服务（PostgreSQL、Storage、Realtime、Auth 等）
supabase start
```

首次启动会下载 Docker 镜像，需要几分钟。启动成功后会输出：

```
API URL: http://localhost:54321
GraphQL URL: http://localhost:54321/graphql/v1
DB URL: postgresql://postgres:postgres@localhost:54321/postgres
Studio URL: http://localhost:54323
anon key: eyJhbGciOiJI...
service_role key: eyJhbGciOiJI...
```

**记录以下信息，后面会用到：**
- `API URL` — 填入 `NEXT_PUBLIC_SUPABASE_URL`
- `anon key` — 填入 `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `service_role key` — 填入 `SUPABASE_SERVICE_ROLE_KEY`

### 2.3 验证 Supabase 运行

```bash
# 检查所有容器是否在运行
supabase status

# 访问 Supabase Studio 管理界面
open http://localhost:54323   # macOS
# 浏览器打开 http://localhost:54323
```

## 3. 部署 MinerU

MinerU 是 PDF 文档解析服务，用于提取 PDF 中的文本内容。

### 3.1 Docker 部署

```bash
# 拉取 MinerU 镜像
docker pull opendatalab/mineru:latest

# 启动 MinerU 服务
docker run -d \
  --name mineru \
  --gpus all \
  -p 8888:8888 \
  -v /data/mineru/models:/app/models \
  opendatalab/mineru:latest
```

### 3.2 验证 MinerU

```bash
# 检查服务是否正常运行
curl http://localhost:8888/health

# 如果返回 200 说明启动成功
```

> 如果 MinerU 部署在其他机器上，将 `localhost:8888` 替换为对应的 IP 和端口。

## 4. 部署 Ollama

Ollama 用于本地大模型推理，负责合同文本脱敏。

### 4.1 安装 Ollama

```bash
# Linux
curl -fsSL https://ollama.com/install.sh | sh

# macOS
brew install ollama
```

### 4.2 拉取模型并启动

```bash
# 启动 Ollama 服务
ollama serve &

# 拉取脱敏模型（Qwen3 系列，中文效果好）
ollama pull qwen3:8b
# 如果有更大显存，可以用更大模型
# ollama pull qwen3:14b
# ollama pull qwen3:32b
```

### 4.3 验证 Ollama

```bash
# 检查模型列表
ollama list

# 测试推理
curl http://localhost:11434/api/chat -d '{
  "model": "qwen3:8b",
  "stream": false,
  "messages": [{"role": "user", "content": "你好"}]
}'
```

> 如果 Ollama 部署在其他机器上，将 `localhost:11434` 替换为对应的 IP 和端口。

## 5. 获取智谱 AI 密钥

合同分析使用智谱 AI 的 GLM-4-Flash 模型（公网 API，无需本地部署）。

1. 注册智谱 AI 开放平台：https://open.bigmodel.cn
2. 进入控制台创建 API Key
3. 记录 API Key，格式类似：`xxxxxxxx.eyxxxxxxxxxxxx`

免费额度：GLM-4-Flash 有免费调用额度，适合开发测试。

## 6. 部署 ActLegal 应用

### 6.1 克隆代码

```bash
git clone git@github.com:xjolin/actlegel.git
cd actlegel
```

### 6.2 安装依赖

```bash
npm install
```

## 7. 初始化数据库

将 SQL 迁移脚本导入本地 Supabase 的 PostgreSQL：

```bash
# 方式一：通过 supabase CLI
supabase db push

# 方式二：手动执行 SQL
psql "postgresql://postgres:postgres@localhost:54321/postgres" \
  -f packages/db/supabase/migrations/001_init.sql
```

该脚本会创建：
- `review_tasks` — 主任务表（状态、解析文本、分析结果）
- `analysis_items` — 分析结果明细（逐条风险项）
- `chat_messages` — 对话历史
- 自动更新 `updated_at` 的触发器
- Realtime 发布订阅（用于前端实时状态更新）

> **注意**：本地 Supabase 默认不启用 `pg_cron` 和 `pg_net` 扩展。迁移脚本中的 `create extension if not exists pg_cron` 和 `pg_net` 会报错，不影响使用。如果需要定时调度，参见 [第 11 节](#11-可选pg_cron-自动调度)。

## 8. 创建 Storage 桶

系统需要一个名为 `contracts` 的 Storage 桶来存储上传的 PDF 文件。

```bash
# 方式一：通过 Supabase Studio 创建
# 1. 访问 http://localhost:54323
# 2. 进入 Storage 页面
# 3. 点击 "New Bucket"
# 4. 名称填 contracts
# 5. 取消勾选 "Public bucket"（保持私有，通过 API 代理访问）

# 方式二：通过 psql 创建
psql "postgresql://postgres:postgres@localhost:54321/postgres" -c "
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('contracts', 'contracts', false, 52428800, array['application/pdf'])
  on conflict (id) do nothing;
"

# 方式三：通过 Supabase CLI
supabase storage create buckets --from packages/db/storage.json
```

## 9. 配置环境变量

```bash
# 复制环境变量模板
cp apps/web/.env.local.example apps/web/.env.local
```

编辑 `apps/web/.env.local`，填入各服务的实际地址和密钥：

```env
# ============ Supabase ============
# 从 supabase start 输出中获取
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<从 supabase start 获取>
SUPABASE_SERVICE_ROLE_KEY=<从 supabase start 获取>

# ============ MinerU ============
# 默认同机部署
MINERU_API_URL=http://localhost:8888
# 如果 MinerU 在其他机器：http://192.168.x.x:8888

# ============ Ollama ============
# 默认同机部署
OLLAMA_API_URL=http://localhost:11434
# 如果 Ollama 在其他机器：http://192.168.x.x:11434
# 模型名称必须与 ollama list 中显示的一致
OLLAMA_DESENS_MODEL=qwen3:8b

# ============ 智谱 AI ============
ANALYSIS_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
ANALYSIS_API_KEY=<从 open.bigmodel.cn 控制台获取>
ANALYSIS_MODEL=glm-4-flash

# ============ Worker（可选） ============
# 用于 pg_cron 调度接口认证，随意设置一个字符串
WORKER_SECRET=your-secret-key-here
```

### 各变量说明

| 变量 | 说明 | 示例 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase API 地址（浏览器可见） | `http://localhost:54321` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名密钥（浏览器可见） | `eyJhbG...` |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase 服务端密钥（仅后端使用） | `eyJhbG...` |
| `MINERU_API_URL` | MinerU 服务地址 | `http://localhost:8888` |
| `OLLAMA_API_URL` | Ollama 服务地址 | `http://localhost:11434` |
| `OLLAMA_DESENS_MODEL` | Ollama 使用的脱敏模型名称 | `qwen3:8b` |
| `ANALYSIS_API_URL` | 智谱 AI API 地址（固定） | `https://open.bigmodel.cn/...` |
| `ANALYSIS_API_KEY` | 智谱 AI API 密钥 | `xxx.xxx` |
| `ANALYSIS_MODEL` | 智谱 AI 模型名称（固定） | `glm-4-flash` |
| `WORKER_SECRET` | Worker 调度密钥（可选） | `my-secret-123` |

## 10. 启动并验证

### 10.1 启动应用

```bash
# 开发模式
npm run dev

# 或者构建后生产模式运行
npm run build
npm start
```

访问 `http://localhost:3000`，应该看到任务列表页面。

### 10.2 逐项验证

1. **页面加载** — 浏览器打开 `http://localhost:3000`，显示空任务列表
2. **文件上传** — 上传一个 PDF 文件，应该跳转到任务详情页
3. **PDF 预览** — 左侧应该显示 PDF 原文预览
4. **流水线运行** — 观察终端日志，依次看到：
   ```
   [Queue] 开始处理任务: xxx-xxx-xxx
   [MinerU] 开始解析: filename.pdf
   [MinerU] 响应长度: xxxxx
   [Pipeline] rawText length: xxxxx
   [Pipeline] 脱敏块: 1 / 47
   [Ollama] OK, 原文: 500 脱敏: 480
   ...
   ```
5. **状态实时更新** — 页面上的状态徽章应该实时变化（解析中 → 脱敏中 → 分析中 → 已完成）
6. **分析结果** — 完成后右侧应该显示风险分析列表
7. **AI 问答** — 底部对话框输入问题，应该有流式回复

### 10.3 常见启动问题

**Supabase 连接失败**
```
Error: fetch failed
```
确认 Supabase 已启动：`supabase status`，确认 `.env.local` 中 URL 和端口正确。

**MinerU 连接失败**
```
MinerU error ECONNREFUSED
```
确认 MinerU 容器运行中：`docker ps | grep mineru`，确认 URL 正确。

**Ollama 超时**
```
The operation was aborted due to timeout
```
确认 Ollama 运行中：`ollama list`，确认模型已下载。大模型首次推理可能较慢。

**智谱 AI 返回 401**
```
Analysis model error 401
```
确认 API Key 正确，从 https://open.bigmodel.cn 控制台重新获取。

## 11. 可选：pg_cron 自动调度

开发环境下，任务上传后直接由 Next.js 进程入队处理。生产环境可以使用 `pg_cron` 定时扫描失败任务并自动重试。

本地 Supabase 默认不启用 `pg_cron`，需要修改 Supabase 配置：

```bash
# 编辑 supabase/config.toml
# 在 [auth] 或文件末尾添加：
```

```toml
# supabase/config.toml
[experimental]
pg_cron = true
pg_net = true
```

然后重新启动：

```bash
supabase stop
supabase start
```

启动后执行调度 SQL（修改 URL 和密钥为你自己的）：

```sql
-- 替换为你的实际地址和密钥
select cron.schedule(
  'dispatch-review-tasks',
  '15 seconds',
  $$
  select net.http_post(
    url := 'http://host.docker.internal:3000/api/worker/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', 'your-secret-key-here'
    ),
    body := '{}'::jsonb
  )
  $$
);
```

> **注意**：如果 Next.js 运行在 Docker 外部，URL 中要用 `host.docker.internal` 而不是 `localhost`，因为 pg_cron 运行在 Docker 容器内部。

## 12. 故障排查

### 查看日志

```bash
# Supabase 各服务日志
supabase logs

# MinerU 日志
docker logs mineru

# Next.js 应用日志（终端直接输出）
npm run dev
```

### 重置数据库

```bash
# 删除所有数据并重新初始化
supabase db reset
```

### 常见端口

| 服务 | 默认端口 |
|---|---|
| ActLegal (Next.js) | 3000 |
| Supabase API | 54321 |
| Supabase Studio | 54323 |
| Supabase PostgreSQL | 54322 |
| Supabase Realtime | 54325 |
| MinerU | 8888 |
| Ollama | 11434 |

### 服务依赖关系

```
ActLegal (Next.js)
  ├── Supabase (PostgreSQL + Storage + Realtime)  ← 必须先启动
  ├── MinerU                                      ← PDF 解析时才需要
  ├── Ollama                                      ← 脱敏时才需要
  └── 智谱 AI (公网)                              ← 分析时才需要
```

启动顺序：Supabase → Ollama → MinerU → ActLegal。

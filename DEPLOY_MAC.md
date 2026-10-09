# ActLegal 新 Mac 部署与启动手册（HaS 脱敏版）

适用于：一台全新的 Mac（Apple Silicon，M 系列芯片），在**本机**跑起全部服务：

| 服务 | 作用 | 本机地址 |
|---|---|---|
| Supabase（Docker） | 数据库 + 文件存储 + 实时推送 | API `http://127.0.0.1:54321`，管理台 `http://127.0.0.1:54323` |
| MinerU | PDF 解析 | `http://127.0.0.1:8888` |
| Ollama + HaS 模型 | 脱敏（实体识别） | `http://127.0.0.1:11434` |
| 智谱 GLM（云端） | 合同风险分析 | 需要 API Key |
| Next.js 应用 | 前端 + 后端 API | `http://localhost:3000` |

> 代码分支：`feature/has-desensitization`（尚未合并到 `main` 前，请用这个分支部署）。

---

## 目录

- [一、首次部署](#一首次部署)
  - [1. 安装基础工具](#1-安装基础工具)
  - [2. 拉取代码](#2-拉取代码)
  - [3. 启动 Supabase 并初始化数据库](#3-启动-supabase-并初始化数据库)
  - [4. 安装 Ollama 与 HaS 模型](#4-安装-ollama-与-has-模型)
  - [5. 安装并启动 MinerU](#5-安装并启动-mineru)
  - [6. 配置环境变量](#6-配置环境变量)
  - [7. 安装依赖并启动应用](#7-安装依赖并启动应用)
  - [8. 端到端验证](#8-端到端验证)
- [二、日常启动 / 停止](#二日常启动--停止)
- [三、常见问题](#三常见问题)
- [四、已知限制](#四已知限制)

---

## 一、首次部署

### 1. 安装基础工具

```bash
# Homebrew（已装可跳过）
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js 22 LTS（Next.js 16 要求 Node ≥ 20.9）、Git、Supabase CLI、uv（Python 管理）
brew install node@22 git supabase/tap/supabase uv
brew link --force --overwrite node@22

# Docker Desktop 与 Ollama（图形应用）
brew install --cask docker ollama
```

安装后**手动打开一次** Docker Desktop 和 Ollama 应用，完成授权，确认菜单栏图标出现。

自检：

```bash
node -v          # v22.x
supabase -v
docker info >/dev/null && echo "docker ok"
ollama -v
uv --version
```

### 2. 拉取代码

需要先把这台 Mac 的 SSH 公钥加到 GitHub（`ssh-keygen -t ed25519` → 把 `~/.ssh/id_ed25519.pub` 加到 GitHub → Settings → SSH keys）。

```bash
mkdir -p ~/work && cd ~/work
git clone git@github.com:xjolin/actlegel.git actlegal
cd actlegal
git checkout feature/has-desensitization
```

下文所有命令中，`~/work/actlegal` 即项目根目录。

### 3. 启动 Supabase 并初始化数据库

Supabase 实例放在**项目目录之外**，避免误提交：

```bash
mkdir -p ~/work/actlegal-supabase && cd ~/work/actlegal-supabase
supabase init          # 询问是否生成 VS Code / IntelliJ 配置时，直接回车选 N
supabase start         # 首次会拉取 Docker 镜像，需要几分钟
```

> 新 Mac 上没有其他 Supabase 实例，使用默认端口即可（54321～54324）。若端口被占用，修改 `supabase/config.toml` 中对应的 `port` 后重新 `supabase start`。

**记下密钥**（第 6 步要用）：

```bash
supabase status -o env
```

关注其中的 `API_URL`、`ANON_KEY`、`SERVICE_ROLE_KEY` 三项。

**建表 + 加脱敏映射列 + 建存储桶**（无需安装 psql，直接进数据库容器执行）：

```bash
cd ~/work/actlegal
DB=$(docker ps --format '{{.Names}}' | grep '^supabase_db_' | head -1); echo "$DB"

docker exec -i "$DB" psql -U postgres -d postgres < packages/db/supabase/migrations/001_init.sql
docker exec -i "$DB" psql -U postgres -d postgres < packages/db/supabase/migrations/002_add_desens_mapping.sql

docker exec -i "$DB" psql -U postgres -d postgres -c "
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('contracts', 'contracts', false, 52428800, array['application/pdf'])
  on conflict (id) do nothing;"
```

验证：

```bash
docker exec -i "$DB" psql -U postgres -d postgres -c "\dt public.*"
# 应看到 review_tasks、analysis_items、chat_messages

docker exec -i "$DB" psql -U postgres -d postgres -c \
  "select column_name from information_schema.columns where table_name='review_tasks' and column_name='desens_mapping';"
# 应返回一行 desens_mapping
```

> ⚠️ `002_add_desens_mapping.sql` 必须执行，否则脱敏阶段写入 `desens_mapping` 会报错。

### 4. 安装 Ollama 与 HaS 模型

确认 Ollama 应用已在运行（菜单栏有羊驼图标），然后：

```bash
ollama pull hf.co/xuanwulab/HaS_Text_0209_0.6B_Q4:latest
ollama list      # 应能看到 hf.co/xuanwulab/HaS_Text_0209_0.6B_Q4
```

验证模型能做实体识别：

```bash
curl -s http://127.0.0.1:11434/api/chat -d '{
  "model": "hf.co/xuanwulab/HaS_Text_0209_0.6B_Q4:latest",
  "stream": false,
  "options": {"temperature": 0},
  "messages": [{"role": "user", "content": "Recognize the following entity types in the text.\nSpecified types:[\"人名\",\"组织\",\"地址\"]\n<text>甲方北京某某科技有限公司，法定代表人张三，地址北京市海淀区中关村大街1号。</text>"}]
}'
```

返回的 `message.content` 或 `message.thinking` 中应有类似 `{"人名":["张三"],"组织":["北京某某科技有限公司"],...}` 的 JSON。

> 从 `hf.co` 拉取较慢或失败时，检查网络代理；也可在能访问的机器上拉好后，拷贝 `~/.ollama/models` 目录过来。

### 5. 安装并启动 MinerU

MinerU 需要 Python 3.10～3.13，用 uv 建一个独立环境：

```bash
mkdir -p ~/work/mineru && cd ~/work/mineru
uv venv --python 3.12
source .venv/bin/activate
uv pip install -U "mineru[core]"
```

启动 API 服务（首次运行会自动下载模型，国内网络建议走 ModelScope）：

```bash
cd ~/work/mineru && source .venv/bin/activate
export MINERU_MODEL_SOURCE=modelscope
mineru-api --host 127.0.0.1 --port 8888
```

另开一个终端，用任意 PDF 验证：

```bash
curl -s -F "files=@/path/to/任意合同.pdf" http://127.0.0.1:8888/file_parse | head -c 500
```

能返回解析出的文字内容即可。

> ⚠️ 应用侧 `apps/web/lib/services/mineru.ts` 会依次取返回 JSON 的 `text` / `result` / `content` 字段，都没有时会把整个 JSON 当文本。如果新版 MinerU 返回的是嵌套结构（例如 `results.<文件名>.md_content`），流程能跑通，但脱敏和分析拿到的会是带 JSON 转义的文本。部署后请看一眼任务详情里的原文，若是 JSON，需要调整 `mineru.ts` 的取值逻辑。

### 6. 配置环境变量

```bash
cd ~/work/actlegal
cp apps/web/.env.local.example apps/web/.env.local
open -e apps/web/.env.local
```

填写为：

```env
# Supabase（第 3 步 supabase status -o env 的输出）
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY>

# PDF 解析
MINERU_API_URL=http://127.0.0.1:8888

# 脱敏：Ollama + HaS
OLLAMA_API_URL=http://127.0.0.1:11434
OLLAMA_DESENS_MODEL=hf.co/xuanwulab/HaS_Text_0209_0.6B_Q4:latest

# 合同分析：智谱 GLM
ANALYSIS_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
ANALYSIS_MODEL=glm-4-flash
ANALYSIS_API_KEY=<你的智谱 API Key>

# 手动触发重试任务时使用的密钥（自定义一个随机字符串）
WORKER_SECRET=<随机字符串>
```

> `.env.local` 已在 `.gitignore` 中，不会被提交。不要把真实密钥写进 `.env.local.example`。

### 7. 安装依赖并启动应用

```bash
cd ~/work/actlegal
npm install
npm run dev               # 开发模式，改代码自动刷新
```

或者以生产模式运行：

```bash
npm run build && npm start
```

浏览器打开 <http://localhost:3000>。

### 8. 端到端验证

1. 首页上传一份 PDF 合同；
2. 任务状态应依次变为：解析中 → 脱敏中（显示进度 x/y）→ 分析中 → 完成；
3. 进入任务详情，确认脱敏文本里人名、公司、地址、电话等已变成 `[人名1]`、`[组织1]`、`[电话1]` 这类带编号的占位符，且同一实体在全文中编号一致；
4. 运行 `npm run dev` 的终端里应能看到 `[HaS] 块脱敏完成 ...` 日志。

---

## 二、日常启动 / 停止

**启动顺序**（开机后）：

```bash
# 1) 打开 Docker Desktop、Ollama 应用（可在系统设置 → 通用 → 登录项 里设为开机自启）

# 2) Supabase
cd ~/work/actlegal-supabase && supabase start

# 3) MinerU（单独一个终端，保持运行）
cd ~/work/mineru && source .venv/bin/activate && MINERU_MODEL_SOURCE=modelscope mineru-api --host 127.0.0.1 --port 8888

# 4) 应用（再开一个终端）
cd ~/work/actlegal && npm run dev
```

**一键自检**：

```bash
curl -s -o /dev/null -w "supabase %{http_code}\n" http://127.0.0.1:54321/rest/v1/
curl -s -o /dev/null -w "ollama   %{http_code}\n" http://127.0.0.1:11434/api/tags
curl -s -o /dev/null -w "mineru   %{http_code}\n" http://127.0.0.1:8888/docs
curl -s -o /dev/null -w "web      %{http_code}\n" http://localhost:3000
```

`supabase` 返回 401 也属正常（服务在线，只是没带密钥）；其余应为 200。

**重试失败的任务**（处理失败的任务不会自动重试，需手动触发）：

```bash
curl -X POST http://localhost:3000/api/worker/dispatch -H "x-worker-secret: <WORKER_SECRET>"
```

**停止**：

```bash
# 应用 / MinerU：在各自终端按 Ctrl+C
cd ~/work/actlegal-supabase && supabase stop     # 数据会保留
```

**更新代码**：

```bash
cd ~/work/actlegal
git pull
npm install
# 若有新的 packages/db/supabase/migrations/*.sql，按第 3 步的方式执行一遍
```

---

## 三、常见问题

| 现象 | 排查 |
|---|---|
| `supabase start` 报 Docker 未运行 | 先打开 Docker Desktop，等左下角显示 Engine running |
| 上传报 `Bucket not found` | 第 3 步的 `contracts` 存储桶没建，重新执行那条 SQL |
| 脱敏阶段报 `column "desens_mapping" does not exist` | 没执行 `002_add_desens_mapping.sql` |
| 脱敏阶段报 `HaS error: 404` | 模型名与 `ollama list` 不一致，或模型未拉取 |
| 日志出现 `NER 输出非 JSON`，且多次重试后提示 `仅正则脱敏` | HaS 模型输出异常，此时该块只脱敏邮箱、身份证、电话等固定格式信息；检查 Ollama 版本与模型是否完整 |
| 解析阶段超时 / `MinerU error` | 确认 `mineru-api` 终端在运行；首次解析需要下载模型，耗时较长 |
| 分析阶段失败 | 检查 `ANALYSIS_API_KEY` 是否正确、账户是否有余额 |
| 页面任务状态不实时刷新 | 确认 `001_init.sql` 执行成功（其中包含 Realtime 订阅配置），刷新页面 |
| 改了 `.env.local` 不生效 | 重启 `npm run dev` |

---

## 四、已知限制

- **问答功能（任务详情页的 AI 问答）目前不可用**：`apps/web/pages/api/tasks/[id]/chat.ts` 复用了 `OLLAMA_DESENS_MODEL` 作为对话模型，而 HaS 是 0.6B 的实体识别模型，不具备对话能力。后续需要为问答单独配置一个对话模型（如智谱 GLM 或本地 qwen）。
- **跨块漏识别**：当前脱敏按 500 字分块识别并替换。某实体在一块中被识别、在另一块中被模型漏掉时，后者不会被替换。计划改为"先全文识别、再统一替换"的两阶段方案。
- **`desens_mapping` 存有原始敏感信息**（占位符 → 原值），请勿将本机数据库暴露到公网。

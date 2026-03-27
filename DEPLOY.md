# ActLegal 部署手册 (AI 自动操作版)

本文档已针对 AI 自动操作进行了优化。AI 读取此文档后，可自行完成环境架构的部署与配置，并在需要密码或密钥时主动向用户获取。

**核心变更：**
- **MinerU 和 Ollama**：已在服务器部署完毕，跳过部署，只需配置正确的网络地址与模型。
- **智谱 API**：逻辑保持不变，AI 需向用户索取 `ANALYSIS_API_KEY`。
- **Supabase**：由于服务器上已有其它实例，**必须**启动一个名为 `supabase-legal` 的全新、独立的 Docker 实例，并修改默认端口防止冲突。

---

## 目录

1. [准备独立 Supabase Docker (supabase-legal)](#1-准备独立-supabase-docker-supabase-legal)
2. [初始化数据库与存储桶](#2-初始化数据库与存储桶)
3. [安装项目依赖](#3-安装项目依赖)
4. [配置环境变量](#4-配置环境变量)
5. [启动与验证](#5-启动与验证)

---

## 1. 准备独立 Supabase Docker (supabase-legal)

**AI 执行动作：**

由于服务器已存在其他 Supabase 服务，为避免 Docker 容器名和端口冲突，请执行以下步骤创建一个全新的实例环境。

1. **新建并进入专属目录：**
   需在 `actlegal` 根目录下，新建一个 `supabase-legal` 文件夹，并在此目录初始化 supabase。
   ```bash
   mkdir -p supabase-legal && cd supabase-legal
   supabase init
   ```

2. **修改端口解决冲突：**
   打开生成的 `supabase-legal/supabase/config.toml`，将所有主要服务的端口偏移修改（如 +10），避免默认端口占用报错。
   请通过代码编辑工具（如 `replace_file_content`）进行如下关键替换：
   - `[api]` 下的 `port` 改为 `54331` (原 `54321`)
   - `[db]` 下的 `port` 改为 `54332` (原 `54322`)
   - `[db]` 下的 `shadow_port` 改为 `54330` (原 `54320`)
   - `[studio]` 下的 `port` 改为 `54333` (原 `54323`)
   - `[inbucket]` 下的 `port` 改为 `54334` (原 `54324`)
   - 根据文件中的其它默认端口情况，灵活增加以确保全不冲突。

3. **启动容器：**
   ```bash
   # 在 supabase-legal 目录下执行
   supabase start
   ```
   **注意**：启动成功后终端会输出分配好的 `API URL`、`anon key` 和 `service_role key`，**AI 请将这些信息存入记忆中，将在第 4 步用到。**

---

## 2. 初始化数据库与存储桶

**AI 执行动作：**

在新启动的 `supabase-legal` 实例上执行项目的 SQL 迁移脚本以建立表结构和文件系统。

1. **导入表结构：**
   使用你刚刚在 `config.toml` 中配置的新数据库端口（如 `54332`）执行原有目录中的初始化脚本。
   ```bash
   # 请在 actlegal 根目录执行
   psql "postgresql://postgres:postgres@localhost:54332/postgres" \
     -f packages/db/supabase/migrations/001_init.sql
   ```

2. **建立 Storage 桶：**
   系统需要一个名为 `contracts` 的 Storage 桶用于上传 PDF。
   ```bash
   psql "postgresql://postgres:postgres@localhost:54332/postgres" -c "
     insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
     values ('contracts', 'contracts', false, 52428800, array['application/pdf'])
     on conflict (id) do nothing;
   "
   ```

---

## 3. 安装项目依赖

**AI 执行动作：**

```bash
# 在 actlegal 项目根目录执行
npm install
```

---

## 4. 配置环境变量

**AI 执行动作：**

1. 复制环境模板：
   ```bash
   cp apps/web/.env.local.example apps/web/.env.local
   ```
2. **向用户发起询问**，获取智谱 API Key (`ANALYSIS_API_KEY`) 以及由于环境差异可能存在密码的变量。
3. 编辑 `apps/web/.env.local` 文件并覆盖以下配置：

```env
# ============ 核心本地独立数据库 (supabase-legal) ============
# 由我们在第 1 步获得的端口和密钥
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54331
NEXT_PUBLIC_SUPABASE_ANON_KEY=<由第1步产生>
SUPABASE_SERVICE_ROLE_KEY=<由第1步产生>

# ============ 已预置服务 (维持不变) ============
MINERU_API_URL=http://localhost:8888
OLLAMA_API_URL=http://localhost:11434
OLLAMA_DESENS_MODEL=qwen3:8b

# ============ 远端问答大模型 ============
ANALYSIS_API_URL=https://open.bigmodel.cn/api/paas/v4/chat/completions
ANALYSIS_MODEL=glm-4-flash
# 在这一步暂停，通过通知请求用户提供密码
ANALYSIS_API_KEY=<用户提供的密钥>
```

---

## 5. 启动与验证

**AI 执行动作：**

全部配置完毕且拿到密码后，尝试运行前端项目：
```bash
npm run dev
```

如遇到报错，首先通过 `docker ps` 或 `supabase status` 检查对应 `supabase-legal` 的容器是否存活，其次确保环境变量中设置的新端口号在项目和数据库两侧对齐。

-- 启用扩展
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net; -- Supabase 内置，用于 pg_cron 发 HTTP

-- 任务状态枚举
create type task_status as enum (
  'pending',
  'parsing',
  'parsing_failed',
  'desensitizing',
  'desens_failed',
  'analyzing',
  'analyze_failed',
  'done',
  'failed'
);

-- 主任务表
create table review_tasks (
  id                uuid primary key default uuid_generate_v4(),
  filename          text not null,
  pdf_storage_path  text,                      -- Supabase Storage 路径
  raw_text          text,                      -- MinerU 解析出的原始文本
  desens_chunks     jsonb default '[]'::jsonb, -- 已完成脱敏的块（断点续传）
  desens_cursor     int default 0,             -- 当前处理到第几块
  desens_total      int default 0,             -- 总块数
  desensitized_text text,                      -- 合并后的脱敏全文
  analysis_result   jsonb,                     -- 大模型分析结果
  status            task_status default 'pending',
  error_message     text,
  retry_count       int default 0,
  created_at        timestamptz default now(),
  updated_at        timestamptz default now()
);

-- 分析结果明细（逐条问题，前端单独渲染用）
create table analysis_items (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid references review_tasks(id) on delete cascade,
  item_index  int not null,
  category    text,
  severity    text check (severity in ('high','medium','low')),
  description text not null,
  suggestion  text,
  clause_ref  text,   -- 对应合同原文片段（脱敏后）
  created_at  timestamptz default now()
);

-- 对话历史
create table chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid references review_tasks(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz default now()
);

-- 索引
create index on review_tasks(status);
create index on review_tasks(created_at desc);
create index on analysis_items(task_id);
create index on chat_messages(task_id, created_at);

-- updated_at 自动更新
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

create trigger review_tasks_updated_at
  before update on review_tasks
  for each row execute function update_updated_at();

-- 开启 Realtime（前端订阅状态变更）
alter publication supabase_realtime add table review_tasks;
alter publication supabase_realtime add table analysis_items;

-- pg_cron：每15秒扫一次 pending/failed 任务，触发 Next.js worker 接口
-- 注意：把 URL 和 key 替换成你自己的
select cron.schedule(
  'dispatch-review-tasks',
  '15 seconds',
  $$
  select net.http_post(
    url := 'https://your-domain.com/api/worker/dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-worker-secret', 'your-secret-key-here'
    ),
    body := '{}'::jsonb
  )
  $$
);

-- 启用扩展
create extension if not exists "uuid-ossp";
create extension if not exists pg_cron;
create extension if not exists pg_net; -- Supabase 内置，用于 pg_cron 发 HTTP

-- 任务状态枚举
do $$
begin
  if not exists (select 1 from pg_type where typname = 'task_status') then
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
  end if;
end
$$;

-- 主任务表
create table if not exists review_tasks (
  id                uuid primary key default uuid_generate_v4(),
  filename          text not null,
  party_role        text not null default 'party_a',
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
create table if not exists analysis_items (
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
create table if not exists chat_messages (
  id          uuid primary key default uuid_generate_v4(),
  task_id     uuid references review_tasks(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null,
  created_at  timestamptz default now()
);

-- 索引
create index if not exists idx_review_tasks_status on review_tasks(status);
create index if not exists idx_review_tasks_created_at_desc on review_tasks(created_at desc);
create index if not exists idx_analysis_items_task_id on analysis_items(task_id);
create index if not exists idx_chat_messages_task_id_created_at on chat_messages(task_id, created_at);

-- updated_at 自动更新
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'review_tasks_updated_at') then
    create trigger review_tasks_updated_at
      before update on review_tasks
      for each row execute function update_updated_at();
  end if;
end
$$;

-- 开启 Realtime（前端订阅状态变更）
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'review_tasks'
    ) then
      alter publication supabase_realtime add table review_tasks;
    end if;

    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = 'analysis_items'
    ) then
      alter publication supabase_realtime add table analysis_items;
    end if;
  end if;
end
$$;

do $$
declare
  dispatch_url text := nullif(current_setting('app.worker_dispatch_url', true), '');
  worker_secret text := nullif(current_setting('app.worker_secret', true), '');
begin
  if dispatch_url is null or worker_secret is null then
    return;
  end if;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  if exists (select 1 from cron.job where jobname = 'dispatch-review-tasks') then
    perform cron.unschedule((
      select jobid from cron.job where jobname = 'dispatch-review-tasks' limit 1
    ));
  end if;

  perform cron.schedule(
    'dispatch-review-tasks',
    '15 seconds',
    format(
      $sql$
      select net.http_post(
        url := %L,
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-worker-secret', %L
        ),
        body := '{}'::jsonb
      )
      $sql$,
      dispatch_url,
      worker_secret
    )
  );
end
$$;

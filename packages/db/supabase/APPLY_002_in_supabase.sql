-- =============================================================================
-- 如何在 Supabase 应用「002 脱敏映射」变更
-- =============================================================================
-- 背景：脱敏内核改为 HaS NER + 确定性替换后，需要在 review_tasks 表新增一列
--       desens_mapping，用于：
--         ① 断点续传时恢复全局映射，保证同一实体跨块/跨页占位符一致
--         ② 为后续「还原(Seek)」保留 占位符→原值 对照（本期仅存储）
--
-- 何时执行：拉取 feature/has-desensitization 分支后、启动应用「之前」。
--          不执行的话，脱敏阶段查询 desens_mapping 列会直接报错。
--
-- 怎么执行（任选其一）：
--   A) Supabase 云端控制台：
--      1. 打开 https://supabase.com/dashboard 选中你的项目
--      2. 左侧 SQL Editor → New query
--      3. 粘贴下面【变更】小节的 SQL，点 Run
--      4. 再粘贴【验证】小节确认列已存在
--   B) 自托管 / 本地数据库（那台测试服务器）：
--      用 psql 连上库后执行本文件，或把【变更】小节喂给你的迁移工具：
--        psql "$DATABASE_URL" -f APPLY_002_in_supabase.sql
--
-- 说明：该变更幂等（add column if not exists），重复执行安全；
--       只新增一列、有默认值，不影响任何既有数据或旧逻辑。
-- =============================================================================


-- ───────────────────────── 变更（必须执行）─────────────────────────
alter table review_tasks
  add column if not exists desens_mapping jsonb default '{}'::jsonb;


-- ───────────────────────── 验证（可选，确认成功）─────────────────────────
-- 应返回一行：column_name = desens_mapping, data_type = jsonb, default = '{}'::jsonb
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'review_tasks'
  and column_name = 'desens_mapping';


-- ───────────────────────── 回滚（一般不需要）─────────────────────────
-- 若要撤销本变更，执行下面这行（会丢失已存的脱敏映射，请谨慎）：
-- alter table review_tasks drop column if exists desens_mapping;

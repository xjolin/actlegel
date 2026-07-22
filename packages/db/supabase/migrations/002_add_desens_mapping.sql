-- 脱敏实体映射（占位符 → 原值）
-- 用途：① 断点续传时恢复跨块一致性，同一实体在整篇文档拿到同一占位符
--       ② 为后续"还原（Seek）"保留原值对照（本期不实现，仅存储）
alter table review_tasks
  add column if not exists desens_mapping jsonb default '{}'::jsonb;

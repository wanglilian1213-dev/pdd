-- 给 humanize_jobs 加 acknowledged 字段，用于"切回工作台是否要恢复 humanize 完成/失败 UI"判断
-- 业务规则：
--   acknowledged=false 表示用户还没看过这次 humanize 结果（completed/failed），切回工作台时要恢复 step 7 的对应状态
--   acknowledged=true  表示用户已点过"完成并创建新任务"，切回工作台不再显示这个 humanize（直接给新建任务页）

-- DEFAULT true：让所有存量记录自动为已确认（避免老用户切回工作台被几个月前的降 AI 任务突然弹出来）
-- PG14 下 ALTER ADD COLUMN ... DEFAULT 是元数据操作，不重写表
ALTER TABLE humanize_jobs ADD COLUMN IF NOT EXISTS acknowledged BOOLEAN NOT NULL DEFAULT true;

-- 改默认值：未来新插入的 humanize_jobs 默认未确认（这样降 AI 完成/失败后第一次能恢复）
ALTER TABLE humanize_jobs ALTER COLUMN acknowledged SET DEFAULT false;

-- 部分索引：只索引 acknowledged=false 的行，第三查询命中率低，部分索引足够小
CREATE INDEX IF NOT EXISTS idx_humanize_jobs_unacknowledged
  ON humanize_jobs (task_id, created_at DESC)
  WHERE acknowledged = false;

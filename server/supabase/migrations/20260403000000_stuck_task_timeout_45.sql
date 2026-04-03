-- 把卡住任务兜底超时调整到 45 分钟，兼容已存在环境
INSERT INTO system_config (key, value)
VALUES ('stuck_task_timeout_minutes', '45')
ON CONFLICT (key) DO UPDATE
SET value = EXCLUDED.value,
    updated_at = NOW();

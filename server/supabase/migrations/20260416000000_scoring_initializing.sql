-- 文章评审异步化：拆出 'initializing' 状态
-- 旧流程：POST /create 同步跑 pdf-parse + freeze + upload，可能超过浏览器 fetch 超时（"Failed to fetch"）
-- 新流程：
--   1. POST /create 只做 multer 收文件 + 上传 raw buffer 到 Storage + INSERT status='initializing' + 立即返回
--   2. 后台 prepareScoring：跑 pdf-parse 提取字数 + 冻结积分 + UPDATE status='processing' + 启动 executeScoring
--   3. status 状态机：initializing → processing → completed / failed

-- 1. 扩 status check constraint 加入 'initializing'
ALTER TABLE scorings DROP CONSTRAINT IF EXISTS scorings_status_check;
ALTER TABLE scorings ADD CONSTRAINT scorings_status_check
  CHECK (status IN ('initializing', 'processing', 'completed', 'failed'));

-- 2. 扩唯一索引（initializing + processing 都算"占位"，并发锁覆盖两个状态）
DROP INDEX IF EXISTS idx_one_active_scoring_per_user;
CREATE UNIQUE INDEX idx_one_active_scoring_per_user
  ON scorings (user_id) WHERE status IN ('initializing', 'processing');

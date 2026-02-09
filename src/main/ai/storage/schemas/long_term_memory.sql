-- 长期记忆表
CREATE TABLE IF NOT EXISTS long_term_memory (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,  -- 'semantic' | 'episodic' | 'procedural' | 'preference' | 'lesson'
  content TEXT NOT NULL,
  context TEXT,
  importance INTEGER NOT NULL,  -- 1-10
  user_id TEXT,
  session_id TEXT,
  embedding BLOB,  -- 可选：向量嵌入（未来支持）
  access_count INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  accessed_at INTEGER,
  updated_at INTEGER NOT NULL
);

-- 索引：用户+类型
CREATE INDEX IF NOT EXISTS idx_ltm_user_type 
  ON long_term_memory(user_id, type);

-- 索引：重要性
CREATE INDEX IF NOT EXISTS idx_ltm_importance 
  ON long_term_memory(importance DESC);

-- 索引：创建时间
CREATE INDEX IF NOT EXISTS idx_ltm_created 
  ON long_term_memory(created_at DESC);

-- 索引：会话ID
CREATE INDEX IF NOT EXISTS idx_ltm_session 
  ON long_term_memory(session_id);

-- 流式消息表
CREATE TABLE IF NOT EXISTS stream_messages (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    sequence INTEGER NOT NULL,
    type TEXT NOT NULL,
    content TEXT NOT NULL,
    data JSON,
    timestamp INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    source_name TEXT NOT NULL,
    created_at INTEGER NOT NULL
);

-- 索引：快速按序查询
CREATE INDEX IF NOT EXISTS idx_session_sequence ON stream_messages (session_id, sequence);

-- 索引：时间范围查询
CREATE INDEX IF NOT EXISTS idx_session_timestamp ON stream_messages (session_id, timestamp);

-- 唯一约束：同一会话内序号唯一
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_seq_unique ON stream_messages (session_id, sequence);
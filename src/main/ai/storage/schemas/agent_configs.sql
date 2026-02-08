-- Agent 自定义配置表
CREATE TABLE IF NOT EXISTS agent_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    instructions TEXT NOT NULL,
    model TEXT DEFAULT 'gpt-4o',
    tools JSON, -- 工具 ID 列表 (JSON 数组)
    metadata JSON, -- 其他元数据
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_system INTEGER DEFAULT 0 -- 是否系统预设 (0: 用户创建, 1: 系统预设)
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_agent_configs_name ON agent_configs (name);

CREATE INDEX IF NOT EXISTS idx_agent_configs_is_system ON agent_configs (is_system);

CREATE INDEX IF NOT EXISTS idx_agent_configs_created_at ON agent_configs (created_at);
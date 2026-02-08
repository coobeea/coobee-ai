-- Team 配置表
CREATE TABLE IF NOT EXISTS team_configs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    orchestration_type TEXT NOT NULL, -- 'sequential' | 'parallel' | 'planner'
    routing_rules JSON, -- 路由规则
    metadata JSON,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- Team 成员关系表
CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL, -- 成员角色（如 'planner', 'coder', 'researcher'）
    priority INTEGER DEFAULT 0, -- 优先级
    created_at INTEGER NOT NULL,
    FOREIGN KEY (team_id) REFERENCES team_configs (id) ON DELETE CASCADE,
    FOREIGN KEY (agent_id) REFERENCES agent_configs (id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members (team_id);

CREATE INDEX IF NOT EXISTS idx_team_members_agent_id ON team_members (agent_id);
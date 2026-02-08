# Agent Team 设计方案

> 多 Agent 协作的架构设计
>
> 创建时间：2026-02-04

---

## 📖 概念定义

### Agent（单体）

**定义**：独立的 AI 智能体，具备特定能力

**特点**：

- 有明确的职责范围（chat/code/research）
- 配置独立（model、instructions、tools、skills）
- 可独立使用
- 可作为 Team 成员

**创建流程**：

```
1. 选择技能（Skills）
2. 填写提示词（Instructions）
3. 选择模型（Model）
4. 保存到数据库
```

---

### Team（团队）

**定义**：多个 Agent 的协作单元，具备复杂任务处理能力

**特点**：

- 包含多个 Agent 成员
- 定义协作模式（顺序/并行/规划）
- 定义路由规则（哪类任务给谁）
- 对外提供统一接口

**创建流程**：

```
1. 命名 Team
2. 选择协作模式
3. 选择成员 Agents（从已有 Agents 中选择）
4. 配置路由规则（可选）
5. 保存到数据库
```

---

## 🏗️ 数据模型设计

### 1. Agent 配置表（已有）

```sql
-- src/main/ai/storage/schemas/agent_configs.sql
CREATE TABLE IF NOT EXISTS agent_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  instructions TEXT NOT NULL,
  model TEXT DEFAULT 'gpt-4o',
  tools JSON,              -- 工具 ID 列表
  skills JSON,             -- 技能 ID 列表 ⭐ 新增
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  is_system INTEGER DEFAULT 0
);
```

### 2. Team 配置表（新增）

```sql
-- src/main/ai/storage/schemas/team_configs.sql
CREATE TABLE IF NOT EXISTS team_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  orchestration_type TEXT NOT NULL,  -- 'sequential' | 'parallel' | 'planner'
  routing_rules JSON,                -- 路由规则
  metadata JSON,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Team 成员关系表
CREATE TABLE IF NOT EXISTS team_members (
  id TEXT PRIMARY KEY,
  team_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  role TEXT NOT NULL,               -- 成员角色（如 'planner', 'coder', 'researcher'）
  priority INTEGER DEFAULT 0,       -- 优先级
  created_at INTEGER NOT NULL,
  FOREIGN KEY (team_id) REFERENCES team_configs(id) ON DELETE CASCADE,
  FOREIGN KEY (agent_id) REFERENCES agent_configs(id) ON DELETE CASCADE
);

-- 创建索引
CREATE INDEX IF NOT EXISTS idx_team_members_team_id ON team_members(team_id);
CREATE INDEX IF NOT EXISTS idx_team_members_agent_id ON team_members(agent_id);
```

---

## 📐 TypeScript 类型定义

```typescript
// src/main/ai/teams/types.ts

/**
 * Team 协作模式
 */
export type OrchestrationType =
  | 'sequential' // 顺序执行（Chain）
  | 'parallel' // 并行执行（简单并行）
  | 'planner' // 规划执行（使用 Planner Agent）

/**
 * Team 成员配置
 */
export interface TeamMember {
  id: string
  agentId: string // 引用的 Agent ID
  role: string // 成员角色
  priority?: number // 优先级
}

/**
 * 路由规则
 */
export interface RoutingRule {
  condition: string // 条件描述（如 "包含代码相关"）
  targetRole: string // 目标角色（如 "coder"）
}

/**
 * Team 配置
 */
export interface TeamConfig {
  id: string
  name: string
  description?: string
  orchestrationType: OrchestrationType
  members: TeamMember[]
  routingRules?: RoutingRule[]
  metadata?: Record<string, any>
  createdAt: number
  updatedAt: number
}

/**
 * Team 配置数据（数据库格式）
 */
export interface TeamConfigData {
  id: string
  name: string
  description?: string
  orchestrationType: OrchestrationType
  routingRules?: RoutingRule[]
  metadata?: Record<string, any>
  createdAt: number
  updatedAt: number
}
```

---

## 🔧 核心实现

### 1. TeamConfigStore（存储层）

```typescript
// src/main/ai/storage/TeamConfigStore.ts

import { SQLiteService } from '@main/common/database'
import type { TeamConfig, TeamConfigData, TeamMember } from '../teams/types'

export class TeamConfigStore {
  private db: SQLiteService

  constructor() {
    this.db = SQLiteService.getInstance()
  }

  async initialize(): Promise<void> {
    // 执行 SQL schema
    const schema = await readFile('./schemas/team_configs.sql', 'utf-8')
    await this.db.execute(schema)
  }

  /**
   * 保存 Team 配置
   */
  async saveTeam(config: Omit<TeamConfig, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const teamId = `team_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
    const now = Date.now()

    // 1. 保存 Team 基本信息
    await this.db.execute(
      `INSERT INTO team_configs (id, name, description, orchestration_type, routing_rules, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        teamId,
        config.name,
        config.description || null,
        config.orchestrationType,
        JSON.stringify(config.routingRules || []),
        JSON.stringify(config.metadata || {}),
        now,
        now
      ]
    )

    // 2. 保存 Team 成员
    for (const member of config.members) {
      const memberId = `member_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`
      await this.db.execute(
        `INSERT INTO team_members (id, team_id, agent_id, role, priority, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [memberId, teamId, member.agentId, member.role, member.priority || 0, now]
      )
    }

    return teamId
  }

  /**
   * 获取 Team 配置
   */
  async getTeam(teamId: string): Promise<TeamConfig | null> {
    // 1. 获取 Team 基本信息
    const teamRow = await this.db.queryOne(`SELECT * FROM team_configs WHERE id = ?`, [teamId])

    if (!teamRow) return null

    // 2. 获取成员列表
    const memberRows = await this.db.query(
      `SELECT * FROM team_members WHERE team_id = ? ORDER BY priority DESC`,
      [teamId]
    )

    const members: TeamMember[] = memberRows.map((row: any) => ({
      id: row.id,
      agentId: row.agent_id,
      role: row.role,
      priority: row.priority
    }))

    return {
      id: teamRow.id,
      name: teamRow.name,
      description: teamRow.description,
      orchestrationType: teamRow.orchestration_type,
      members,
      routingRules: JSON.parse(teamRow.routing_rules || '[]'),
      metadata: JSON.parse(teamRow.metadata || '{}'),
      createdAt: teamRow.created_at,
      updatedAt: teamRow.updated_at
    }
  }

  /**
   * 列出所有 Teams
   */
  async listTeams(): Promise<TeamConfig[]> {
    const rows = await this.db.query(`SELECT id FROM team_configs`)
    const teams: TeamConfig[] = []

    for (const row of rows) {
      const team = await this.getTeam(row.id)
      if (team) teams.push(team)
    }

    return teams
  }

  /**
   * 删除 Team
   */
  async deleteTeam(teamId: string): Promise<void> {
    await this.db.execute(`DELETE FROM team_configs WHERE id = ?`, [teamId])
    // team_members 会通过 CASCADE 自动删除
  }
}

export const teamConfigStore = new TeamConfigStore()
```

---

### 2. TeamExecutor（执行层）

```typescript
// src/main/ai/teams/TeamExecutor.ts

import { agentFactory } from '../agents/AgentFactory'
import { run } from '@openai/agents'
import { teamConfigStore } from '../storage/TeamConfigStore'
import type { TeamConfig } from './types'

export class TeamExecutor {
  /**
   * 执行 Team 任务
   */
  async executeTeam(teamId: string, userInput: string): Promise<any> {
    // 1. 加载 Team 配置
    const teamConfig = await teamConfigStore.getTeam(teamId)
    if (!teamConfig) {
      throw new Error(`Team not found: ${teamId}`)
    }

    console.log(`[TeamExecutor] Executing team: ${teamConfig.name}`)

    // 2. 根据协作模式执行
    switch (teamConfig.orchestrationType) {
      case 'sequential':
        return await this.executeSequential(teamConfig, userInput)
      case 'parallel':
        return await this.executeParallel(teamConfig, userInput)
      case 'planner':
        return await this.executeWithPlanner(teamConfig, userInput)
      default:
        throw new Error(`Unknown orchestration type: ${teamConfig.orchestrationType}`)
    }
  }

  /**
   * 顺序执行（Chain）
   */
  private async executeSequential(teamConfig: TeamConfig, userInput: string): Promise<any> {
    let currentOutput = userInput

    // 按优先级顺序执行每个成员
    const sortedMembers = [...teamConfig.members].sort(
      (a, b) => (b.priority || 0) - (a.priority || 0)
    )

    for (const member of sortedMembers) {
      console.log(`[TeamExecutor] Running agent: ${member.role}`)

      // 创建或获取 Agent
      const agent = await agentFactory.createAgent(`team-${teamConfig.id}-${member.agentId}`, {
        configId: member.agentId
      })

      // 执行
      const result = await run(agent, currentOutput)
      currentOutput = result.finalOutput || ''
    }

    return currentOutput
  }

  /**
   * 并行执行
   */
  private async executeParallel(teamConfig: TeamConfig, userInput: string): Promise<any> {
    console.log(`[TeamExecutor] Running agents in parallel`)

    const results = await Promise.all(
      teamConfig.members.map(async (member) => {
        const agent = await agentFactory.createAgent(`team-${teamConfig.id}-${member.agentId}`, {
          configId: member.agentId
        })

        const result = await run(agent, userInput)
        return {
          role: member.role,
          output: result.finalOutput
        }
      })
    )

    // 合并结果
    return {
      summary: 'Parallel execution completed',
      results
    }
  }

  /**
   * 使用 Planner 执行
   */
  private async executeWithPlanner(teamConfig: TeamConfig, userInput: string): Promise<any> {
    // TODO: 集成 Orchestrator
    // 使用 Planner 规划，然后将子任务分配给 Team 成员
    console.log(`[TeamExecutor] Using Planner mode`)

    // 暂时回退到顺序执行
    return await this.executeSequential(teamConfig, userInput)
  }
}

export const teamExecutor = new TeamExecutor()
```

---

## 🎨 前端 UI 设计

### Agent 创建页面（单体）

```vue
<template>
  <div class="agent-creator">
    <h2>创建 Agent</h2>

    <!-- 1. 基本信息 -->
    <input v-model="agentName" placeholder="Agent 名称" />
    <textarea v-model="instructions" placeholder="提示词（如：你是一个...）"></textarea>

    <!-- 2. 选择技能 -->
    <h3>选择技能</h3>
    <div class="skills-grid">
      <label v-for="skill in availableSkills" :key="skill.id">
        <input type="checkbox" :value="skill.id" v-model="selectedSkills" />
        {{ skill.name }}
      </label>
    </div>

    <!-- 3. 选择模型 -->
    <h3>选择模型</h3>
    <select v-model="selectedModel">
      <option value="gpt-4o">GPT-4o</option>
      <option value="gpt-4o-mini">GPT-4o-mini</option>
    </select>

    <!-- 4. 创建按钮 -->
    <button @click="createAgent">创建 Agent</button>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

const agentName = ref('')
const instructions = ref('')
const selectedSkills = ref<string[]>([])
const selectedModel = ref('gpt-4o')

const availableSkills = ref([
  { id: 'web-research', name: 'Web Research' },
  { id: 'code-generation', name: 'Code Generation' }
])

async function createAgent() {
  const config = {
    name: agentName.value,
    instructions: instructions.value,
    model: selectedModel.value,
    skills: selectedSkills.value
  }

  // 调用 API
  const result = await window.api.createAgent(config)
  console.log('Agent created:', result)
}
</script>
```

---

### Team 创建页面（团队）

```vue
<template>
  <div class="team-creator">
    <h2>创建 Agent Team</h2>

    <!-- 1. 基本信息 -->
    <input v-model="teamName" placeholder="Team 名称" />
    <textarea v-model="description" placeholder="Team 描述"></textarea>

    <!-- 2. 选择协作模式 -->
    <h3>协作模式</h3>
    <select v-model="orchestrationType">
      <option value="sequential">顺序执行（Chain）</option>
      <option value="parallel">并行执行（Parallel）</option>
      <option value="planner">智能规划（Planner）</option>
    </select>

    <!-- 3. 选择成员 Agents -->
    <h3>Team 成员</h3>
    <div v-for="(member, index) in members" :key="index" class="member-row">
      <select v-model="member.agentId">
        <option value="">选择 Agent</option>
        <option v-for="agent in availableAgents" :key="agent.id" :value="agent.id">
          {{ agent.name }}
        </option>
      </select>
      <input v-model="member.role" placeholder="角色（如：coder）" />
      <button @click="removeMember(index)">删除</button>
    </div>
    <button @click="addMember">+ 添加成员</button>

    <!-- 4. 创建按钮 -->
    <button @click="createTeam">创建 Team</button>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const teamName = ref('')
const description = ref('')
const orchestrationType = ref('sequential')
const members = ref([{ agentId: '', role: '', priority: 0 }])
const availableAgents = ref<any[]>([])

onMounted(async () => {
  // 加载可用的 Agents
  availableAgents.value = await window.api.listAgents()
})

function addMember() {
  members.value.push({ agentId: '', role: '', priority: 0 })
}

function removeMember(index: number) {
  members.value.splice(index, 1)
}

async function createTeam() {
  const config = {
    name: teamName.value,
    description: description.value,
    orchestrationType: orchestrationType.value,
    members: members.value.filter((m) => m.agentId && m.role)
  }

  // 调用 API
  const result = await window.api.createTeam(config)
  console.log('Team created:', result)
}
</script>
```

---

## 🔄 使用流程对比

### 使用单 Agent

```typescript
// 1. 创建 Agent
const agentId = await api.createAgent({
  name: 'Code Helper',
  instructions: 'You are a coding assistant',
  model: 'gpt-4o',
  skills: ['code-generation']
})

// 2. 使用 Agent
const result = await api.runAgent(agentId, 'Write a function to sort array')
```

---

### 使用 Team

```typescript
// 1. 创建 Team
const teamId = await api.createTeam({
  name: 'Dev Team',
  orchestrationType: 'planner',
  members: [
    { agentId: 'agent-001', role: 'researcher' },
    { agentId: 'agent-002', role: 'coder' },
    { agentId: 'agent-003', role: 'reviewer' }
  ]
})

// 2. 使用 Team（对外接口统一）
const result = await api.runTeam(teamId, '实现用户认证系统')

// Team 内部会：
// - Planner 分解任务
// - researcher 搜索最佳实践
// - coder 实现代码
// - reviewer 审查代码质量
```

---

## 💡 总结

### 推荐方案

✅ **Team 作为独立概念**

1. **清晰的层次**：
   - Agent = 单体（独立能力）
   - Team = 协作单元（多个 Agent）

2. **灵活的创建**：
   - 单 Agent：快速创建，直接使用
   - Team：组合已有 Agents，定义协作规则

3. **统一的接口**：
   - 对用户：`runAgent()` vs `runTeam()`
   - 对外部：都返回结果，内部实现不同

4. **易于扩展**：
   - 可以定义复杂的路由规则
   - 可以添加更多协作模式
   - 可以嵌套 Teams

---

## 🚀 实施步骤

### Phase 1：数据层

1. ✅ 创建 `team_configs` 表
2. ✅ 创建 `team_members` 表
3. ✅ 实现 `TeamConfigStore`

### Phase 2：业务层

4. ✅ 实现 `TeamExecutor`
5. ⏳ 集成 Orchestrator（planner 模式）
6. ⏳ 实现路由规则匹配

### Phase 3：接口层

7. ⏳ 添加 IPC 接口（createTeam, runTeam）
8. ⏳ 添加 WebSocket 支持

### Phase 4：前端 UI

9. ⏳ Team 创建页面
10. ⏳ Team 管理页面

---

**下一步建议**：先实现数据层和业务层的基础功能，然后逐步完善。

<script setup lang="ts">
/**
 * ContextPanel — 任务上下文面板
 *
 * 在 ChatPanel 上方展示：
 *   A. Agent 基本信息（名称、描述、运行模式）
 *   B. Skill 列表（名称、描述、操作按钮）
 *
 * 解决三个核心问题：
 *   1. 用户在任务界面看不到 Agent 有哪些 Skill
 *   2. 用户无法直接让 Agent 按特定 Skill 执行
 *   3. 三栏布局缺少"上下文"信息
 */

import { ref, computed, watch, onMounted } from 'vue';
import { useAgentsStore, type AgentEntry } from '@/stores/agents';
import { useThreadsStore, type AgentType } from '@/stores/threads';
import configManager from '@/config';

const props = defineProps<{
  threadId: string;
}>();

const emit = defineEmits<{
  (e: 'use-skill', skillName: string): void;
  (e: 'preview-skill', skillPath: string): void;
}>();

const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

const isCollapsed = ref(false);
const skillsLoading = ref(false);

interface SkillInfo {
  name: string;
  description: string;
  source?: string;
}

const skillDetails = ref<SkillInfo[]>([]);

const currentThread = computed(() => threadsStore.threads.find((t) => t.id === props.threadId));

const currentAgent = computed<AgentEntry | null>(() => {
  const agentId = currentThread.value?.agentId;
  if (!agentId) return null;
  return agentsStore.agents.find((a) => a.id === agentId) ?? null;
});

const agentType = computed<AgentType>(() => currentThread.value?.agentType ?? 'agent');

const agentTypeLabel = computed(() => {
  switch (agentType.value) {
    case 'orchestrator':
      return '编排器';
    case 'swarm':
      return 'Swarm';
    default:
      return '单 Agent';
  }
});

const agentTypeIcon = computed(() => {
  switch (agentType.value) {
    case 'orchestrator':
      return 'i-carbon-flow';
    case 'swarm':
      return 'i-carbon-network-3';
    default:
      return 'i-carbon-bot';
  }
});

const agentSkills = computed(() => currentAgent.value?.skills ?? []);

const matchedSkills = computed(() => {
  if (agentSkills.value.length === 0) return [];
  const detailMap = new Map(skillDetails.value.map((s) => [s.name, s]));
  return agentSkills.value.map((name) => {
    const detail = detailMap.get(name);
    return {
      name,
      description: detail?.description ?? '',
      source: detail?.source
    };
  });
});

async function loadSkillDetails(): Promise<void> {
  if (agentSkills.value.length === 0) return;
  skillsLoading.value = true;
  try {
    const url = `${configManager.getBaseUrl()}/gateway/skills`;
    const res = await fetch(url);
    if (res.ok) {
      const data = (await res.json()) as { skills: SkillInfo[] };
      skillDetails.value = data.skills;
    }
  } catch (err) {
    console.warn('[ContextPanel] Failed to fetch skills:', err);
  } finally {
    skillsLoading.value = false;
  }
}

function handleUseSkill(skillName: string): void {
  emit('use-skill', skillName);
}

function toggleCollapse(): void {
  isCollapsed.value = !isCollapsed.value;
}

watch(
  () => currentAgent.value?.id,
  () => {
    if (currentAgent.value) {
      loadSkillDetails();
    }
  }
);

onMounted(() => {
  if (agentsStore.agents.length === 0) {
    agentsStore.fetchAgents();
  }
  if (currentAgent.value) {
    loadSkillDetails();
  }
});
</script>

<template>
  <div class="context-panel" :class="{ collapsed: isCollapsed }">
    <!-- 折叠状态：单行摘要 -->
    <div v-if="isCollapsed" class="collapsed-bar" @click="toggleCollapse">
      <div class="collapsed-left">
        <span :class="agentTypeIcon" class="inline-block h-3 w-3" />
        <span class="collapsed-name">{{ currentAgent?.name ?? '未知 Agent' }}</span>
        <span v-if="agentSkills.length > 0" class="collapsed-skill-count"> {{ agentSkills.length }} 技能 </span>
      </div>
      <button class="collapse-btn" title="展开">
        <span class="i-carbon-chevron-down inline-block h-3 w-3" />
      </button>
    </div>

    <!-- 展开状态 -->
    <template v-else>
      <!-- Agent 信息区 -->
      <div class="agent-section">
        <div class="agent-header">
          <div class="agent-avatar">
            <span :class="agentTypeIcon" class="inline-block h-4 w-4" />
          </div>
          <div class="agent-info">
            <div class="agent-name-row">
              <span class="agent-name">{{ currentAgent?.name ?? '默认 Agent' }}</span>
              <span class="agent-mode-tag">{{ agentTypeLabel }}</span>
            </div>
            <p v-if="currentAgent?.description" class="agent-desc">
              {{ currentAgent.description }}
            </p>
          </div>
          <button class="collapse-btn" title="折叠" @click="toggleCollapse">
            <span class="i-carbon-chevron-up inline-block h-3 w-3" />
          </button>
        </div>
      </div>

      <!-- Skill 列表区 -->
      <div v-if="agentSkills.length > 0" class="skills-section">
        <div class="skills-header">
          <span class="i-carbon-skill-level-advanced inline-block h-3 w-3" />
          <span class="skills-title">技能</span>
          <span class="skills-count">{{ agentSkills.length }}</span>
        </div>

        <div v-if="skillsLoading" class="skills-loading">
          <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
        </div>

        <div v-else class="skills-list">
          <div v-for="skill in matchedSkills" :key="skill.name" class="skill-item">
            <div class="skill-info">
              <span class="skill-name">{{ skill.name }}</span>
              <span v-if="skill.description" class="skill-desc">{{ skill.description }}</span>
            </div>
            <button class="skill-use-btn" title="按此技能执行" @click="handleUseSkill(skill.name)">
              <span class="i-carbon-play inline-block h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      <!-- 无技能提示 -->
      <div v-else class="no-skills">
        <span class="no-skills-text">该 Agent 未绑定技能</span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.context-panel {
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.4);
  overflow: hidden;
}

.context-panel.collapsed {
  border-bottom: 1px solid hsl(var(--border) / 0.2);
}

/* --- Collapsed bar --- */
.collapsed-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  padding: 0 10px;
  cursor: pointer;
  transition: background 0.12s ease;
}

.collapsed-bar:hover {
  background: hsl(var(--foreground) / 0.03);
}

.collapsed-left {
  display: flex;
  align-items: center;
  gap: 6px;
  color: hsl(var(--muted-foreground) / 0.6);
  font-size: 11px;
}

.collapsed-name {
  font-weight: 500;
  color: hsl(var(--foreground) / 0.7);
}

.collapsed-skill-count {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.6);
}

/* --- Agent section --- */
.agent-section {
  padding: 8px 10px 6px;
}

.agent-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.agent-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  flex-shrink: 0;
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.6);
}

.agent-info {
  flex: 1;
  min-width: 0;
}

.agent-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-name {
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-mode-tag {
  font-size: 9px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 3px;
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.6);
  white-space: nowrap;
  flex-shrink: 0;
}

.agent-desc {
  font-size: 10.5px;
  color: hsl(var(--muted-foreground) / 0.5);
  line-height: 1.4;
  margin-top: 2px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.collapse-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 4px;
  color: hsl(var(--muted-foreground) / 0.35);
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.collapse-btn:hover {
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--foreground) / 0.5);
}

/* --- Skills section --- */
.skills-section {
  padding: 0 10px 8px;
}

.skills-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 0;
  color: hsl(var(--muted-foreground) / 0.5);
}

.skills-title {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.skills-count {
  font-size: 9px;
  padding: 0 4px;
  border-radius: 3px;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.45);
}

.skills-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px 0;
  color: hsl(var(--muted-foreground) / 0.3);
}

.skills-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.skill-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 6px;
  border-radius: 5px;
  transition: background 0.1s ease;
}

.skill-item:hover {
  background: hsl(var(--foreground) / 0.03);
}

.skill-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.skill-name {
  font-size: 11px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-desc {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.45);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.skill-use-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: hsl(var(--primary) / 0.5);
  opacity: 0;
  transition: all 0.12s ease;
  flex-shrink: 0;
}

.skill-item:hover .skill-use-btn {
  opacity: 1;
}

.skill-use-btn:hover {
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

/* --- No skills --- */
.no-skills {
  padding: 4px 10px 8px;
}

.no-skills-text {
  font-size: 10px;
  color: hsl(var(--muted-foreground) / 0.35);
}
</style>

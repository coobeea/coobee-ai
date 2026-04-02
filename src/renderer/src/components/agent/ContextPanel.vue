<script setup lang="ts">
/**
 * ContextPanel — 任务上下文栏（紧凑单行）
 *
 * 一行高度展示：Agent 名称 + 运行模式 + Skill 数量。
 * 点击 Skill 角标弹出浮层，列出所有绑定技能及"按此技能执行"操作。
 */

import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useAgentsStore, type AgentEntry } from '@/stores/agents';
import { useThreadsStore, type AgentType } from '@/stores/threads';
import configManager from '@/config';

const props = defineProps<{
  threadId: string;
}>();

const emit = defineEmits<{
  (e: 'use-skill', skillName: string): void;
}>();

const agentsStore = useAgentsStore();
const threadsStore = useThreadsStore();

const skillsPopoverOpen = ref(false);
const skillsLoading = ref(false);
const skillBtnRef = ref<HTMLElement | null>(null);
const popoverRef = ref<HTMLElement | null>(null);
const popoverStyle = ref({ top: '0px', right: '0px' });

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
    case 'agent':
      return '自由模式';
    case 'orchestrator':
      return '编排模式';
    case 'swarm':
      return '群体模式';
    case 'quality-loop':
      return '质量闭环';
    case 'discussion':
      return '讨论模式';
    default:
      return '自由模式';
  }
});

const agentTypeIcon = computed(() => {
  switch (agentType.value) {
    case 'agent':
      return 'i-carbon-bot';
    case 'orchestrator':
      return 'i-carbon-flow';
    case 'swarm':
      return 'i-carbon-network-3';
    case 'quality-loop':
      return 'i-carbon-renew';
    case 'discussion':
      return 'i-carbon-chat';
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
  if (skillDetails.value.length > 0) return;
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

function toggleSkillsPopover(): void {
  skillsPopoverOpen.value = !skillsPopoverOpen.value;
  if (skillsPopoverOpen.value) {
    loadSkillDetails();
    if (skillBtnRef.value) {
      const rect = skillBtnRef.value.getBoundingClientRect();
      popoverStyle.value = {
        top: `${rect.bottom + 4}px`,
        right: `${window.innerWidth - rect.right}px`
      };
    }
  }
}

function handleUseSkill(skillName: string): void {
  skillsPopoverOpen.value = false;
  emit('use-skill', skillName);
}

function handleClickOutside(e: MouseEvent): void {
  const target = e.target as Node;
  if (
    popoverRef.value &&
    !popoverRef.value.contains(target) &&
    skillBtnRef.value &&
    !skillBtnRef.value.contains(target)
  ) {
    skillsPopoverOpen.value = false;
  }
}

watch(skillsPopoverOpen, (open) => {
  if (open) {
    setTimeout(() => document.addEventListener('mousedown', handleClickOutside), 0);
  } else {
    document.removeEventListener('mousedown', handleClickOutside);
  }
});

watch(
  () => currentAgent.value?.id,
  () => {
    skillDetails.value = [];
  }
);

onMounted(() => {
  if (agentsStore.agents.length === 0) {
    agentsStore.fetchAgents();
  }
});

onUnmounted(() => {
  document.removeEventListener('mousedown', handleClickOutside);
});
</script>

<template>
  <!-- 单行 Context Bar -->
  <div class="context-bar">
    <!-- 左：Agent 信息 -->
    <div class="agent-info">
      <span :class="agentTypeIcon" class="agent-icon inline-block h-3 w-3" />
      <span class="agent-name">{{ currentAgent?.name ?? '默认 Agent' }}</span>
      <span class="agent-mode">{{ agentTypeLabel }}</span>
    </div>

    <!-- 右：Skill 徽章 -->
    <div class="skills-area">
      <button
        v-if="agentSkills.length > 0"
        ref="skillBtnRef"
        class="skill-badge"
        :class="{ active: skillsPopoverOpen }"
        @click="toggleSkillsPopover">
        <span class="i-carbon-skill-level-advanced inline-block h-2.5 w-2.5" />
        <span>{{ agentSkills.length }} 技能</span>
        <span class="i-carbon-chevron-down inline-block h-2 w-2" :class="{ 'rotate-180': skillsPopoverOpen }" />
      </button>
    </div>

    <!-- Skill 弹出浮层 -->
    <Teleport to="body">
      <div v-if="skillsPopoverOpen" ref="popoverRef" class="skills-popover" :style="popoverStyle">
        <div class="popover-header">
          <span class="i-carbon-skill-level-advanced inline-block h-3 w-3" />
          <span>绑定技能</span>
        </div>

        <div v-if="skillsLoading" class="popover-loading">
          <span class="i-carbon-renew inline-block h-3.5 w-3.5 animate-spin" />
        </div>

        <div v-else class="popover-list">
          <div v-if="matchedSkills.length === 0" class="popover-empty">暂无匹配的技能详情</div>
          <div v-for="skill in matchedSkills" :key="skill.name" class="popover-item">
            <div class="popover-item-info">
              <span class="popover-item-name">{{ skill.name }}</span>
              <span v-if="skill.description" class="popover-item-desc">{{ skill.description }}</span>
            </div>
            <button class="popover-item-btn" title="按此技能执行" @click="handleUseSkill(skill.name)">
              <span class="i-carbon-play inline-block h-3 w-3" />
              <span>执行</span>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
/* --- Context Bar（单行） --- */
.context-bar {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 40px;
  padding: 0 10px;
  border-bottom: 1px solid hsl(var(--border) / 0.25);
  background: hsl(var(--surface) / 0.3);
  flex-shrink: 0;
}

/* --- Agent info（左） --- */
.agent-info {
  display: flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  flex: 1;
  overflow: hidden;
}

.agent-icon {
  color: hsl(var(--muted-foreground) / 0.5);
  flex-shrink: 0;
}

.agent-name {
  font-size: 11.5px;
  font-weight: 500;
  color: hsl(var(--foreground) / 0.75);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.agent-mode {
  font-size: 9.5px;
  padding: 1px 5px;
  border-radius: 3px;
  background: hsl(var(--foreground) / 0.04);
  color: hsl(var(--muted-foreground) / 0.5);
  white-space: nowrap;
  flex-shrink: 0;
}

/* --- Skills area（右） --- */
.skills-area {
  flex-shrink: 0;
  margin-left: 8px;
}

.skill-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 22px;
  padding: 0 8px;
  border-radius: 5px;
  font-size: 10px;
  font-weight: 500;
  color: hsl(var(--primary) / 0.65);
  background: hsl(var(--primary) / 0.07);
  border: 1px solid hsl(var(--primary) / 0.12);
  transition: all 0.12s ease;
  cursor: pointer;
}

.skill-badge:hover,
.skill-badge.active {
  background: hsl(var(--primary) / 0.12);
  color: hsl(var(--primary) / 0.9);
  border-color: hsl(var(--primary) / 0.2);
}

.skill-badge .rotate-180 {
  transform: rotate(180deg);
}
</style>

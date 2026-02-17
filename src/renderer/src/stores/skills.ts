/**
 * Skills Store
 *
 * 管理前端的技能列表状态，通过 HTTP REST API 获取数据。
 * AI 创建使用 SSE（Server-Sent Events）接收实时进度。
 * 接口基于 Gateway HTTP 路由（/gateway/skills/*）。
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import configManager from '@/config';

/** 技能条目（前端展示） */
export interface SkillEntry {
  name: string;
  description: string;
  /** 技能来源：builtin（内置）、user（用户创建/导入） */
  source?: 'builtin' | 'user';
  /** SKILL.md 文件路径 */
  filePath?: string;
}

/** AI 创建进度步骤 */
export type AiCreateStep = 'analyzing' | 'generating' | 'writing' | 'done' | 'error';

/** AI 创建进度事件 */
export interface AiCreateProgress {
  step: AiCreateStep;
  message: string;
  detail?: string;
}

/** HTTP 基础路径 */
const BASE_URL = (): string => `${configManager.getBaseUrl()}/gateway/skills`;

export const useSkillsStore = defineStore('skills', () => {
  // ==================== State ====================

  const skills = ref<SkillEntry[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /** AI 创建状态 */
  const aiCreating = ref(false);
  const aiCreateError = ref<string | null>(null);

  /** AI 创建进度（SSE 实时更新） */
  const aiCreateSteps = ref<AiCreateProgress[]>([]);
  const aiCreateCurrentStep = ref<AiCreateStep | null>(null);

  /** 导入状态 */
  const importing = ref(false);
  const importError = ref<string | null>(null);

  // ==================== Getters ====================

  const skillCount = computed(() => skills.value.length);

  // ==================== Actions ====================

  /** 加载技能列表 */
  async function fetchSkills(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const res = await fetch(BASE_URL());
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data = (await res.json()) as { skills: SkillEntry[] };
      skills.value = data.skills;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.warn('[SkillsStore] Failed to fetch skills:', err);
    } finally {
      loading.value = false;
    }
  }

  /** 导入技能（从本地路径） */
  async function importSkill(sourcePath: string): Promise<boolean> {
    importing.value = true;
    importError.value = null;

    try {
      const res = await fetch(`${BASE_URL()}/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourcePath })
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      await fetchSkills();
      return true;
    } catch (err) {
      importError.value = err instanceof Error ? err.message : String(err);
      console.warn('[SkillsStore] Failed to import skill:', err);
      return false;
    } finally {
      importing.value = false;
    }
  }

  /** 删除技能（仅用户技能可删除） */
  async function deleteSkill(skillName: string): Promise<boolean> {
    try {
      const res = await fetch(`${BASE_URL()}/${encodeURIComponent(skillName)}`, {
        method: 'DELETE'
      });

      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error || `HTTP ${res.status}`);
      }

      skills.value = skills.value.filter((s) => s.name !== skillName);
      return true;
    } catch (err) {
      console.warn('[SkillsStore] Failed to delete skill:', err);
      return false;
    }
  }

  /**
   * AI 驱动创建技能（自然语言需求）
   *
   * 通过 SSE 接收实时进度，前端可展示每个步骤。
   */
  async function aiCreateSkill(requirement: string): Promise<boolean> {
    aiCreating.value = true;
    aiCreateError.value = null;
    aiCreateSteps.value = [];
    aiCreateCurrentStep.value = 'analyzing';

    return new Promise((resolve) => {
      const url = `${BASE_URL()}/ai-create`;

      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ requirement })
      })
        .then(async (response) => {
          if (!response.ok) {
            const text = await response.text();
            throw new Error(text || `HTTP ${response.status}`);
          }

          const reader = response.body?.getReader();
          if (!reader) {
            throw new Error('SSE 流不可用');
          }

          const decoder = new TextDecoder();
          let buffer = '';

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';

            let currentEvent = '';
            for (const line of lines) {
              if (line.startsWith('event: ')) {
                currentEvent = line.slice(7).trim();
              } else if (line.startsWith('data: ')) {
                const data = line.slice(6);
                try {
                  const parsed = JSON.parse(data);
                  if (currentEvent === 'progress') {
                    const progress = parsed as AiCreateProgress;
                    aiCreateSteps.value = [...aiCreateSteps.value, progress];
                    aiCreateCurrentStep.value = progress.step;
                  } else if (currentEvent === 'result') {
                    await fetchSkills();
                    aiCreating.value = false;
                    aiCreateCurrentStep.value = 'done';
                    resolve(true);
                    return;
                  } else if (currentEvent === 'error') {
                    aiCreateError.value = (parsed as { error: string }).error;
                    aiCreating.value = false;
                    aiCreateCurrentStep.value = 'error';
                    resolve(false);
                    return;
                  }
                } catch {
                  // JSON 解析失败，忽略
                }
              }
            }
          }

          if (aiCreating.value) {
            aiCreating.value = false;
            resolve(false);
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          aiCreateError.value = msg;
          aiCreating.value = false;
          aiCreateCurrentStep.value = 'error';
          console.warn('[SkillsStore] AI create skill failed:', err);
          resolve(false);
        });
    });
  }

  /** 重置 AI 创建状态 */
  function resetAiCreateState(): void {
    aiCreating.value = false;
    aiCreateError.value = null;
    aiCreateSteps.value = [];
    aiCreateCurrentStep.value = null;
  }

  return {
    // State
    skills,
    loading,
    error,
    aiCreating,
    aiCreateError,
    aiCreateSteps,
    aiCreateCurrentStep,
    importing,
    importError,
    // Getters
    skillCount,
    // Actions
    fetchSkills,
    importSkill,
    deleteSkill,
    aiCreateSkill,
    resetAiCreateState
  };
});

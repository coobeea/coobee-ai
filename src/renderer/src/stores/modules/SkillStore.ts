/**
 * SkillStore - 技能管理
 *
 * 从 skills.ts 迁移过来，提供更清晰的 Skill 管理接口
 */

import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import configManager from '@/config';

/** 技能条目 */
export interface Skill {
  name: string;
  description: string;
  source: 'builtin' | 'user';
  filePath: string;
  category?: string;
  tags?: string[];
}

/** AI 创建状态 */
export interface AiCreateState {
  active: boolean;
  step: 'analyzing' | 'generating' | 'writing' | 'done' | 'error' | null;
  message: string;
  error: string | null;
}

/**
 * 技能 Store
 */
export const useSkillStore = defineStore('skill', () => {
  // ==================== State ====================

  const skills = ref<Skill[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const aiCreate = ref<AiCreateState>({
    active: false,
    step: null,
    message: '',
    error: null
  });

  const importing = ref(false);
  const importError = ref<string | null>(null);

  // ==================== Getters ====================

  const skillCount = computed(() => skills.value.length);

  const builtinSkills = computed(() => skills.value.filter((s) => s.source === 'builtin'));

  const userSkills = computed(() => skills.value.filter((s) => s.source === 'user'));

  // ==================== Actions ====================

  /**
   * 加载技能列表
   */
  async function fetchSkills(): Promise<void> {
    loading.value = true;
    error.value = null;

    try {
      const res = await fetch(`${configManager.getBaseUrl()}/gateway/skills`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);

      const data = (await res.json()) as { skills: Skill[] };
      skills.value = data.skills;
    } catch (err) {
      error.value = err instanceof Error ? err.message : String(err);
      console.error('[SkillStore] 加载技能失败:', err);
    } finally {
      loading.value = false;
    }
  }

  /**
   * 导入技能
   */
  async function importSkill(sourcePath: string): Promise<boolean> {
    importing.value = true;
    importError.value = null;

    try {
      const res = await fetch(`${configManager.getBaseUrl()}/gateway/skills/import`, {
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
      console.error('[SkillStore] 导入技能失败:', err);
      return false;
    } finally {
      importing.value = false;
    }
  }

  /**
   * 开始 AI 创建
   */
  function startAiCreate(): void {
    aiCreate.value = {
      active: true,
      step: 'analyzing',
      message: '正在分析需求...',
      error: null
    };
  }

  /**
   * 更新 AI 创建进度
   */
  function updateAiCreateProgress(step: AiCreateState['step'], message: string): void {
    aiCreate.value.step = step;
    aiCreate.value.message = message;
  }

  /**
   * 完成 AI 创建
   */
  function completeAiCreate(): void {
    aiCreate.value = {
      active: false,
      step: 'done',
      message: '创建完成',
      error: null
    };
  }

  /**
   * AI 创建失败
   */
  function failAiCreate(error: string): void {
    aiCreate.value = {
      active: false,
      step: 'error',
      message: '创建失败',
      error
    };
  }

  // ==================== 返回 ====================

  return {
    // State
    skills,
    loading,
    error,
    aiCreate,
    importing,
    importError,

    // Getters
    skillCount,
    builtinSkills,
    userSkills,

    // Actions
    fetchSkills,
    importSkill,
    startAiCreate,
    updateAiCreateProgress,
    completeAiCreate,
    failAiCreate
  };
});

<script setup lang="ts">
/**
 * SkillsView — 技能管理主视图
 *
 * 功能：
 *   1. 查看所有技能列表（内置 + 用户创建，不做区分）
 *   2. AI 创建技能（描述需求，自动生成 SKILL.md）
 *   3. 导入技能（从本地路径导入）
 *   4. 删除用户技能
 *
 * 使用项目通用组件：PrimaryButton, SecondaryButton, GhostButton,
 * DangerButton, TextButton, TextInput, Popup, useConfirmStore
 */

import { ref, onMounted, nextTick } from 'vue';
import { useSkillsStore } from '@/stores/skills';
import { useConfirmStore } from '@/components/Confirm/store';

const isMac = navigator.platform?.includes('Mac') ?? false;
const skillsStore = useSkillsStore();
const confirmStore = useConfirmStore();

/** AI 创建：用户需求输入 */
const aiRequirement = ref('');
const aiInputRef = ref<InstanceType<typeof HTMLTextAreaElement> | null>(null);

/** 是否显示创建区域 */
const showCreateArea = ref(false);

/** 导入弹窗 */
const showImportDialog = ref(false);
const importPath = ref('');

onMounted(() => {
  skillsStore.fetchSkills();
});

function toggleCreateArea(): void {
  showCreateArea.value = !showCreateArea.value;
  if (showCreateArea.value) {
    aiRequirement.value = '';
    skillsStore.resetAiCreateState();
    nextTick(() => aiInputRef.value?.focus());
  }
}

async function handleAiCreate(): Promise<void> {
  const req = aiRequirement.value.trim();
  if (!req || skillsStore.aiCreating) return;
  const ok = await skillsStore.aiCreateSkill(req);
  if (ok) {
    showCreateArea.value = false;
    aiRequirement.value = '';
  }
}

function openImportDialog(): void {
  showImportDialog.value = true;
  importPath.value = '';
  skillsStore.importError = null;
}

async function handleImport(): Promise<void> {
  const p = importPath.value.trim();
  if (!p || skillsStore.importing) return;
  const ok = await skillsStore.importSkill(p);
  if (ok) {
    showImportDialog.value = false;
    importPath.value = '';
  }
}

async function handleDelete(skillName: string): Promise<void> {
  const confirmed = await confirmStore.warning(`确定要删除技能「${skillName}」吗？此操作不可恢复。`, {
    title: '删除技能',
    confirmText: '删除',
    cancelText: '取消'
  });
  if (confirmed) {
    await skillsStore.deleteSkill(skillName);
  }
}

function stepIcon(step: string): string {
  switch (step) {
    case 'analyzing':
      return 'i-carbon-analytics';
    case 'generating':
      return 'i-carbon-watson';
    case 'writing':
      return 'i-carbon-document-add';
    case 'done':
      return 'i-carbon-checkmark-filled';
    case 'error':
      return 'i-carbon-warning-alt';
    default:
      return 'i-carbon-circle-dash';
  }
}
</script>

<template>
  <div class="skills-view">
    <!-- 顶栏 -->
    <header class="header">
      <div class="header-left">
        <div class="header-icon">
          <span class="i-carbon-skill-level-advanced inline-block h-4 w-4" />
        </div>
        <h1 class="header-title">技能市场</h1>
        <span v-if="skillsStore.skillCount > 0" class="header-count">
          {{ skillsStore.skillCount }}
        </span>
      </div>
      <div class="header-right">
        <GhostButton
          size="sm"
          mode="icon"
          icon="i-carbon-renew"
          :loading="skillsStore.loading"
          @click="skillsStore.fetchSkills()" />
        <SecondaryButton size="sm" left-icon="i-carbon-download" @click="openImportDialog"> 导入 </SecondaryButton>
        <PrimaryButton size="sm" left-icon="i-carbon-add" @click="toggleCreateArea"> 创建 </PrimaryButton>
      </div>
    </header>

    <!-- AI 创建区域 -->
    <Transition name="slide-down">
      <div v-if="showCreateArea" class="create-section">
        <div class="create-card" :class="{ focused: skillsStore.aiCreating }">
          <div class="create-card-header">
            <span class="i-carbon-watson inline-block h-4 w-4 text-primary" />
            <span class="text-xs font-medium text-primary tracking-wide">AI 自动创建</span>
          </div>
          <textarea
            ref="aiInputRef"
            v-model="aiRequirement"
            placeholder="描述你想要的技能...&#10;例如：一个 Docker 容器化部署指南，包含 Dockerfile 编写和 CI/CD 配置步骤"
            rows="2"
            class="create-input"
            :disabled="skillsStore.aiCreating"
            @keydown.meta.enter="handleAiCreate"
            @keydown.ctrl.enter="handleAiCreate" />

          <!-- AI 创建进度 -->
          <div v-if="skillsStore.aiCreateSteps.length > 0" class="create-progress">
            <div
              v-for="(progress, idx) in skillsStore.aiCreateSteps"
              :key="idx"
              class="progress-step"
              :class="{
                active: skillsStore.aiCreateCurrentStep === progress.step,
                done: progress.step === 'done',
                error: progress.step === 'error'
              }">
              <span :class="stepIcon(progress.step)" class="inline-block h-3.5 w-3.5 shrink-0 progress-icon" />
              <div class="progress-text">
                <span class="progress-msg">{{ progress.message }}</span>
                <span v-if="progress.detail" class="progress-detail">{{ progress.detail }}</span>
              </div>
            </div>
          </div>

          <div class="create-card-footer">
            <div class="create-footer-left">
              <span v-if="skillsStore.aiCreateError" class="create-error">
                <span class="i-carbon-warning-alt inline-block h-3 w-3 shrink-0" />
                {{ skillsStore.aiCreateError }}
              </span>
              <span v-else-if="!skillsStore.aiCreating" class="create-tip">
                <kbd>{{ isMac ? '⌘' : 'Ctrl' }}</kbd>
                <kbd>↵</kbd>
                发送
              </span>
              <span v-else class="create-tip">
                <span class="i-carbon-renew inline-block h-3 w-3 animate-spin" />
                处理中...
              </span>
            </div>
            <div class="flex items-center gap-2">
              <TextButton :disabled="skillsStore.aiCreating" @click="showCreateArea = false"> 取消 </TextButton>
              <PrimaryButton
                size="sm"
                mode="icon"
                :icon="skillsStore.aiCreating ? 'i-carbon-renew' : 'i-carbon-send-filled'"
                :loading="skillsStore.aiCreating"
                :disabled="!aiRequirement.trim()"
                @click="handleAiCreate" />
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 内容区域 -->
    <div class="content">
      <!-- 错误 -->
      <div v-if="skillsStore.error" class="error-bar">
        <span class="i-carbon-warning-alt inline-block h-3.5 w-3.5 shrink-0" />
        <span class="flex-1 truncate">{{ skillsStore.error }}</span>
        <TextButton @click="skillsStore.fetchSkills()">重试</TextButton>
      </div>

      <!-- 加载中 -->
      <div v-if="skillsStore.loading && skillsStore.skills.length === 0" class="empty-state">
        <div class="empty-spinner">
          <span class="i-carbon-renew inline-block h-5 w-5 animate-spin" />
        </div>
        <p class="empty-label">加载中...</p>
      </div>

      <!-- 空状态 -->
      <div v-else-if="skillsStore.skills.length === 0 && !skillsStore.loading" class="empty-state">
        <div class="empty-visual">
          <div class="empty-circle">
            <span class="i-carbon-skill-level-advanced inline-block h-7 w-7" />
          </div>
          <div class="empty-orbit" />
        </div>
        <p class="empty-heading">还没有技能</p>
        <p class="empty-sub">创建或导入技能，让你的智能体拥有更强的专业能力</p>
        <div class="mt-5 flex items-center gap-3">
          <SecondaryButton left-icon="i-carbon-download" @click="openImportDialog"> 导入技能 </SecondaryButton>
          <PrimaryButton left-icon="i-carbon-watson" @click="toggleCreateArea"> AI 创建 </PrimaryButton>
        </div>
      </div>

      <!-- 技能列表 -->
      <div v-else class="skill-grid">
        <div v-for="skill in skillsStore.skills" :key="skill.name" class="skill-card">
          <!-- 卡片头部 -->
          <div class="card-header">
            <div class="card-avatar">
              <span class="i-carbon-skill-level-advanced inline-block h-5 w-5" />
            </div>
            <div class="card-title-area">
              <span class="card-name">{{ skill.name }}</span>
              <span v-if="skill.source === 'builtin'" class="card-badge builtin">内置</span>
              <span v-else-if="skill.source === 'user'" class="card-badge user">自定义</span>
            </div>
          </div>

          <!-- 描述 -->
          <p class="card-desc">{{ skill.description || '暂无描述' }}</p>

          <!-- 底部操作栏 -->
          <div class="card-footer" @click.stop>
            <div class="card-actions">
              <GhostButton
                v-if="skill.source === 'user'"
                size="sm"
                mode="icon"
                icon="i-carbon-trash-can"
                @click="handleDelete(skill.name)" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 导入弹窗 -->
    <Popup v-model:visible="showImportDialog" position="center" transition="zoom" :close-on-esc="true">
      <div class="import-dialog">
        <div class="dialog-header">
          <span class="i-carbon-download inline-block h-4 w-4" />
          <span>导入技能</span>
        </div>
        <div class="dialog-body">
          <TextInput
            v-model="importPath"
            label="技能路径"
            placeholder="/path/to/my-skill/ 或 /path/to/SKILL.md"
            :disabled="skillsStore.importing"
            :error="skillsStore.importError ?? undefined"
            help="支持包含 SKILL.md 的目录路径，或单独的 SKILL.md 文件路径"
            @keydown.enter="handleImport" />
        </div>
        <div class="dialog-footer">
          <GhostButton size="sm" @click="showImportDialog = false">取消</GhostButton>
          <PrimaryButton
            size="sm"
            :disabled="!importPath.trim()"
            :loading="skillsStore.importing"
            @click="handleImport">
            导入
          </PrimaryButton>
        </div>
      </div>
    </Popup>
  </div>
</template>

<style scoped>
/* ====== 根容器 ====== */

.skills-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  width: 100%;
  background: hsl(var(--background));
}

/* ====== 顶栏 ====== */

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 42px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid hsl(var(--border) / 0.3);
  background: hsl(var(--surface) / 0.6);
  backdrop-filter: blur(12px);
}

.header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 6px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: hsl(var(--foreground));
  letter-spacing: -0.01em;
}

.header-count {
  font-size: 11px;
  font-weight: 500;
  padding: 1px 7px;
  border-radius: 10px;
  background: hsl(var(--foreground) / 0.06);
  color: hsl(var(--muted-foreground));
}

.header-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

/* ====== AI 创建区域 ====== */

.slide-down-enter-active,
.slide-down-leave-active {
  transition: all 0.2s ease;
  overflow: hidden;
}

.slide-down-enter-from,
.slide-down-leave-to {
  opacity: 0;
  max-height: 0;
  padding-top: 0;
  padding-bottom: 0;
}

.slide-down-enter-to,
.slide-down-leave-from {
  opacity: 1;
  max-height: 200px;
}

.create-section {
  padding: 14px 20px;
  border-bottom: 1px solid hsl(var(--border) / 0.2);
  background: hsl(var(--surface) / 0.3);
}

.create-card {
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: 12px;
  background: hsl(var(--surface));
  overflow: hidden;
  transition: all 0.2s ease;
  box-shadow: 0 1px 3px hsl(var(--shadow) / 0.04);
}

.create-card:focus-within {
  border-color: hsl(var(--primary) / 0.3);
  box-shadow:
    0 0 0 3px hsl(var(--primary) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
}

.create-card.focused {
  border-color: hsl(var(--primary) / 0.25);
}

.create-card-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px 0;
}

.create-input {
  width: 100%;
  padding: 8px 14px 10px;
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground));
  background: transparent;
  border: none;
  outline: none;
  resize: none;
}

.create-input::placeholder {
  color: hsl(var(--muted-foreground) / 0.35);
}

.create-input:disabled {
  opacity: 0.5;
}

.create-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
  background: hsl(var(--background) / 0.4);
}

.create-footer-left {
  display: flex;
  align-items: center;
  gap: 6px;
}

.create-tip {
  display: flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
}

.create-tip kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: 4px;
  font-size: 10px;
  font-family: var(--font-family-mono);
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.5);
  border: 1px solid hsl(var(--border) / 0.3);
}

.create-error {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: hsl(var(--error));
  max-width: 320px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ====== AI 创建进度 ====== */

.create-progress {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 6px 14px 8px;
  border-top: 1px solid hsl(var(--border) / 0.1);
}

.progress-step {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.5);
  transition: color 0.2s ease;
}

.progress-step.active {
  color: hsl(var(--primary));
}

.progress-step.done {
  color: hsl(var(--success));
}

.progress-step.error {
  color: hsl(var(--error));
}

.progress-icon {
  margin-top: 1px;
}

.progress-step.active .progress-icon {
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.4;
  }
}

.progress-text {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.progress-msg {
  font-weight: 500;
  line-height: 1.3;
}

.progress-detail {
  font-size: 11px;
  color: hsl(var(--muted-foreground) / 0.4);
  line-height: 1.3;
}

/* ====== 内容区 ====== */

.content {
  flex: 1;
  overflow-y: auto;
  padding: 16px 20px;
}

/* ====== 错误横幅 ====== */

.error-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  margin-bottom: 12px;
  border-radius: 8px;
  font-size: 12px;
  color: hsl(var(--error));
  background: hsl(var(--error) / 0.06);
  border: 1px solid hsl(var(--error) / 0.1);
}

/* ====== 空状态 ====== */

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding-top: 10vh;
  text-align: center;
}

.empty-spinner {
  color: hsl(var(--muted-foreground) / 0.25);
  margin-bottom: 12px;
}

.empty-label {
  font-size: 13px;
  color: hsl(var(--muted-foreground) / 0.5);
}

.empty-visual {
  position: relative;
  width: 80px;
  height: 80px;
  margin-bottom: 24px;
}

.empty-circle {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.06);
  color: hsl(var(--primary) / 0.35);
  z-index: 1;
}

.empty-orbit {
  position: absolute;
  inset: -8px;
  border-radius: 50%;
  border: 1.5px dashed hsl(var(--primary) / 0.12);
  animation: orbit-spin 20s linear infinite;
}

@keyframes orbit-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.empty-heading {
  font-size: 15px;
  font-weight: 600;
  color: hsl(var(--foreground) / 0.7);
  margin-bottom: 6px;
}

.empty-sub {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.55);
  line-height: 1.6;
  max-width: 280px;
}

/* ====== 技能卡片网格 ====== */

.skill-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
}

.skill-card {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid hsl(var(--border) / 0.35);
  background: hsl(var(--surface) / 0.6);
  transition: all 0.2s ease;
}

.skill-card:hover {
  background: hsl(var(--surface));
  border-color: hsl(var(--border) / 0.6);
  box-shadow:
    0 2px 8px hsl(var(--shadow) / 0.06),
    0 1px 3px hsl(var(--shadow) / 0.04);
  transform: translateY(-1px);
}

/* 卡片头部 */

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 10px;
}

.card-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  background: linear-gradient(135deg, hsl(var(--primary) / 0.08), hsl(var(--primary) / 0.15));
  color: hsl(var(--primary) / 0.6);
  transition: all 0.2s ease;
}

.skill-card:hover .card-avatar {
  color: hsl(var(--primary) / 0.8);
  background: linear-gradient(135deg, hsl(var(--primary) / 0.1), hsl(var(--primary) / 0.2));
}

.card-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.card-name {
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.3;
}

.card-badge {
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 4px;
  font-weight: 500;
  white-space: nowrap;
  flex-shrink: 0;
}

.card-badge.builtin {
  background: hsl(var(--foreground) / 0.05);
  color: hsl(var(--muted-foreground) / 0.55);
}

.card-badge.user {
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary) / 0.7);
}

/* 描述 */

.card-desc {
  font-size: 12.5px;
  color: hsl(var(--muted-foreground) / 0.6);
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
  margin-bottom: 10px;
  flex: 1;
}

/* 卡片底部操作栏 */

.card-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid hsl(var(--border) / 0.15);
  min-height: 28px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.skill-card:hover .card-actions {
  opacity: 1;
}

/* ====== 导入弹窗 ====== */

.import-dialog {
  width: 420px;
  border-radius: 14px;
  background: hsl(var(--surface));
  border: 1px solid hsl(var(--border) / 0.5);
  box-shadow:
    0 8px 32px hsl(var(--shadow) / 0.15),
    0 2px 8px hsl(var(--shadow) / 0.08);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px 20px 12px;
  font-size: 14px;
  font-weight: 600;
  color: hsl(var(--foreground));
  border-bottom: 1px solid hsl(var(--border) / 0.25);
}

.dialog-body {
  padding: 16px 20px;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 20px;
  border-top: 1px solid hsl(var(--border) / 0.25);
}
</style>

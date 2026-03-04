<template>
  <div class="agent-designer">
    <div class="designer-header">
      <h2 class="text-2xl font-bold">可视化 Agent 设计器</h2>
      <div class="flex gap-2">
        <button @click="saveAgent" class="btn-primary">保存 Agent</button>
        <button @click="testAgent" class="btn-secondary">测试运行</button>
        <button @click="resetDesigner" class="btn-ghost">重置</button>
      </div>
    </div>

    <div class="designer-content">
      <!-- 左侧：设计画布 -->
      <div class="canvas-panel">
        <h3 class="section-title">Agent 配置</h3>

        <div class="form-section">
          <label>Agent 名称</label>
          <input v-model="agentConfig.name" type="text" placeholder="例如：代码审查专家" class="input-field" />
        </div>

        <div class="form-section">
          <label>描述</label>
          <textarea v-model="agentConfig.description" placeholder="简要描述 Agent 的职责..." rows="3" class="input-field"></textarea>
        </div>

        <div class="form-section">
          <label>模型选择</label>
          <select v-model="agentConfig.model" class="input-field">
            <option value="gpt-4">GPT-4</option>
            <option value="claude-3-opus">Claude 3 Opus</option>
            <option value="gemini-pro">Gemini Pro</option>
          </select>
        </div>

        <div class="form-section">
          <label>系统提示词</label>
          <textarea v-model="agentConfig.systemPrompt" placeholder="你是一个..." rows="6" class="input-field"></textarea>
        </div>

        <div class="form-section">
          <label>工具权限</label>
          <div class="tool-checkboxes">
            <label v-for="tool in availableTools" :key="tool.id" class="checkbox-label">
              <input type="checkbox" :value="tool.id" v-model="agentConfig.tools" />
              <span>{{ tool.name }}</span>
            </label>
          </div>
        </div>

        <div class="form-section">
          <label>技能包</label>
          <div class="skill-selector">
            <select v-model="selectedSkill" class="input-field mb-2">
              <option value="">-- 选择技能包 --</option>
              <option v-for="skill in availableSkills" :key="skill.id" :value="skill.id">
                {{ skill.name }}
              </option>
            </select>
            <button @click="addSkill" class="btn-sm">添加</button>
          </div>
          <div class="selected-skills">
            <span v-for="skillId in agentConfig.skills" :key="skillId" class="skill-tag">
              {{ getSkillName(skillId) }}
              <button @click="removeSkill(skillId)" class="remove-btn">×</button>
            </span>
          </div>
        </div>
      </div>

      <!-- 右侧：预览和测试 -->
      <div class="preview-panel">
        <h3 class="section-title">预览与测试</h3>

        <div class="preview-box">
          <h4 class="font-semibold mb-2">Agent 配置预览</h4>
          <pre class="config-preview">{{ configPreview }}</pre>
        </div>

        <div class="test-box">
          <h4 class="font-semibold mb-2">测试对话</h4>
          <div class="test-messages" ref="testMessages">
            <div v-for="msg in testMessages" :key="msg.id" :class="['test-message', msg.role]">
              <span class="role-label">{{ msg.role }}:</span>
              <span class="message-content">{{ msg.content }}</span>
            </div>
          </div>
          <div class="test-input-area">
            <input
              v-model="testInput"
              @keypress.enter="sendTestMessage"
              type="text"
              placeholder="输入测试消息..."
              class="input-field"
            />
            <button @click="sendTestMessage" class="btn-sm">发送</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';

interface AgentConfig {
  name: string;
  description: string;
  model: string;
  systemPrompt: string;
  tools: string[];
  skills: string[];
}

interface Tool {
  id: string;
  name: string;
}

interface Skill {
  id: string;
  name: string;
}

interface TestMessage {
  id: string;
  role: 'user' | 'agent';
  content: string;
}

const agentConfig = ref<AgentConfig>({
  name: '',
  description: '',
  model: 'gpt-4',
  systemPrompt: '',
  tools: [],
  skills: []
});

const availableTools = ref<Tool[]>([
  { id: 'file-read', name: '文件读取' },
  { id: 'file-write', name: '文件写入' },
  { id: 'shell-exec', name: '命令执行' },
  { id: 'web-search', name: '网络搜索' },
  { id: 'code-analysis', name: '代码分析' }
]);

const availableSkills = ref<Skill[]>([
  { id: 'gitea', name: 'Gitea 集成' },
  { id: 'github-integration', name: 'GitHub 集成' },
  { id: 'observability', name: '系统可观测' },
  { id: 'config-manager', name: '配置管理' }
]);

const selectedSkill = ref('');
const testInput = ref('');
const testMessages = ref<TestMessage[]>([]);

const configPreview = computed(() => {
  return JSON.stringify(agentConfig.value, null, 2);
});

function addSkill() {
  if (selectedSkill.value && !agentConfig.value.skills.includes(selectedSkill.value)) {
    agentConfig.value.skills.push(selectedSkill.value);
    selectedSkill.value = '';
  }
}

function removeSkill(skillId: string) {
  agentConfig.value.skills = agentConfig.value.skills.filter((s) => s !== skillId);
}

function getSkillName(skillId: string): string {
  return availableSkills.value.find((s) => s.id === skillId)?.name || skillId;
}

function saveAgent() {
  console.log('Saving agent:', agentConfig.value);
  alert('Agent 配置已保存！（实际功能待实现）');
}

function testAgent() {
  if (!agentConfig.value.name) {
    alert('请先填写 Agent 名称');
    return;
  }

  testMessages.value.push({
    id: `msg-${Date.now()}`,
    role: 'agent',
    content: `${agentConfig.value.name} 已就绪，可以开始测试对话。`
  });
}

function sendTestMessage() {
  if (!testInput.value.trim()) return;

  testMessages.value.push({
    id: `msg-${Date.now()}`,
    role: 'user',
    content: testInput.value
  });

  setTimeout(() => {
    testMessages.value.push({
      id: `msg-${Date.now()}`,
      role: 'agent',
      content: `收到消息："${testInput.value}"。这是一个测试响应。`
    });
  }, 500);

  testInput.value = '';
}

function resetDesigner() {
  if (confirm('确定要重置所有配置吗？')) {
    agentConfig.value = {
      name: '',
      description: '',
      model: 'gpt-4',
      systemPrompt: '',
      tools: [],
      skills: []
    };
    testMessages.value = [];
  }
}
</script>

<style scoped>
.agent-designer {
  @apply flex flex-col h-full p-6 bg-gray-50 dark:bg-gray-900;
}

.designer-header {
  @apply flex justify-between items-center mb-6 pb-4 border-b border-gray-200 dark:border-gray-700;
}

.designer-content {
  @apply flex gap-6 flex-1 overflow-hidden;
}

.canvas-panel {
  @apply flex-1 bg-white dark:bg-gray-800 rounded-lg p-6 overflow-y-auto;
}

.preview-panel {
  @apply w-96 bg-white dark:bg-gray-800 rounded-lg p-6 overflow-y-auto;
}

.section-title {
  @apply text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200;
}

.form-section {
  @apply mb-6;
}

.form-section label {
  @apply block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300;
}

.input-field {
  @apply w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md
  bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
  focus:outline-none focus:ring-2 focus:ring-blue-500;
}

.tool-checkboxes {
  @apply space-y-2;
}

.checkbox-label {
  @apply flex items-center gap-2 cursor-pointer;
}

.checkbox-label input[type='checkbox'] {
  @apply w-4 h-4;
}

.skill-selector {
  @apply flex gap-2;
}

.selected-skills {
  @apply flex flex-wrap gap-2 mt-2;
}

.skill-tag {
  @apply inline-flex items-center gap-1 px-3 py-1 bg-blue-100 dark:bg-blue-900
  text-blue-800 dark:text-blue-200 rounded-full text-sm;
}

.remove-btn {
  @apply text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200
  font-bold text-lg leading-none;
}

.preview-box {
  @apply mb-6 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg;
}

.config-preview {
  @apply text-xs text-gray-700 dark:text-gray-300 overflow-x-auto;
}

.test-box {
  @apply p-4 bg-gray-50 dark:bg-gray-900 rounded-lg;
}

.test-messages {
  @apply h-64 overflow-y-auto mb-4 space-y-2;
}

.test-message {
  @apply p-2 rounded;
}

.test-message.user {
  @apply bg-blue-100 dark:bg-blue-900;
}

.test-message.agent {
  @apply bg-gray-200 dark:bg-gray-700;
}

.role-label {
  @apply font-semibold mr-2;
}

.test-input-area {
  @apply flex gap-2;
}

.btn-primary {
  @apply px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700
  transition-colors;
}

.btn-secondary {
  @apply px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700
  transition-colors;
}

.btn-ghost {
  @apply px-4 py-2 bg-transparent text-gray-600 dark:text-gray-400
  border border-gray-300 dark:border-gray-600 rounded-md
  hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors;
}

.btn-sm {
  @apply px-3 py-1 bg-blue-600 text-white text-sm rounded-md
  hover:bg-blue-700 transition-colors;
}
</style>

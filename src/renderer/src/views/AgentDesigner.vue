<template>
  <div class="agent-designer">
    <div class="designer-header">
      <h2 class="text-2xl font-bold">可视化 Agent 设计器</h2>
      <div class="flex gap-2">
        <button class="btn-primary" @click="saveAgent">保存 Agent</button>
        <button class="btn-secondary" @click="testAgent">测试运行</button>
        <button class="btn-ghost" @click="resetDesigner">重置</button>
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
          <textarea
            v-model="agentConfig.description"
            placeholder="简要描述 Agent 的职责..."
            rows="3"
            class="input-field"></textarea>
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
          <textarea
            v-model="agentConfig.systemPrompt"
            placeholder="你是一个..."
            rows="6"
            class="input-field"></textarea>
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
            <button class="btn-sm" @click="addSkill">添加</button>
          </div>
          <div class="selected-skills">
            <span v-for="skillId in agentConfig.skills" :key="skillId" class="skill-tag">
              {{ getSkillName(skillId) }}
              <button class="remove-btn" @click="removeSkill(skillId)">×</button>
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
          <div ref="testMessages" class="test-messages">
            <div v-for="msg in testMessages" :key="msg.id" :class="['test-message', msg.role]">
              <span class="role-label">{{ msg.role }}:</span>
              <span class="message-content">{{ msg.content }}</span>
            </div>
          </div>
          <div class="test-input-area">
            <input
              v-model="testInput"
              type="text"
              placeholder="输入测试消息..."
              class="input-field"
              @keypress.enter="sendTestMessage" />
            <button class="btn-sm" @click="sendTestMessage">发送</button>
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
  skills: string[];
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
  skills: []
});

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

function addSkill(): void {
  if (selectedSkill.value && !agentConfig.value.skills.includes(selectedSkill.value)) {
    agentConfig.value.skills.push(selectedSkill.value);
    selectedSkill.value = '';
  }
}

function removeSkill(skillId: string): void {
  agentConfig.value.skills = agentConfig.value.skills.filter((s) => s !== skillId);
}

function getSkillName(skillId: string): string {
  return availableSkills.value.find((s) => s.id === skillId)?.name || skillId;
}

function saveAgent(): void {
  console.log('Saving agent:', agentConfig.value);
  alert('Agent 配置已保存！（实际功能待实现）');
}

function testAgent(): void {
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

function sendTestMessage(): void {
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

function resetDesigner(): void {
  if (confirm('确定要重置所有配置吗？')) {
    agentConfig.value = {
      name: '',
      description: '',
      model: 'gpt-4',
      systemPrompt: '',
      skills: []
    };
    testMessages.value = [];
  }
}
</script>

<style scoped>
.agent-designer {
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 24px;
  background: hsl(var(--background));
}

.designer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 24px;
  padding-bottom: 16px;
  border-bottom: 1px solid hsl(var(--border));
}

.designer-content {
  display: flex;
  gap: 24px;
  flex: 1;
  overflow: hidden;
}

.canvas-panel {
  flex: 1;
  background: hsl(var(--card));
  border-radius: 8px;
  padding: 24px;
  overflow-y: auto;
  border: 1px solid hsl(var(--border));
}

.preview-panel {
  width: 384px;
  background: hsl(var(--card));
  border-radius: 8px;
  padding: 24px;
  overflow-y: auto;
  border: 1px solid hsl(var(--border));
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 16px;
  color: hsl(var(--foreground));
}

.form-section {
  margin-bottom: 24px;
}

.form-section label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 8px;
  color: hsl(var(--foreground));
}

.input-field {
  width: 100%;
  padding: 8px 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  font-family: inherit;
  transition: all 0.15s ease;
}

.input-field:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 3px hsl(var(--primary) / 0.1);
}

.skill-selector {
  display: flex;
  gap: 8px;
}

.selected-skills {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.skill-tag {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 12px;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  border-radius: 16px;
  font-size: 12px;
}

.skill-tag .remove-btn {
  color: hsl(var(--primary));
  font-weight: bold;
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.skill-tag .remove-btn:hover {
  opacity: 0.7;
}

.preview-box {
  margin-bottom: 24px;
  padding: 16px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 8px;
}

.config-preview {
  font-size: 11px;
  color: hsl(var(--foreground) / 0.8);
  overflow-x: auto;
  font-family: 'Monaco', 'Menlo', monospace;
}

.test-box {
  padding: 16px;
  background: hsl(var(--muted) / 0.3);
  border-radius: 8px;
}

.test-messages {
  height: 256px;
  overflow-y: auto;
  margin-bottom: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.test-message {
  padding: 8px;
  border-radius: 6px;
  font-size: 13px;
}

.test-message.user {
  background: hsl(var(--primary) / 0.1);
}

.test-message.agent {
  background: hsl(var(--muted));
}

.role-label {
  font-weight: 600;
  margin-right: 8px;
}

.test-input-area {
  display: flex;
  gap: 8px;
}

.btn-primary {
  padding: 8px 16px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-primary:hover {
  background: hsl(var(--primary) / 0.9);
}

.btn-secondary {
  padding: 8px 16px;
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-secondary:hover {
  background: hsl(var(--muted) / 0.8);
}

.btn-ghost {
  padding: 8px 16px;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border: 1px solid hsl(var(--border));
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  transition: all 0.15s ease;
}

.btn-ghost:hover {
  background: hsl(var(--foreground) / 0.05);
}

.btn-sm {
  padding: 6px 12px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  font-size: 12px;
  border-radius: 6px;
  transition: all 0.15s ease;
}

.btn-sm:hover {
  background: hsl(var(--primary) / 0.9);
}
</style>

<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { employeeApi, type DigitalEmployee } from '@/api/employee';
const employees = ref<DigitalEmployee[]>([]);
const loading = ref(false);
const showCreateDialog = ref(false);
const showEditDialog = ref(false);

// 表单数据
const form = ref({
  id: '',
  name: '',
  role: '',
  description: '',
  persona: ''
});

const loadEmployees = async (): Promise<void> => {
  loading.value = true;
  try {
    employees.value = await employeeApi.listEmployees();
  } catch (error) {
    console.error('Failed to load employees:', error);
  } finally {
    loading.value = false;
  }
};

const handleCreate = async (): Promise<void> => {
  try {
    await employeeApi.createEmployee({
      name: form.value.name,
      role: form.value.role,
      description: form.value.description,
      persona: form.value.persona,
      voice: { provider: 'local', speed: 1.0, pitch: 1.0 }
    });
    showCreateDialog.value = false;
    await loadEmployees();
    resetForm();
  } catch (error) {
    console.error('Failed to create employee:', error);
  }
};

const handleEdit = (employee: DigitalEmployee): void => {
  form.value = {
    id: employee.id,
    name: employee.name,
    role: employee.role,
    description: employee.description || '',
    persona: employee.persona
  };
  showEditDialog.value = true;
};

const handleUpdate = async (): Promise<void> => {
  if (!form.value.id) return;
  try {
    await employeeApi.updateEmployee(form.value.id, {
      name: form.value.name,
      role: form.value.role,
      description: form.value.description,
      persona: form.value.persona,
      voice: { provider: 'local', speed: 1.0, pitch: 1.0 }
    });
    showEditDialog.value = false;
    await loadEmployees();
    resetForm();
  } catch (error) {
    console.error('Failed to update employee:', error);
  }
};

const handleDelete = async (id: string): Promise<void> => {
  if (!confirm('确定要解雇这位数字员工吗？此操作不可恢复。')) return;
  try {
    await employeeApi.deleteEmployee(id);
    await loadEmployees();
  } catch (error) {
    console.error('Failed to delete employee:', error);
  }
};

const resetForm = (): void => {
  form.value = {
    id: '',
    name: '',
    role: '',
    description: '',
    persona: ''
  };
};

onMounted(() => {
  loadEmployees();
});
</script>

<template>
  <div class="employee-view">
    <!-- Header -->
    <header class="header">
      <div class="header-left">
        <h1 class="title">数字员工</h1>
        <span class="subtitle">管理您的 AI 虚拟团队</span>
      </div>
      <button class="btn-primary" @click="showCreateDialog = true">
        <span class="i-carbon-add inline-block h-4 w-4" />
        <span>入职新员工</span>
      </button>
    </header>

    <!-- Content -->
    <div class="content">
      <div v-if="loading" class="loading-state">
        <span class="i-carbon-renew animate-spin h-6 w-6 opacity-50" />
      </div>

      <div v-else-if="employees.length === 0" class="empty-state">
        <div class="empty-icon">
          <span class="i-carbon-user-avatar h-12 w-12" />
        </div>
        <h3>暂无数字员工</h3>
        <p>创建您的第一位 AI 员工，开始自动化工作流程</p>
        <button class="btn-secondary mt-4" @click="showCreateDialog = true"> 创建员工 </button>
      </div>

      <div v-else class="employee-grid">
        <div v-for="emp in employees" :key="emp.id" class="employee-card">
          <div class="card-header">
            <div class="avatar-placeholder">
              <span class="i-carbon-user-avatar h-8 w-8" />
            </div>
            <div class="card-title">
              <h3>{{ emp.name }}</h3>
              <span class="role-badge">{{ emp.role }}</span>
            </div>
            <div class="card-actions">
              <button class="icon-btn" title="编辑" @click="handleEdit(emp)">
                <span class="i-carbon-edit h-4 w-4" />
              </button>
              <button class="icon-btn danger" title="删除" @click="handleDelete(emp.id)">
                <span class="i-carbon-trash-can h-4 w-4" />
              </button>
            </div>
          </div>
          <p class="card-desc">{{ emp.description || '暂无描述' }}</p>
          <div class="card-footer">
            <span class="date">{{ new Date(emp.updatedAt).toLocaleDateString() }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Dialogs -->
    <div v-if="showCreateDialog || showEditDialog" class="dialog-overlay">
      <div class="dialog">
        <div class="dialog-header">
          <h3>{{ showEditDialog ? '编辑员工信息' : '入职新员工' }}</h3>
          <button
            class="close-btn"
            @click="
              showCreateDialog = false;
              showEditDialog = false;
            ">
            <span class="i-carbon-close h-5 w-5" />
          </button>
        </div>

        <div class="dialog-body">
          <div class="form-group">
            <label>姓名</label>
            <input v-model="form.name" type="text" placeholder="例如：Alex" />
          </div>

          <div class="form-group">
            <label>职位/角色</label>
            <input v-model="form.role" type="text" placeholder="例如：高级分析师" />
          </div>

          <div class="form-group">
            <label>简介</label>
            <textarea v-model="form.description" rows="2" placeholder="简短描述这位员工的职责..."></textarea>
          </div>

          <div class="form-group">
            <label>人设 (System Prompt)</label>
            <textarea v-model="form.persona" rows="4" placeholder="你是一位专业的..."></textarea>
          </div>
        </div>

        <div class="dialog-footer">
          <button
            class="btn-text"
            @click="
              showCreateDialog = false;
              showEditDialog = false;
            "
            >取消</button
          >
          <button class="btn-primary" @click="showEditDialog ? handleUpdate() : handleCreate()">
            {{ showEditDialog ? '保存修改' : '确认入职' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.employee-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px 32px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.header-left {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.title {
  font-size: 24px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

.subtitle {
  font-size: 14px;
  color: hsl(var(--muted-foreground));
}

.content {
  flex: 1;
  overflow-y: auto;
  padding: 32px;
}

/* Grid */
.employee-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 24px;
}

.employee-card {
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.6);
  border-radius: 12px;
  padding: 20px;
  transition: all 0.2s ease;
}

.employee-card:hover {
  border-color: hsl(var(--primary) / 0.3);
  box-shadow: 0 4px 12px hsl(var(--shadow) / 0.05);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.avatar-placeholder {
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: hsl(var(--primary) / 0.1);
  color: hsl(var(--primary));
  display: flex;
  align-items: center;
  justify-content: center;
}

.card-title {
  flex: 1;
  min-width: 0;
}

.card-title h3 {
  font-size: 16px;
  font-weight: 600;
  margin-bottom: 2px;
}

.role-badge {
  display: inline-block;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
}

.card-actions {
  display: flex;
  gap: 4px;
  opacity: 0; /* Hover to show */
  transition: opacity 0.2s;
}

.employee-card:hover .card-actions {
  opacity: 1;
}

.icon-btn {
  padding: 6px;
  border-radius: 6px;
  color: hsl(var(--muted-foreground));
  transition: all 0.15s;
}

.icon-btn:hover {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
}

.icon-btn.danger:hover {
  background: hsl(0 84% 60% / 0.1);
  color: hsl(0 84% 60%);
}

.card-desc {
  font-size: 13px;
  color: hsl(var(--muted-foreground));
  line-height: 1.5;
  margin-bottom: 16px;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: hsl(var(--muted-foreground) / 0.7);
}

.voice-tag {
  display: flex;
  align-items: center;
  gap: 4px;
}

/* Empty State */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 64px 0;
  color: hsl(var(--muted-foreground));
}

.empty-icon {
  width: 64px;
  height: 64px;
  border-radius: 50%;
  background: hsl(var(--muted) / 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 16px;
  color: hsl(var(--muted-foreground) / 0.5);
}

/* Dialog */
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: hsl(var(--background) / 0.8);
  backdrop-filter: blur(4px);
  z-index: 50;
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  width: 500px;
  background: hsl(var(--card));
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  box-shadow: 0 12px 32px hsl(var(--shadow) / 0.2);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid hsl(var(--border) / 0.5);
}

.dialog-header h3 {
  font-weight: 600;
}

.dialog-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
}

.form-group input,
.form-group textarea,
.form-group select {
  padding: 8px 12px;
  border-radius: 6px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-size: 13px;
  transition: border-color 0.15s;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 2px hsl(var(--primary) / 0.1);
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid hsl(var(--border) / 0.5);
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

/* Buttons */
.btn-primary {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: hsl(var(--primary));
  color: hsl(var(--primary-foreground));
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
  transition: opacity 0.15s;
}

.btn-primary:hover {
  opacity: 0.9;
}

.btn-secondary {
  padding: 8px 16px;
  background: hsl(var(--secondary));
  color: hsl(var(--secondary-foreground));
  border-radius: 6px;
  font-weight: 500;
  font-size: 13px;
}

.btn-text {
  padding: 8px 16px;
  color: hsl(var(--muted-foreground));
  font-size: 13px;
  font-weight: 500;
}

.btn-text:hover {
  color: hsl(var(--foreground));
}

.close-btn {
  color: hsl(var(--muted-foreground));
  padding: 4px;
  border-radius: 4px;
}

.close-btn:hover {
  background: hsl(var(--secondary));
  color: hsl(var(--foreground));
}
</style>

<script setup lang="ts">
/**
 * GroupChatView — 普通群聊视图
 *
 * 用户通过 @mention 触发 Agent 回复，支持多 Agent 参与的自由群聊。
 */
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'vue';
import * as groupchatApi from '@/api/groupchat';
import { useAgentsStore } from '@/stores/agents';
import { gateway } from '@/plugins/gatewaySetup';
import type { DiscussionSession, DiscussionMessage, DiscussionParticipant } from '@shared/types/discussion';

const agentsStore = useAgentsStore();

// ==================== State ====================

const chats = ref<DiscussionSession[]>([]);
const selectedChat = ref<DiscussionSession | null>(null);
const inputText = ref('');
const sending = ref(false);
const showCreateDialog = ref(false);
const typingAgents = ref<Set<string>>(new Set());

const newTopic = ref('');
const selectedAgentIds = ref<string[]>([]);
const showMentionPopup = ref(false);
const mentionFilter = ref('');
const chatBody = ref<HTMLElement | null>(null);

const availableAgents = computed(() => agentsStore.agents || []);

const filteredMentionAgents = computed(() => {
  if (!selectedChat.value) return [];
  const q = mentionFilter.value.toLowerCase();
  return selectedChat.value.participants.filter(
    (p) => p.name.toLowerCase().includes(q) || p.agentId.toLowerCase().includes(q)
  );
});

// ==================== Data Loading ====================

async function loadChats(): Promise<void> {
  try {
    chats.value = await groupchatApi.listGroupChats();
  } catch (err) {
    console.error('[GroupChat] Load failed:', err);
  }
}

async function selectChat(chat: DiscussionSession): Promise<void> {
  try {
    selectedChat.value = await groupchatApi.getGroupChat(chat.id);
    await nextTick();
    scrollToBottom();
  } catch (err) {
    console.error('[GroupChat] Select failed:', err);
  }
}

// ==================== Create ====================

function openCreateDialog(): void {
  newTopic.value = '';
  selectedAgentIds.value = [];
  showCreateDialog.value = true;
}

async function createChat(): Promise<void> {
  if (!newTopic.value.trim() || selectedAgentIds.value.length === 0) return;
  try {
    const participants: DiscussionParticipant[] = selectedAgentIds.value.map((id) => {
      const agent = availableAgents.value.find((a) => a.id === id);
      return {
        agentId: id,
        name: agent?.name || id,
        role: agent?.description,
        active: true
      };
    });

    const session = await groupchatApi.createGroupChat({
      topic: newTopic.value.trim(),
      participants
    });

    showCreateDialog.value = false;
    chats.value.unshift(session);
    selectedChat.value = session;
  } catch (err) {
    console.error('[GroupChat] Create failed:', err);
  }
}

// ==================== Messaging ====================

async function sendMessage(): Promise<void> {
  const text = inputText.value.trim();
  if (!text || !selectedChat.value || sending.value) return;

  sending.value = true;
  inputText.value = '';
  showMentionPopup.value = false;

  try {
    await groupchatApi.sendMessage(selectedChat.value.id, text);
  } catch (err) {
    console.error('[GroupChat] Send failed:', err);
  } finally {
    sending.value = false;
  }
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
    return;
  }
}

function handleInput(e: Event): void {
  const target = e.target as HTMLTextAreaElement;
  const text = target.value;
  const cursorPos = target.selectionStart;
  const beforeCursor = text.slice(0, cursorPos);
  const atMatch = beforeCursor.match(/@([\w\u4e00-\u9fff]*)$/);

  if (atMatch) {
    mentionFilter.value = atMatch[1];
    showMentionPopup.value = true;
  } else {
    showMentionPopup.value = false;
  }
}

function insertMention(participant: DiscussionParticipant): void {
  const text = inputText.value;
  const atMatch = text.match(/@([\w\u4e00-\u9fff]*)$/);
  if (atMatch) {
    inputText.value = text.slice(0, text.length - atMatch[0].length) + `@${participant.name} `;
  } else {
    inputText.value += `@${participant.name} `;
  }
  showMentionPopup.value = false;
}

// ==================== Actions ====================

async function endChat(): Promise<void> {
  if (!selectedChat.value) return;
  try {
    const updated = await groupchatApi.endGroupChat(selectedChat.value.id);
    selectedChat.value = updated;
    const idx = chats.value.findIndex((c) => c.id === updated.id);
    if (idx >= 0) chats.value[idx] = updated;
  } catch (err) {
    console.error('[GroupChat] End failed:', err);
  }
}

async function deleteChat(id: string): Promise<void> {
  try {
    await groupchatApi.deleteGroupChat(id);
    chats.value = chats.value.filter((c) => c.id !== id);
    if (selectedChat.value?.id === id) selectedChat.value = null;
  } catch (err) {
    console.error('[GroupChat] Delete failed:', err);
  }
}

// ==================== Helpers ====================

function getAgentName(agentId: string): string {
  if (agentId === '__user__') return '我';
  return selectedChat.value?.participants.find((p) => p.agentId === agentId)?.name || agentId;
}

function getAgentInitial(agentId: string): string {
  const name = getAgentName(agentId);
  return name.charAt(0).toUpperCase();
}

function isUserMessage(msg: DiscussionMessage): boolean {
  return msg.agentId === '__user__';
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
}

function scrollToBottom(): void {
  if (chatBody.value) {
    chatBody.value.scrollTop = chatBody.value.scrollHeight;
  }
}

function statusText(status: string): string {
  return status === 'active' ? '进行中' : status === 'paused' ? '已暂停' : status === 'completed' ? '已结束' : status;
}

// ==================== WebSocket Events ====================

function handleMessage(payload: unknown): void {
  const data = payload as { sessionId: string; message: DiscussionMessage };
  if (!data.sessionId || !data.message) return;

  const chat = chats.value.find((c) => c.id === data.sessionId);
  if (chat) {
    chat.messages.push(data.message);
    chat.updatedAt = data.message.timestamp;
  }

  if (selectedChat.value?.id === data.sessionId) {
    selectedChat.value = { ...selectedChat.value, messages: [...selectedChat.value.messages, data.message] };
    nextTick(scrollToBottom);
  }
}

function handleTyping(payload: unknown): void {
  const data = payload as { sessionId: string; agentId: string; typing: boolean };
  if (selectedChat.value?.id !== data.sessionId) return;

  if (data.typing) {
    typingAgents.value.add(data.agentId);
  } else {
    typingAgents.value.delete(data.agentId);
  }
  typingAgents.value = new Set(typingAgents.value);
}

function handleEnded(payload: unknown): void {
  const data = payload as { sessionId: string };
  const chat = chats.value.find((c) => c.id === data.sessionId);
  if (chat) chat.status = 'completed';
  if (selectedChat.value?.id === data.sessionId) {
    selectedChat.value = { ...selectedChat.value, status: 'completed' };
  }
}

let unsubMsg: (() => void) | null = null;
let unsubTyping: (() => void) | null = null;
let unsubEnded: (() => void) | null = null;

onMounted(async () => {
  await agentsStore.fetchAgents();
  await loadChats();
  unsubMsg = gateway.on('groupchat.message', handleMessage);
  unsubTyping = gateway.on('groupchat.typing', handleTyping);
  unsubEnded = gateway.on('groupchat.ended', handleEnded);
});

onBeforeUnmount(() => {
  unsubMsg?.();
  unsubTyping?.();
  unsubEnded?.();
});
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <!-- 顶栏 -->
    <div class="flex items-center justify-between border-b border-border bg-card px-6 py-4">
      <div class="flex items-center gap-3">
        <span class="i-carbon-group inline-block h-6 w-6 text-primary"></span>
        <div>
          <h1 class="text-lg font-semibold text-foreground">群聊</h1>
          <p class="text-xs text-muted-foreground">通过 @mention 与多个智能体自由对话</p>
        </div>
      </div>
      <button
        class="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        @click="openCreateDialog">
        <span class="i-carbon-add inline-block h-4 w-4"></span>
        创建群聊
      </button>
    </div>

    <div class="flex flex-1 overflow-hidden">
      <!-- 左侧：群聊列表 -->
      <div class="w-72 border-r border-border bg-card overflow-y-auto">
        <div class="p-3 space-y-1.5">
          <div
            v-for="chat in chats"
            :key="chat.id"
            class="group rounded-lg border border-border bg-background p-3 cursor-pointer hover:bg-muted transition-colors"
            :class="{ 'ring-2 ring-primary': selectedChat?.id === chat.id }"
            @click="selectChat(chat)">
            <div class="flex items-center justify-between">
              <h3 class="font-medium text-sm text-foreground line-clamp-1 flex-1">{{ chat.topic }}</h3>
              <button
                v-if="chat.status === 'completed'"
                class="invisible group-hover:visible text-muted-foreground hover:text-destructive p-0.5"
                @click.stop="deleteChat(chat.id)">
                <span class="i-carbon-trash-can inline-block h-3 w-3"></span>
              </button>
            </div>
            <div class="mt-1.5 flex items-center justify-between text-xs text-muted-foreground">
              <span>{{ chat.participants.length }} 位成员 · {{ chat.messages.length }} 条消息</span>
              <span
                class="rounded-full px-1.5 py-0.5 text-[10px]"
                :class="{
                  'bg-green-500/10 text-green-500': chat.status === 'active',
                  'bg-gray-500/10 text-gray-500': chat.status === 'completed'
                }">
                {{ statusText(chat.status) }}
              </span>
            </div>
          </div>

          <div v-if="chats.length === 0" class="text-center py-12 text-muted-foreground text-sm">暂无群聊</div>
        </div>
      </div>

      <!-- 右侧：聊天区域 -->
      <div v-if="selectedChat" class="flex-1 flex flex-col overflow-hidden">
        <!-- 群聊头部 -->
        <div class="border-b border-border bg-card px-5 py-3 flex items-center justify-between">
          <div>
            <h2 class="text-sm font-semibold text-foreground">{{ selectedChat.topic }}</h2>
            <div class="text-xs text-muted-foreground mt-0.5">
              {{ selectedChat.participants.map((p) => p.name).join('、') }}
            </div>
          </div>
          <button
            v-if="selectedChat.status === 'active'"
            class="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted transition-colors"
            @click="endChat">
            结束群聊
          </button>
        </div>

        <!-- 消息列表 -->
        <div ref="chatBody" class="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          <div
            v-for="msg in selectedChat.messages"
            :key="msg.id"
            class="flex gap-3"
            :class="{ 'flex-row-reverse': isUserMessage(msg) }">
            <!-- 头像 -->
            <div
              class="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-content text-xs font-bold"
              :class="isUserMessage(msg) ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'">
              <span class="w-full text-center">{{ getAgentInitial(msg.agentId) }}</span>
            </div>
            <!-- 内容 -->
            <div class="max-w-[70%] min-w-0">
              <div class="text-[10px] text-muted-foreground mb-0.5" :class="{ 'text-right': isUserMessage(msg) }">
                {{ getAgentName(msg.agentId) }}
                <span class="ml-1.5">{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div
                class="rounded-xl px-3.5 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words"
                :class="
                  isUserMessage(msg)
                    ? 'bg-primary text-primary-foreground rounded-tr-sm'
                    : 'bg-muted text-foreground rounded-tl-sm'
                ">
                {{ msg.content }}
              </div>
            </div>
          </div>

          <!-- 正在输入指示 -->
          <div v-if="typingAgents.size > 0" class="flex gap-3">
            <div class="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center">
              <span class="i-carbon-chat inline-block h-3.5 w-3.5 text-muted-foreground animate-pulse"></span>
            </div>
            <div class="rounded-xl bg-muted px-3.5 py-2 text-sm text-muted-foreground">
              {{ [...typingAgents].map(getAgentName).join('、') }} 正在输入...
            </div>
          </div>
        </div>

        <!-- 输入区域 -->
        <div v-if="selectedChat.status === 'active'" class="border-t border-border bg-card px-4 py-3 relative">
          <!-- @mention 弹出选择 -->
          <div v-if="showMentionPopup && filteredMentionAgents.length > 0" class="mention-popup">
            <div v-for="p in filteredMentionAgents" :key="p.agentId" class="mention-item" @click="insertMention(p)">
              <span class="font-medium">{{ p.name }}</span>
              <span v-if="p.role" class="text-muted-foreground text-[10px] ml-1.5">{{ p.role }}</span>
            </div>
          </div>

          <div class="flex items-end gap-2">
            <textarea
              v-model="inputText"
              class="flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary placeholder:text-muted-foreground/50"
              placeholder="输入消息，@ 来提及智能体..."
              rows="1"
              :disabled="sending"
              @keydown="handleKeydown"
              @input="handleInput"></textarea>
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
              :disabled="!inputText.trim() || sending"
              @click="sendMessage">
              发送
            </button>
          </div>
          <div class="text-[10px] text-muted-foreground/40 mt-1"> 输入 @ 选择智能体，Enter 发送，Shift+Enter 换行 </div>
        </div>

        <!-- 已结束提示 -->
        <div v-else class="border-t border-border bg-muted/30 px-4 py-3 text-center text-xs text-muted-foreground">
          群聊已结束
        </div>
      </div>

      <!-- 空状态 -->
      <div v-else class="flex-1 flex items-center justify-center">
        <div class="text-center text-muted-foreground">
          <span class="i-carbon-group inline-block h-12 w-12 opacity-10 mb-3"></span>
          <p class="text-sm">选择或创建一个群聊</p>
        </div>
      </div>
    </div>

    <!-- 创建群聊对话框 -->
    <Teleport to="body">
      <div
        v-if="showCreateDialog"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        @click.self="showCreateDialog = false">
        <div class="w-[480px] max-h-[80vh] bg-background rounded-2xl shadow-2xl overflow-hidden">
          <div class="px-6 pt-5 pb-4">
            <h3 class="text-base font-semibold text-foreground">创建群聊</h3>
          </div>

          <div class="px-6 space-y-4">
            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">讨论主题</label>
              <input
                v-model="newTopic"
                class="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-primary"
                placeholder="例如：讨论新功能的技术方案" />
            </div>

            <div>
              <label class="text-xs font-medium text-muted-foreground mb-1.5 block">
                选择参与者 ({{ selectedAgentIds.length }})
              </label>
              <div class="max-h-48 overflow-y-auto border border-border rounded-lg divide-y divide-border">
                <label
                  v-for="agent in availableAgents"
                  :key="agent.id"
                  class="flex items-center gap-3 px-3 py-2.5 cursor-pointer hover:bg-muted transition-colors">
                  <input
                    v-model="selectedAgentIds"
                    type="checkbox"
                    :value="agent.id"
                    class="rounded border-border text-primary focus:ring-primary" />
                  <div class="min-w-0">
                    <div class="text-sm font-medium text-foreground">{{ agent.name }}</div>
                    <div v-if="agent.description" class="text-[11px] text-muted-foreground line-clamp-1">
                      {{ agent.description }}
                    </div>
                  </div>
                </label>
              </div>
            </div>
          </div>

          <div class="px-6 py-4 flex justify-end gap-2">
            <button
              class="rounded-lg px-4 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
              @click="showCreateDialog = false">
              取消
            </button>
            <button
              class="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              :disabled="!newTopic.trim() || selectedAgentIds.length === 0"
              @click="createChat">
              创建
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.mention-popup {
  position: absolute;
  bottom: 100%;
  left: 16px;
  right: 16px;
  max-height: 200px;
  overflow-y: auto;
  background: hsl(var(--background));
  border: 1px solid hsl(var(--border));
  border-radius: 10px;
  box-shadow: 0 8px 32px hsl(0 0% 0% / 0.12);
  margin-bottom: 4px;
}
.mention-item {
  display: flex;
  align-items: center;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
}
.mention-item:hover {
  background: hsl(var(--muted));
}
</style>

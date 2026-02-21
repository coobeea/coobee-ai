<script setup lang="ts">
import { computed } from 'vue';
import MarkdownIt from 'markdown-it';
import hljs from 'highlight.js';
import type { ContentBlock } from '@/composables/useStreamHandler';

const props = defineProps<{
  block: ContentBlock & { type: 'text' };
}>();

// 配置 Markdown 渲染器（支持代码高亮）
const md = new MarkdownIt({
  html: false, // 禁用 HTML 标签（防止 XSS）
  linkify: true, // 自动识别链接
  typographer: true, // 启用智能引号等
  breaks: true, // 换行转换为 <br>
  highlight: (str, lang) => {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return `<pre class="hljs"><code>${hljs.highlight(str, { language: lang, ignoreIllegals: true }).value}</code></pre>`;
      } catch (_) {
        // 如果高亮失败，返回普通代码块
      }
    }
    return `<pre class="hljs"><code>${md.utils.escapeHtml(str)}</code></pre>`;
  }
});

const renderedHtml = computed(() => md.render(props.block.text));
</script>

<template>
  <div class="msg-text" v-html="renderedHtml" />
</template>

<style scoped>
.msg-text {
  font-size: 13px;
  line-height: 1.6;
  color: hsl(var(--foreground) / 0.9);
  word-break: break-word;
}

/* Markdown 渲染样式 */
.msg-text :deep(p) {
  margin: 0 0 8px 0;
}

.msg-text :deep(p:last-child) {
  margin-bottom: 0;
}

.msg-text :deep(h1),
.msg-text :deep(h2),
.msg-text :deep(h3),
.msg-text :deep(h4),
.msg-text :deep(h5),
.msg-text :deep(h6) {
  margin: 12px 0 8px 0;
  font-weight: 600;
  line-height: 1.4;
}

.msg-text :deep(h1) {
  font-size: 1.5em;
}
.msg-text :deep(h2) {
  font-size: 1.3em;
}
.msg-text :deep(h3) {
  font-size: 1.15em;
}

.msg-text :deep(ul),
.msg-text :deep(ol) {
  margin: 8px 0;
  padding-left: 24px;
}

.msg-text :deep(li) {
  margin: 4px 0;
}

.msg-text :deep(code) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.9em;
  background: hsl(var(--muted) / 0.3);
  padding: 2px 6px;
  border-radius: 3px;
  color: hsl(var(--foreground) / 0.95);
}

.msg-text :deep(pre) {
  margin: 8px 0;
  padding: 12px;
  background: hsl(var(--muted) / 0.2);
  border-radius: 6px;
  overflow-x: auto;
  border-left: 3px solid hsl(var(--primary) / 0.3);
}

.msg-text :deep(pre code) {
  background: none;
  padding: 0;
  font-size: 0.85em;
  line-height: 1.5;
}

.msg-text :deep(a) {
  color: hsl(var(--primary));
  text-decoration: underline;
  text-decoration-color: hsl(var(--primary) / 0.3);
  transition: all 0.15s;
}

.msg-text :deep(a:hover) {
  text-decoration-color: hsl(var(--primary));
}

.msg-text :deep(blockquote) {
  margin: 8px 0;
  padding: 8px 12px;
  border-left: 3px solid hsl(var(--muted-foreground) / 0.3);
  background: hsl(var(--muted) / 0.15);
  color: hsl(var(--muted-foreground));
}

.msg-text :deep(strong) {
  font-weight: 600;
  color: hsl(var(--foreground));
}

.msg-text :deep(em) {
  font-style: italic;
}

.msg-text :deep(hr) {
  margin: 12px 0;
  border: none;
  border-top: 1px solid hsl(var(--border));
}

.msg-text :deep(table) {
  width: 100%;
  margin: 8px 0;
  border-collapse: collapse;
  font-size: 0.9em;
}

.msg-text :deep(th),
.msg-text :deep(td) {
  padding: 6px 10px;
  border: 1px solid hsl(var(--border));
  text-align: left;
}

.msg-text :deep(th) {
  background: hsl(var(--muted) / 0.3);
  font-weight: 600;
}

.msg-text :deep(tr:nth-child(even)) {
  background: hsl(var(--muted) / 0.1);
}

/* 代码高亮主题（基于 GitHub 风格，适配暗色/亮色主题） */
.msg-text :deep(.hljs) {
  display: block;
  overflow-x: auto;
  padding: 0;
  background: transparent;
}

.msg-text :deep(.hljs-comment),
.msg-text :deep(.hljs-quote) {
  color: hsl(var(--muted-foreground) / 0.7);
  font-style: italic;
}

.msg-text :deep(.hljs-keyword),
.msg-text :deep(.hljs-selector-tag),
.msg-text :deep(.hljs-type) {
  color: hsl(var(--primary));
  font-weight: 600;
}

.msg-text :deep(.hljs-string),
.msg-text :deep(.hljs-attr),
.msg-text :deep(.hljs-symbol),
.msg-text :deep(.hljs-bullet) {
  color: hsl(150 60% 45%);
}

.msg-text :deep(.hljs-number),
.msg-text :deep(.hljs-literal) {
  color: hsl(30 80% 50%);
}

.msg-text :deep(.hljs-function),
.msg-text :deep(.hljs-title) {
  color: hsl(220 90% 55%);
}

.msg-text :deep(.hljs-variable),
.msg-text :deep(.hljs-template-variable) {
  color: hsl(340 70% 50%);
}

.msg-text :deep(.hljs-regexp),
.msg-text :deep(.hljs-link) {
  color: hsl(180 60% 45%);
}
</style>

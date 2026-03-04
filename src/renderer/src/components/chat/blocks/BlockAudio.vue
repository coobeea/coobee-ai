<script setup lang="ts">
/**
 * BlockAudio — 音频播放组件
 *
 * 用于在对话流中播放 TTS 生成的音频文件
 * 支持 MP3、WAV、WebM 等常见格式
 */

interface AudioBlock {
  type: 'audio';
  src: string;
  title?: string;
}

defineProps<{
  block: AudioBlock;
}>();
</script>

<template>
  <div class="audio-block">
    <div class="audio-header">
      <span class="i-carbon-volume-up-filled audio-icon"></span>
      <span class="audio-title">{{ block.title || '语音消息' }}</span>
    </div>

    <audio controls :src="block.src" class="audio-player" preload="metadata"> 您的浏览器不支持音频播放 </audio>
  </div>
</template>

<style scoped>
.audio-block {
  margin: 8px 0;
  padding: 12px;
  background: hsl(var(--muted) / 0.5);
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
}

.audio-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.audio-icon {
  color: hsl(var(--primary));
  font-size: 16px;
}

.audio-title {
  font-size: 13px;
  font-weight: 500;
  color: hsl(var(--foreground));
}

.audio-player {
  width: 100%;
  height: 40px;
  border-radius: 4px;
}

.audio-player::-webkit-media-controls-panel {
  background-color: hsl(var(--background));
}

.audio-player::-webkit-media-controls-current-time-display,
.audio-player::-webkit-media-controls-time-remaining-display {
  color: hsl(var(--foreground));
  font-size: 12px;
}
</style>

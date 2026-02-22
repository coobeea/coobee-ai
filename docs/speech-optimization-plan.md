# 语音功能优化方案

基于 Fun-ASR-Nano 的优化经验，为 coobee-ai 项目规划语音交互功能的实现方案。

## 一、核心优化策略

### 1. 双引擎架构

**借鉴点**：Fun-ASR 采用 whisper + FunASR 双引擎，根据场景智能切换

**应用到 coobee-ai**：

```typescript
// src/main/speech/engines/EngineManager.ts
interface SpeechEngine {
  name: 'whisper' | 'funasr' | 'browser-native';
  transcribe(audio: ArrayBuffer, options?: TranscribeOptions): Promise<string>;
}

class EngineManager {
  private engines: Map<string, SpeechEngine> = new Map();

  // 根据语言自动选择最优引擎
  selectEngine(language: string): SpeechEngine {
    if (language === 'zh' || language === 'zh-CN') {
      return this.engines.get('funasr'); // 中文优选 FunASR
    }
    return this.engines.get('whisper'); // 其他语言用 Whisper
  }
}
```

**优势**：

- 中文场景使用 FunASR，识别准确率更高，自动标点
- 英文/多语种场景使用 Whisper
- 浏览器内使用 Web Speech API 作为快速备选

---

### 2. MPS/GPU 硬件加速

**借鉴点**：Fun-ASR 自动检测设备，优先使用 MPS (Apple Silicon) 或 CUDA 加速

```python
# Fun-ASR 的设备检测逻辑
if torch.cuda.is_available():
    device = "cuda:0"
elif torch.backends.mps.is_available():
    device = "mps"  # Apple Silicon 加速
else:
    device = "cpu"
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/DeviceDetector.ts
export class DeviceDetector {
  static async detectOptimalDevice(): Promise<'gpu' | 'mps' | 'cpu'> {
    const platform = process.platform;

    if (platform === 'darwin') {
      // macOS 检查是否为 Apple Silicon
      const arch = process.arch;
      if (arch === 'arm64') {
        return 'mps'; // M1/M2/M3 芯片使用 MPS 加速
      }
    }

    // 检查 NVIDIA GPU
    if (await this.hasNvidiaGPU()) {
      return 'gpu';
    }

    return 'cpu';
  }
}
```

**实现建议**：

- Python 子进程调用 STT 模型时，传递设备参数
- M 系列芯片用户可获得 2-3x 速度提升

---

### 3. 长音频自动分段处理

**借鉴点**：Fun-ASR 对超过 60 秒的音频自动用 ffmpeg 分段

```python
# 分段逻辑伪代码
if duration > MAX_SEGMENT_SECONDS:
    chunks = split_audio(audio_path, 60)  # 每 60 秒一段
    for chunk in chunks:
        result = transcribe(chunk)
        segments.append(result)
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/AudioProcessor.ts
export class AudioProcessor {
  private MAX_SEGMENT_DURATION = 60; // 秒

  async processLongAudio(audioPath: string): Promise<TranscriptSegment[]> {
    const duration = await this.getAudioDuration(audioPath);

    if (duration <= this.MAX_SEGMENT_DURATION) {
      // 短音频直接转录
      return await this.transcribe(audioPath);
    }

    // 长音频分段处理
    const chunks = await this.splitAudioWithFFmpeg(audioPath, this.MAX_SEGMENT_DURATION);
    const results: TranscriptSegment[] = [];

    for (const chunk of chunks) {
      const segment = await this.transcribe(chunk.path);
      segment.startTime = chunk.startTime; // 恢复时间戳
      results.push(segment);

      // 清理临时文件
      await fs.unlink(chunk.path);
    }

    return results;
  }
}
```

**用户体验优化**：

- 支持转录 1 小时+的会议录音
- 显示进度条：「已处理 3/12 段 (25%)」
- 后台处理，不阻塞 UI

---

### 4. 热词（Hotwords）支持

**借鉴点**：Fun-ASR 支持传入热词列表，提高专有名词识别准确率

```python
# Fun-ASR 热词用法
results = model.generate(
    input=[audio_path],
    hotwords=["Claude", "Anthropic", "Token"],  # 自定义热词
    language="中文"
)
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/HotwordManager.ts
export class HotwordManager {
  private userHotwords: Set<string> = new Set();
  private projectHotwords: Set<string> = new Set();

  // 自动从用户对话历史中提取高频词
  async extractFromHistory(userId: string): Promise<string[]> {
    const messages = await db.getRecentMessages(userId, 100);
    const keywords = this.extractKeywords(messages);
    return keywords.filter((w) => w.length > 2); // 过滤短词
  }

  // 从当前项目代码中提取技术名词
  async extractFromProject(projectPath: string): Promise<string[]> {
    const files = await glob(`${projectPath}/**/*.{ts,js,vue}`);
    const identifiers = this.parseIdentifiers(files);
    return identifiers;
  }

  // 合并所有热词源
  async getHotwords(): Promise<string[]> {
    return [
      ...this.userHotwords,
      ...this.projectHotwords,
      ...DEFAULT_TECH_HOTWORDS // Vue, TypeScript, Electron, Pinia 等
    ];
  }
}
```

**智能热词场景**：

- 编程助手：自动加载项目中的类名、函数名
- 用户习惯：记录用户常说的专有名词
- 行业词库：预置技术、医疗、法律等领域词库

---

### 5. 模型缓存与预热

**借鉴点**：Fun-ASR 模型只加载一次，后续调用复用

```python
def _load_funasr_model():
    """模型单例模式"""
    if hasattr(_load_funasr_model, "_engine"):
        return _load_funasr_model._engine  # 复用已加载的模型

    engine = AutoModel(model=FUNASR_MODEL_NAME, device=device)
    _load_funasr_model._engine = engine
    return engine
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/ModelCache.ts
export class ModelCache {
  private static models: Map<string, any> = new Map();
  private static preheating = false;

  // 应用启动时预热模型（后台加载）
  static async preheat() {
    if (this.preheating) return;
    this.preheating = true;

    // 异步加载常用模型到内存
    await Promise.all([this.loadModel('funasr'), this.loadModel('whisper-base')]);
  }

  // 获取模型（已预热则秒开）
  static async getModel(name: string) {
    if (this.models.has(name)) {
      return this.models.get(name); // 命中缓存，无需加载
    }
    return await this.loadModel(name);
  }
}

// 在 app ready 时调用
app.whenReady().then(() => {
  ModelCache.preheat(); // 后台预热
});
```

**用户体验**：

- 首次语音输入 0 等待（模型已预热）
- 应用启动时显示「正在准备语音识别...」

---

### 6. 多输出格式支持

**借鉴点**：Fun-ASR 支持 txt / timestamps / srt / json 多种格式

```python
# 格式示例
formats = {
    'txt': '这是一段语音转文字结果',
    'timestamps': '[00:12] 这是一段语音转文字结果',
    'srt': '1\n00:00:12,000 --> 00:00:15,000\n这是一段语音转文字结果',
    'json': { segments: [...], full_text: '...' }
}
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/OutputFormatter.ts
export class OutputFormatter {
  static format(segments: Segment[], format: OutputFormat): string {
    switch (format) {
      case 'plain':
        return segments.map((s) => s.text).join(' ');

      case 'markdown':
        return segments.map((s) => `**[${formatTime(s.start)}]** ${s.text}`).join('\n\n');

      case 'srt':
        return this.toSRT(segments);

      case 'json':
        return JSON.stringify({ segments, fullText: this.toPlainText(segments) });
    }
  }
}
```

**应用场景**：

- **纯文本**：直接插入对话框
- **Markdown**：生成会议纪要
- **SRT**：导出视频字幕
- **JSON**：供其他工具调用

---

### 7. 批量处理与导入管理

**借鉴点**：Fun-ASR 的录音笔管理系统

```python
# recorder_import.py 核心逻辑
1. 扫描源目录的所有音频文件
2. MD5 去重（跳过已处理的文件）
3. 复制到本地工作空间
4. 逐个转录（支持批量）
5. 转录完删除音频，只保留文本
```

**应用到 coobee-ai**：

```typescript
// src/main/speech/BatchImporter.ts
export class BatchImporter {
  private importHistory: Set<string> = new Set(); // MD5 去重

  async importFromFolder(folderPath: string) {
    const audioFiles = await this.scanAudioFiles(folderPath);
    const newFiles = audioFiles.filter((f) => !this.importHistory.has(f.md5));

    for (const file of newFiles) {
      const transcript = await this.transcribe(file.path);
      await this.saveTranscript(transcript);

      // 记录已处理
      this.importHistory.add(file.md5);

      // 可选：删除原始音频（节省空间）
      if (userPreference.deleteAfterTranscribe) {
        await fs.unlink(file.path);
      }
    }
  }
}
```

**用户场景**：

- 拖入整个会议录音文件夹，自动批量转录
- 插入录音笔 U 盘时自动扫描（类似相机导入照片）
- 去重避免重复处理

---

## 二、UI/UX 设计建议

### 1. 语音输入按钮

```vue
<!-- src/renderer/components/SpeechInput.vue -->
<template>
  <button @mousedown="startRecording" @mouseup="stopRecording" :class="{ recording: isRecording }">
    <icon-mdi:microphone v-if="!isRecording" />
    <icon-svg-spinners:pulse v-else />
    <span v-if="isRecording">{{ duration }}s</span>
  </button>
</template>
```

**交互**：

- 按住说话，松开发送（类似微信）
- 显示实时音量波形
- 录音时显示倒计时

### 2. 实时转录预览

```
┌────────────────────────────────┐
│ 🎤 正在识别...                 │
│                                │
│ "我想问一下关于 Vue 3 的组合式  │
│  API 有什么最佳实践..."         │
│                                │
│ ⏱️ 12s  [取消] [完成]          │
└────────────────────────────────┘
```

**特性**：

- 边说边显示识别结果（流式输出）
- 支持取消/重录
- 自动断句（利用 FunASR 的标点）

### 3. 设置面板

```typescript
interface SpeechSettings {
  engine: 'auto' | 'funasr' | 'whisper';
  language: 'auto' | 'zh' | 'en';
  enableHotwords: boolean;
  autoDeleteAudio: boolean;
  outputFormat: 'plain' | 'markdown' | 'srt';
}
```

---

## 三、技术架构

### 目录结构

```
src/main/speech/
├── engines/
│   ├── FunASREngine.ts        # FunASR 引擎封装
│   ├── WhisperEngine.ts       # Whisper 引擎封装
│   ├── BrowserEngine.ts       # Web Speech API 封装
│   └── EngineManager.ts       # 引擎管理器
├── processors/
│   ├── AudioProcessor.ts      # 音频处理（分段、格式转换）
│   ├── DeviceDetector.ts      # 设备检测（MPS/GPU）
│   └── HotwordManager.ts      # 热词管理
├── storage/
│   ├── TranscriptStore.ts     # 转录结果存储
│   └── ModelCache.ts          # 模型缓存
└── SpeechService.ts           # 主服务类
```

### IPC 通信

```typescript
// Renderer → Main
ipcRenderer.invoke('speech:transcribe', {
  audio: ArrayBuffer,
  options: { language: 'zh', hotwords: [...] }
})

// Main → Renderer (进度更新)
mainWindow.webContents.send('speech:progress', {
  current: 3,
  total: 10,
  currentText: '这是第三段的识别结果...'
})
```

---

## 四、实施优先级

### P0（核心功能）

1. ✅ 基础录音 + 转录（浏览器 Web Speech API）
2. ✅ 实时转录预览
3. ✅ 支持中文和英文

### P1（性能优化）

1. 🔄 集成 FunASR（中文优化）
2. 🔄 MPS 硬件加速检测
3. 🔄 模型预热（首次使用 0 等待）

### P2（高级功能）

1. ⏳ 热词自动提取
2. ⏳ 长音频自动分段
3. ⏳ 批量导入处理

### P3（扩展能力）

1. ⏳ 多输出格式（SRT 字幕）
2. ⏳ 录音笔自动导入
3. ⏳ 语音情绪识别

---

## 五、依赖清单

### NPM 包

```json
{
  "dependencies": {
    "@ffmpeg-installer/ffmpeg": "^1.1.0", // 音频处理
    "fluent-ffmpeg": "^2.1.3",
    "node-mic": "^1.3.5", // 录音
    "wav": "^1.0.2" // WAV 编码
  }
}
```

### Python 环境（用于 STT 模型）

```bash
# 在 Electron 中调用 Python 子进程
pip install funasr faster-whisper torch torchaudio
```

### 系统依赖

- **macOS**: ffmpeg（`brew install ffmpeg`）
- **Windows**: ffmpeg.exe（应用内置）
- **Linux**: ffmpeg（`apt install ffmpeg`）

---

## 六、性能指标

基于 Fun-ASR 的实测数据：

| 场景            | 模型         | 设备     | RTF (实时率) | 说明                   |
| --------------- | ------------ | -------- | ------------ | ---------------------- |
| 短音频 (< 60s)  | FunASR       | M2 (MPS) | ~0.3         | 10 秒音频 3 秒转录完成 |
| 长音频 (1 小时) | FunASR       | M2 (MPS) | ~0.2         | 1 小时音频 12 分钟完成 |
| 英文            | Whisper Base | M2       | ~0.5         | 10 秒音频 5 秒完成     |
| 中文            | Whisper Base | M2       | ~0.5         | 识别率不如 FunASR      |

**优化目标**：

- 用户等待时间 < 音频时长的 50%
- M 系列芯片用户实现 < 30% 的等待时间

---

## 七、风险与应对

### 风险 1：模型体积大（FunASR ~500MB）

**应对**：

- 首次使用时后台下载
- 提供「精简模式」（仅浏览器 API）

### 风险 2：Python 环境依赖

**应对**：

- 内置 Python 运行时（pyinstaller 打包）
- 或使用 WASM 版本的 Whisper（体积小但速度慢）

### 风险 3：不同操作系统的兼容性

**应对**：

- 每个平台独立测试
- 提供降级方案（无 GPU 时用 CPU）

---

## 八、总结

通过借鉴 Fun-ASR 的优化经验，coobee-ai 可以实现：

1. **准确率提升 20%+**（中文场景使用 FunASR）
2. **速度提升 2-3x**（MPS/GPU 加速）
3. **用户体验优化**（预热、热词、批量处理）
4. **支持长音频**（自动分段，无限时长）

**核心原则**：

- ✅ 智能引擎选择（语言自适应）
- ✅ 硬件加速优先（MPS/GPU）
- ✅ 模型缓存复用（秒开体验）
- ✅ 进度透明可见（用户不焦虑）

建议先实现 P0 功能验证可行性，再逐步推进 P1/P2 优化。

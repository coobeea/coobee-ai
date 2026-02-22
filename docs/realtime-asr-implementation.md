# 实时语音识别优化实施方案

基于 `/Users/lifeng/git/git_deep/deep-study/realtime-asr` 的参考实现，为 coobee-ai 规划性能优化方案。

---

## 一、当前架构 vs 优化架构

### 当前实现（低效）

```
┌─────────────┐
│ 浏览器      │
│ MediaRecorder│ WebM/Opus 编码
│ (Opus codec)│
└──────┬──────┘
       │ WebSocket 发送 WebM chunks
       ↓
┌──────────────────────────────┐
│ ASR Worker (Python)          │
│                              │
│ 1. 接收 WebM 数据            │
│ 2. 临时保存到文件            │
│ 3. ffmpeg 转码 ← 100-300ms   │  ⚠️ 瓶颈
│    WebM → WAV 16kHz          │
│ 4. FunASR 识别               │
└──────────────────────────────┘
```

**问题**：

- ffmpeg 进程启动 + 转码开销大（每次 100-300ms）
- WebM 封装解封装增加延迟
- 无 VAD，识别时机不合理

---

### 优化架构（高效）

```
┌─────────────────────────┐
│ 浏览器                  │
│ Web Audio API           │
│ ScriptProcessorNode     │
│                         │
│ 1. Float32 PCM 48kHz    │
│ 2. 降采样 16kHz（抗混叠）│
│ 3. Float32 → Int16 LE   │
└─────────┬───────────────┘
          │ WebSocket 发送 PCM 字节流
          ↓
┌──────────────────────────────┐
│ ASR Worker (Python)          │
│                              │
│ 1. 接收 PCM Int16 LE 流      │
│ 2. VAD 检测停顿 ← 智能触发   │  ✅ 优化
│ 3. wave 模块写 WAV 头 <1ms   │  ✅ 快速
│ 4. FunASR 识别               │
└──────────────────────────────┘
```

**改进**：

- ✅ 消除 ffmpeg 开销（~200ms 延迟）
- ✅ VAD 智能触发识别（完整句子）
- ✅ 幻觉检测（模型输出质量控制）

---

## 二、前端实现（VoicePanel.vue）

### 核心变更

#### 1. 采用 Web Audio API 采集 PCM

```typescript
// 不再使用 MediaRecorder
// 改用 ScriptProcessorNode 获取 Float32 PCM 样本

let audioContext: AudioContext | null = null;
let sourceNode: MediaStreamAudioSourceNode | null = null;
let processorNode: ScriptProcessorNode | null = null;
let pcmBuffer: Float32Array[] = [];

async function startListening(): Promise<void> {
  audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // 使用默认采样率（通常 48kHz）
  // 不要指定 sampleRate: 16000，某些浏览器会产出失真音频
  audioContext = new AudioContext();
  sourceNode = audioContext.createMediaStreamSource(audioStream);

  // bufferSize=4096, 48kHz 下每次约 85ms
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);

  processorNode.onaudioprocess = (event) => {
    if (isMuted.value) return;

    const samples = event.inputBuffer.getChannelData(0); // Float32
    pcmBuffer.push(new Float32Array(samples));

    // 清零输出防止回放
    event.outputBuffer.getChannelData(0).fill(0);
  };

  sourceNode.connect(processorNode);
  processorNode.connect(audioContext.destination);

  // 每 250ms 发送一次
  sendTimer = setInterval(sendPcmBuffer, 250);
}
```

#### 2. 带抗混叠的降采样

```typescript
/**
 * 降采样：48kHz → 16kHz（3:1 整数比率，均值抽取）
 */
function downsample(samples: Float32Array, inputRate: number, outputRate: number): Float32Array {
  if (inputRate === outputRate) return samples;

  const ratio = inputRate / outputRate; // 48000/16000 = 3
  const intRatio = Math.round(ratio);

  // 整数比率：均值抽取（最佳质量）
  if (Math.abs(ratio - intRatio) < 0.01 && intRatio >= 2) {
    const newLen = Math.floor(samples.length / intRatio);
    const result = new Float32Array(newLen);

    for (let i = 0; i < newLen; i++) {
      let sum = 0;
      const base = i * intRatio;
      for (let j = 0; j < intRatio; j++) {
        sum += samples[base + j];
      }
      result[i] = sum / intRatio; // 低通滤波
    }
    return result;
  }

  // 非整数比率：移动平均滤波 + 线性插值
  // ...（参考 realtime-asr/static/index.html）
}
```

#### 3. Float32 → Int16 LE 转换

```typescript
function float32ToInt16(float32: Float32Array): ArrayBuffer {
  const buf = new ArrayBuffer(float32.length * 2);
  const view = new DataView(buf);

  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i])); // clamp [-1, 1]
    const sample = s < 0 ? s * 0x8000 : s * 0x7fff;
    view.setInt16(i * 2, sample, true); // little-endian
  }

  return buf;
}
```

#### 4. 定时发送 PCM 缓冲

```typescript
function sendPcmBuffer(): void {
  if (!asrWs.value || asrWs.value.readyState !== WebSocket.OPEN) return;
  if (pcmBuffer.length === 0) return;

  // 合并所有累积的样本
  let totalLen = 0;
  for (const chunk of pcmBuffer) totalLen += chunk.length;
  const merged = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of pcmBuffer) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  pcmBuffer = [];

  // 降采样 48kHz → 16kHz
  const downsampled = downsample(merged, audioContext!.sampleRate, 16000);

  // 转 Int16 LE
  const int16buf = float32ToInt16(downsampled);

  // 发送
  asrWs.value.send(int16buf);
}
```

---

## 三、后端实现（workers/asr/server.py）

### 核心变更

#### 1. PCM → WAV 转换（无 ffmpeg）

```python
import wave

def pcm_to_wav(pcm_bytes: bytes, tmp_dir: str) -> str:
    """PCM Int16 LE → WAV 文件（<1ms，无需 ffmpeg）"""
    wav_path = os.path.join(tmp_dir, "segment.wav")

    with wave.open(wav_path, "wb") as wf:
        wf.setnchannels(1)          # 单声道
        wf.setsampwidth(2)          # 16-bit = 2 bytes
        wf.setframerate(16000)      # 16kHz
        wf.writeframes(pcm_bytes)   # 写入 PCM 数据

    return wav_path
```

#### 2. VAD（语音活动检测）触发识别

```python
SILENCE_THRESHOLD = 300       # Int16 振幅阈值
SILENCE_DURATION_SEC = 1.2    # 连续静音 1.2s 才算"说完一句"
MAX_UTTERANCE_SEC = 20.0      # 不间断说话的安全上限
MIN_UTTERANCE_SEC = 0.3       # 最短有效语段

def check_chunk_energy(data: bytes) -> int:
    """检测音频 chunk 的峰值振幅"""
    n_samples = len(data) // 2  # Int16 = 2 bytes
    max_amp = 0

    # 采样 50 个点
    step = max(1, n_samples // 50)
    for i in range(0, n_samples, step):
        val = abs(struct.unpack_from("<h", data, i * 2)[0])
        if val > max_amp:
            max_amp = val

    return max_amp

@app.websocket("/ws/asr")
async def asr_stream(ws: WebSocket):
    """VAD 触发识别的流式 ASR"""

    buffer = bytearray()
    recognized_pos = 0
    speech_start_pos = -1
    silence_start_pos = -1

    while True:
        data = await ws.receive_bytes()
        buf_pos_before = len(buffer)
        buffer.extend(data)

        energy = check_chunk_energy(data)
        is_speech = energy > SILENCE_THRESHOLD

        if is_speech:
            # 正在说话
            if speech_start_pos < 0:
                speech_start_pos = buf_pos_before
            silence_start_pos = -1

            # 安全阀：连续说话超过 20s，强制识别
            speech_len = len(buffer) - speech_start_pos
            if speech_len >= MAX_UTTERANCE_SEC * 32000:  # 32000 = 16000Hz * 2bytes
                # 触发识别
                segment = bytes(buffer[recognized_pos:])
                text = await transcribe_async(segment)
                recognized_pos = len(buffer)
                speech_start_pos = recognized_pos
        else:
            # 静音
            if silence_start_pos < 0:
                silence_start_pos = buf_pos_before

            # 检查静音是否够长
            if speech_start_pos >= 0:
                silence_len = len(buffer) - silence_start_pos
                silence_bytes = SILENCE_DURATION_SEC * 32000

                if silence_len >= silence_bytes:
                    # 停顿够长 → 一句话说完了
                    utterance_bytes = silence_start_pos - recognized_pos

                    if utterance_bytes >= MIN_UTTERANCE_SEC * 32000:
                        # 触发识别
                        segment = bytes(buffer[recognized_pos:silence_start_pos])
                        text = await transcribe_async(segment)
                        recognized_pos = len(buffer)

                    speech_start_pos = -1
                    silence_start_pos = -1
```

#### 3. 幻觉检测

```python
def clean_asr_output(text: str, audio_sec: float) -> str:
    """
    检测 FunASR 幻觉（重复短语）

    FunASR 在音频质量差时会进入循环，不断重复同一短语。
    检测方法：输出字数远超音频时长合理范围 → 截断。
    """
    if not text:
        return text

    # 中文正常语速 ~4-8 字/秒，允许 2x 余量
    max_chars = max(int(audio_sec * 15), 10)

    if len(text) > max_chars:
        log.warning(f"幻觉检测: {len(text)} 字/{audio_sec:.1f}s 音频 → 截断到 {max_chars} 字")
        text = text[:max_chars]

    return text

def do_transcribe(pcm_bytes: bytes) -> tuple[str, int]:
    """同步识别，返回 (文本, 推理耗时ms)"""
    seg_sec = len(pcm_bytes) / 32000  # 16kHz * 2bytes

    with tempfile.TemporaryDirectory(prefix="asr_") as tmp:
        wav_path = pcm_to_wav(pcm_bytes, tmp)

        results = asr_engine.generate(
            input=[wav_path],
            cache={},
            batch_size=1,
            hotwords=[],
            language="中文",
            itn=True,
        )

        text = results[0].get("text", "").strip() if results else ""

        # 幻觉检测
        text = clean_asr_output(text, seg_sec)

        return text, infer_ms
```

---

## 四、实施步骤

### Phase 1：后端优化（ASR Worker）

**文件**: `workers/asr/server.py`

**修改点**：

1. ✅ 添加 `pcm_to_wav()` 函数（替代 ffmpeg）
2. ✅ 添加 VAD 逻辑（`check_chunk_energy`, 状态机）
3. ✅ 添加幻觉检测 `clean_asr_output()`
4. ✅ WebSocket 接口改为接收 PCM 字节流

**预计工作量**: 4-6 小时

---

### Phase 2：前端优化（VoicePanel.vue）

**文件**: `src/renderer/src/components/agent/VoicePanel.vue`

**修改点**：

1. ✅ 替换 MediaRecorder 为 ScriptProcessorNode
2. ✅ 实现降采样函数 `downsample()`
3. ✅ 实现 Float32 → Int16 转换 `float32ToInt16()`
4. ✅ 定时发送 PCM 缓冲 `sendPcmBuffer()`
5. ✅ 移除旧的 WebM 处理逻辑

**预计工作量**: 3-4 小时

---

### Phase 3：测试与调优

**测试项**：

1. [ ] 麦克风采集正常（音量指示、权限）
2. [ ] 降采样无失真（对比原始 48kHz 和降采样 16kHz）
3. [ ] VAD 触发时机合理（不会在句子中间切断）
4. [ ] 识别延迟满足预期（< 1.5s）
5. [ ] 幻觉检测有效（长音频不重复）

**调优参数**：

- `SILENCE_THRESHOLD`: 默认 300，过敏感可调高到 500
- `SILENCE_DURATION_SEC`: 默认 1.2s，可调整到 0.8-1.5s
- `sendInterval`: 前端发送间隔，默认 250ms

**预计工作量**: 2-3 小时

---

## 五、性能指标

### 优化前（MediaRecorder + ffmpeg）

| 指标        | 数值              |
| ----------- | ----------------- |
| 端到端延迟  | ~500-800ms        |
| ffmpeg 转码 | 100-300ms         |
| 识别触发    | 固定 250ms 间隔   |
| CPU 占用    | 中（ffmpeg 进程） |

### 优化后（PCM 直传 + VAD）

| 指标       | 数值                  |
| ---------- | --------------------- |
| 端到端延迟 | **~300-500ms** ⬇️     |
| WAV 头生成 | **<1ms** ⬇️           |
| 识别触发   | VAD 智能触发 ✅       |
| CPU 占用   | **低**（无 ffmpeg）⬇️ |

**预期提升**：

- 延迟降低 **~200ms**
- CPU 占用降低 **~30%**
- 识别完整性提升（VAD 保证句子完整）

---

## 六、风险与应对

### 风险 1：浏览器兼容性

**问题**: `ScriptProcessorNode` 已废弃，建议用 `AudioWorklet`

**应对**:

- 先用 `ScriptProcessorNode`（所有主流浏览器都支持）
- 后续迁移到 `AudioWorklet`（更低延迟，不阻塞主线程）

---

### 风险 2：降采样质量

**问题**: 简单线性插值会导致混叠失真

**应对**:

- ✅ 使用均值抽取（整数比率）
- ✅ 非整数比率用移动平均滤波
- 测试对比原始 48kHz 和降采样 16kHz 的识别准确率

---

### 风险 3：VAD 参数调优

**问题**: 阈值不合适会导致误触发或漏触发

**应对**:

- 提供 UI 配置项（silence_threshold, silence_duration）
- 多环境测试（安静、嘈杂、不同麦克风）
- 记录日志分析 VAD 表现

---

## 七、参考代码位置

### 参考实现

- **完整代码**: `/Users/lifeng/git/git_deep/deep-study/realtime-asr/`
  - `server.py` - 服务端实现（VAD + PCM 处理）
  - `static/index.html` - 浏览器端实现（降采样 + 转换）

### 需要修改的文件

- **后端**: `workers/asr/server.py`
- **前端**: `src/renderer/src/components/agent/VoicePanel.vue`

---

## 八、总结

通过参考 `realtime-asr` 的优化方案，我们可以：

1. ✅ **消除 ffmpeg 瓶颈**：端到端延迟降低 ~200ms
2. ✅ **VAD 智能触发**：保证识别完整句子
3. ✅ **幻觉检测**：提高输出质量
4. ✅ **降低 CPU 占用**：移除 ffmpeg 子进程

**核心原则**：

- 浏览器端做好降采样和格式转换
- 服务端用轻量级 wave 模块替代 ffmpeg
- VAD 检测停顿触发识别，而非固定时间间隔

**实施顺序**：

1. 先优化后端（server.py）
2. 再优化前端（VoicePanel.vue）
3. 最后测试调优

预计总工作量：**2-3 天**（包含测试和调优）

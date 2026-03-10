# 安全沙箱与基础设施深度分析

## 1. 安全沙箱

### 1.1 path-guard（路径守卫）

| 文件            | 职责                                           |
| --------------- | ---------------------------------------------- |
| `path-guard.ts` | 路径解析、workspace 边界检查、symlink 穿越防护 |

**机制**：

- `resolveSandboxPath(path, workspaceRoot)`：解析路径，确保在 workspace 内
- `resolveWorkingDirectory(cwd, workspaceRoot)`：解析工作目录
- symlink 穿越检测：防止通过符号链接逃逸到 workspace 外

**问题**：

- 读操作（read、search、glob）部分工具已用 path-guard，但 Gateway HTTP 的 readOnly 操作未统一做 path-guard
- files.copy 仅校验 targetDir，未校验 sourcePath

### 1.2 exec-policy（命令策略）

| 文件             | 职责                                          |
| ---------------- | --------------------------------------------- |
| `exec-policy.ts` | 三层防护：黑名单、白名单、动态 allowlist 学习 |

**机制**：

- **黑名单**：危险命令始终拒绝
- **白名单（SAFE_BINS）**：只读/低风险命令直接放行
- **动态 allowlist**：approve-always 时 `learnExecCommand()` 写入 `learned-commands.json`

**问题**：

- `learned-commands.json` 无签名校验，可被篡改
- 策略由 Extension Hook（tool-approval）调用，exec 工具内部不直接检查

### 1.3 command-scanner（命令扫描）

| 文件                 | 职责                                 |
| -------------------- | ------------------------------------ |
| `command-scanner.ts` | 检测危险命令模式、敏感路径、脚本内容 |

**机制**：

- `scanCommand(command, workingDir)`：检查 DANGEROUS_PATTERNS、敏感目录
- `scanScriptContent(scriptContent)`：检查 Python/Node 脚本中的敏感文件访问
- `SAFE_COMMAND_PREFIXES`：node、python、npm、pnpm 等白名单前缀

**问题**：

- **白名单过宽**：node、python 可执行任意脚本，仅检查脚本内容中的敏感路径，易绕过
- 建议对白名单命令做参数级检查

### 1.4 Docker 沙箱

| 配置                    | 说明                                        |
| ----------------------- | ------------------------------------------- |
| `security.sandbox.mode` | `path-only`（默认）/ `docker` / `off`       |
| `docker` 模式           | 通过 Docker 容器隔离 exec，当前实现依赖配置 |

---

## 2. Worker 系统

### 2.1 WorkerManager

| 职责     | 说明                                    |
| -------- | --------------------------------------- |
| 配置注册 | `register(config)`、`scanAndRegister()` |
| 生命周期 | spawn、健康检查、崩溃重启、优雅关闭     |
| 事件     | `worker:status`、`worker:log`           |

### 2.2 ManagedWorker

| 字段                           | 说明                         |
| ------------------------------ | ---------------------------- |
| config                         | WorkerConfig                 |
| process                        | ChildProcess                 |
| status                         | stopped/starting/ready/error |
| restartCount                   | 重启次数                     |
| healthCheckInterval            | 运行期健康检查定时器         |
| consecutiveHealthCheckFailures | 连续健康检查失败次数         |

### 2.3 健康检查

- **启动时**：HTTP GET `/health` 轮询直到 ready
- **运行期**：可配置 `healthCheckInterval`，周期性探测
- **问题**：运行期健康检查需在 ReadyWorkerHook 中调用 `startWatching()` 启用，当前可能未启用

### 2.4 发现的问题

| 问题                                      | 严重程度 |
| ----------------------------------------- | -------- |
| 每次启动都 `uv pip install`，未做变更检测 | 中       |
| 配置热重载未启用                          | 中       |
| venv 依赖无缓存判断                       | 中       |

---

## 3. Extension 扩展系统

### 3.1 ExtensionLoader

| 职责     | 说明                                    |
| -------- | --------------------------------------- |
| 扫描目录 | 多级目录，builtin/user/workspace 优先级 |
| 加载     | jiti 运行时编译 .ts/.js                 |
| 热插拔   | fs.watch + 300ms 防抖                   |
| 信任校验 | 非 builtin 需 verifyExtensionTrust      |

### 3.2 ExtensionHookRunner

| 职责           | 说明                                                        |
| -------------- | ----------------------------------------------------------- |
| Hook 执行      | 17 种 Hook（before_tool_call、tool_result、agent:event 等） |
| 错误隔离       | 单个 Hook 失败不阻塞                                        |
| void/modifying | 区分只读与修改型 Hook                                       |

### 3.3 Channel

| 职责     | 说明                         |
| -------- | ---------------------------- |
| 双向通信 | Extension 与主进程通信       |
| 生命周期 | start/stop 与 Extension 绑定 |

### 3.4 发现的问题

| 问题                               | 严重程度 |
| ---------------------------------- | -------- |
| Extension 在主进程运行，无沙箱     | 高       |
| 热重载竞态：卸载中被调用           | 中       |
| Extension 的 gatewayMethods 未生效 | 中       |
| Extension 的 httpRoutes 注册时机   | 中       |

---

## 4. Skill 系统

### 4.1 SkillManager

| 职责            | 说明                             |
| --------------- | -------------------------------- |
| 扫描            | 扫描 skills 目录、.cursor/skills |
| 加载            | 解析 frontmatter、SKILL.md       |
| 按 session 隔离 | sessionInstances                 |

### 4.2 发现的问题

| 问题                        | 严重程度 |
| --------------------------- | -------- |
| Skill 依赖关系未声明        | 低       |
| frontmatter 无 depends 字段 | 低       |

---

## 5. Provider 系统

### 5.1 ProviderRegistry

| 职责 | 说明                         |
| ---- | ---------------------------- |
| 注册 | register(config)             |
| 加载 | loadFromConfig(CoobeeConfig) |
| 查询 | get(id)、getEnabled()        |

### 5.2 ModelSelector

| 职责                     | 说明                      |
| ------------------------ | ------------------------- |
| 模型选择                 | 根据任务选择模型          |
| 与 ProviderRegistry 集成 | 从 Registry 获取 Provider |

### 5.3 ModelGroupResolver

| 职责                 | 说明         |
| -------------------- | ------------ |
| 模型组               | 故障转移候选 |
| getGroupCandidates() | 组内模型列表 |

### 5.4 发现的问题

| 问题                                         | 严重程度 |
| -------------------------------------------- | -------- |
| LLMClient 未接入 ProviderRegistry            | 中       |
| Quality Loop 的 Validator 使用独立 LLMClient | 中       |
| ModelFallback 无重试间隔                     | 低       |

---

## 6. Thread 系统

### 6.1 ThreadStore

| 职责   | 说明                                                          |
| ------ | ------------------------------------------------------------- |
| 持久化 | .home/threads/{threadId}.json                                 |
| CRUD   | create、get、update、delete、list                             |
| 事件   | thread:created、thread:updated、thread:deleted、thread:status |

### 6.2 ThreadWaker

| 职责 | 说明                            |
| ---- | ------------------------------- |
| 监听 | thread:wake 事件                |
| 恢复 | 从 checkpoint 恢复挂起的 Thread |
| 审批 | 与 HITL 协同                    |

### 6.3 发现的问题

| 问题                                        | 严重程度       |
| ------------------------------------------- | -------------- |
| approval-done 事件已废弃但仍兼容            | 低             |
| ThreadStore 与 CheckpointManager 无锁并发写 | 高（已有分析） |

---

## 7. Process 系统

### 7.1 ProcessRegistry

| 职责     | 说明                              |
| -------- | --------------------------------- |
| 托管进程 | 通过 exec 工具启动的后台进程      |
| 输出缓冲 | 环形缓冲区，MAX_OUTPUT_LINES=1000 |
| 上限     | MAX_PROCESSES=20                  |

### 7.2 发现的问题

| 问题                                                 | 严重程度 |
| ---------------------------------------------------- | -------- |
| Process 与 Thread 无绑定                             | 中       |
| 长进程占满后新进程无法创建                           | 中       |
| 建议在 ProcessRegistry 记录 threadId，按 Thread 清理 | -        |

---

## 8. Terminal 系统

### 8.1 PtyManager

| 职责 | 说明               |
| ---- | ------------------ |
| 创建 | create(options)    |
| IO   | 输入、输出、resize |
| 上限 | MAX_TERMINALS=10   |

### 8.2 发现的问题

| 问题                 | 严重程度 |
| -------------------- | -------- |
| PTY 环境变量全量继承 | 低       |
| 建议过滤敏感环境变量 | -        |

---

## 9. 综合问题与改进建议

### 9.1 安全

| 问题                         | 建议                             |
| ---------------------------- | -------------------------------- |
| command-scanner 白名单过宽   | 对 node/python 等做参数级检查    |
| Extension 无沙箱             | 考虑 Worker 进程隔离或权限边界   |
| files.copy 未校验 sourcePath | 对 sourcePath 做 isPathSafe 校验 |
| 读操作无路径边界限制         | 对 readOnly 操作也做 path-guard  |
| learned-commands.json 无签名 | 增加完整性校验或用户确认         |
| HTTP API 无认证              | 增加 token 或 IPC 校验           |

### 9.2 架构

| 问题                               | 建议                                      |
| ---------------------------------- | ----------------------------------------- |
| LLMClient 与 ProviderRegistry 脱节 | 统一接入 ProviderRegistry + ModelFallback |
| Process 与 Thread 无绑定           | 在 ProcessRegistry 记录 threadId          |
| Worker 配置热重载未启用            | ReadyWorkerHook 中调用 startWatching()    |
| Extension 热重载竞态               | 加锁或版本号，避免卸载中被调用            |

### 9.3 性能

| 问题                        | 建议                 |
| --------------------------- | -------------------- |
| venv 每次启动都 pip install | 增加依赖锁和缓存判断 |
| ModelFallback 无重试间隔    | 增加可配置的 delayMs |

### 9.4 体验

| 问题                 | 建议                          |
| -------------------- | ----------------------------- |
| Skill 依赖未声明     | frontmatter 增加 depends 字段 |
| PTY 环境变量全量继承 | 过滤敏感环境变量              |

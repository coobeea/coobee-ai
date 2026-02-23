# 排查 exec 工具执行错误

## 问题描述

用户反馈：在对话过程中，`exec` 工具执行时报错"没找到这个工具"。

## 可能的原因

### 1. Agent 配置中未包含 exec 工具

**症状**：LLM 尝试调用 `exec` 工具，但系统报告"工具不存在"。

**排查方法**：

```bash
# 检查 Agent 配置文件
cat agents/<agent-id>.json
```

**查看 `tools` 字段**：

```json5
{
  tools: [
    'read',
    'write',
    // ... 其他工具
    'exec' // 确保包含 exec
  ]
}
```

**解决方案**：

1. 如果 Agent 配置中没有 `exec`，添加它：

   ```json5
   "tools": ["read", "write", "edit", "exec", "search", "glob"]
   ```

2. 或者，如果希望 Agent 使用所有工具，省略 `tools` 字段（继承全部）：
   ```json5
   {
     id: 'agent-id',
     name: 'Agent Name'
     // 不设置 tools 字段，自动继承所有工具
   }
   ```

---

### 2. Python 解释器未找到

**症状**：`exec` 工具成功调用，但执行 Python 脚本时报错 "python: command not found"。

**排查方法**：

```bash
# 检查 Python 是否安装
which python
which python3

# 检查版本
python --version
python3 --version
```

**解决方案**：

1. 确保系统已安装 Python 3：

   ```bash
   # macOS
   brew install python3

   # Linux
   sudo apt install python3
   ```

2. 或者在脚本调用时使用明确的路径：

   ```bash
   # 而不是
   python skills/model-config/scripts/list_models.py

   # 使用
   python3 skills/model-config/scripts/list_models.py
   ```

---

### 3. 脚本路径错误

**症状**：`exec` 工具报告"文件不存在"。

**排查方法**：

```bash
# 检查脚本是否存在
ls -la skills/model-config/scripts/

# 应该看到
# -rwxr-xr-x  1 user  staff  5416 Feb 23 00:32 add_model.py
# -rwxr-xr-x  1 user  staff  3321 Feb 23 00:32 list_models.py
```

**解决方案**：
确保脚本路径正确，从**项目根目录**执行：

```bash
python3 skills/model-config/scripts/list_models.py
```

---

### 4. 缺少 json5 依赖

**症状**：脚本执行时报错 "ModuleNotFoundError: No module named 'json5'"。

**排查方法**：

```bash
# 检查 json5 是否已安装
python3 -c "import json5; print('json5 is installed')"
```

**解决方案**：

```bash
# 安装 json5
pip3 install json5
```

---

### 5. 工作目录问题

**症状**：脚本执行时找不到配置文件 `.home/config/coobee.json5`。

**排查方法**：

```bash
# 检查当前工作目录
pwd

# 应该在项目根目录
# /Users/lifeng/git/git_agents/coobee-ai

# 检查配置文件是否存在
ls -la .home/config/coobee.json5
```

**解决方案**：
确保 `exec` 工具的工作目录设置正确（默认是项目根目录）。

---

## 完整的排查清单

### 步骤 1：检查 exec 工具是否可用

```bash
# 在项目根目录执行
cd /Users/lifeng/git/git_agents/coobee-ai

# 手动测试 exec 工具（通过一个简单命令）
# 如果这个命令失败，说明 exec 工具本身有问题
# 如果成功，说明问题在 Python 脚本上
```

### 步骤 2：检查 Python 环境

```bash
# 检查 Python
which python3
python3 --version

# 检查 json5
python3 -c "import json5; print('OK')"

# 如果失败，安装 json5
pip3 install json5
```

### 步骤 3：手动测试 Python 脚本

```bash
# 从项目根目录执行
python3 skills/model-config/scripts/list_models.py

# 应该输出 JSON 格式的模型列表
# 如果成功，说明脚本本身没问题
# 如果失败，查看错误信息
```

### 步骤 4：检查 Agent 配置

```bash
# 查看当前 Agent 的配置
cat agents/<agent-id>.json

# 确认 tools 字段包含 "exec"
```

### 步骤 5：查看具体的错误日志

如果问题仍未解决，需要查看：

1. LLM 的具体错误信息（"没找到这个工具"的完整输出）
2. exec 工具的执行日志
3. Python 脚本的 stderr 输出

---

## 推荐的调试方法

### 方法 1：在 Skill 中添加调试信息

修改 `model-config` Skill，在调用脚本前先检查环境：

```bash
# 在 Skill 中建议 LLM 先执行
which python3

# 然后再执行
python3 skills/model-config/scripts/list_models.py
```

### 方法 2：使用详细的错误处理

在 Python 脚本中添加更详细的错误信息（已实现）：

- 脚本使用 JSON 格式输出错误到 stderr
- LLM 可以解析错误并采取对应措施

---

## 常见错误及解决方案

### 错误 1: "python: command not found"

**原因**：系统中没有安装 Python，或 Python 命令名称不是 `python`。

**解决**：

```bash
# 使用 python3 而不是 python
python3 skills/model-config/scripts/list_models.py
```

### 错误 2: "ModuleNotFoundError: No module named 'json5'"

**原因**：缺少 json5 依赖。

**解决**：

```bash
pip3 install json5
```

### 错误 3: "Configuration file not found"

**原因**：脚本找不到 `.home/config/coobee.json5` 文件。

**解决**：

- 确保在项目根目录执行脚本
- 检查配置文件是否存在

### 错误 4: "Tool 'exec' not found"

**原因**：Agent 配置中未包含 `exec` 工具。

**解决**：

- 修改 Agent 配置，添加 `"exec"` 到 `tools` 数组
- 或省略 `tools` 字段，使用所有工具

---

## 下一步行动

1. **收集具体的错误信息**：
   - 完整的错误消息
   - 执行的命令
   - Agent ID

2. **验证基础环境**：

   ```bash
   python3 --version
   pip3 show json5
   ls skills/model-config/scripts/
   ```

3. **手动测试脚本**：

   ```bash
   cd /Users/lifeng/git/git_agents/coobee-ai
   python3 skills/model-config/scripts/list_models.py
   ```

4. **检查 Agent 配置**：
   - 确认 `tools` 字段包含 `"exec"`
   - 或确认未设置 `tools` 字段（继承全部）

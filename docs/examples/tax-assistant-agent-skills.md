# 示例：创建"增值税助手" Agent 及其专属 Skills

本示例展示如何创建一个专业的"增值税助手" Agent，并为其配置专属的税务相关 Skills。

## 第 1 步：创建 Agent 定义

在 `agents/` 目录下创建 `tax-assistant.json`：

```json
{
  "id": "tax-assistant",
  "name": "增值税助手",
  "description": "专业的增值税计算、发票验证和税务咨询助手。精通中国增值税法规。",
  "instructions": [
    "你是一名专业的增值税顾问，精通中国增值税相关法律法规。",
    "你的核心能力包括：",
    "1. 增值税税率计算和应用",
    "2. 增值税专用发票验证",
    "3. 进项税额抵扣判断",
    "4. 税务申报指导",
    "",
    "你必须：",
    "- 基于最新的税法规定提供建议",
    "- 对不确定的问题明确告知用户需要咨询专业税务师",
    "- 使用你的专属 Skills（tax-calculator、tax-regulations）处理计算和查询任务"
  ],
  "model": {
    "provider": "openai",
    "model": "gpt-4o",
    "temperature": 0.2,
    "maxTokens": 4000
  },
  "tools": ["read", "write", "list_dir", "skill_list", "web_search"],
  "skills": [],
  "extensions": []
}
```

## 第 2 步：启动应用，让 Agent Home 自动创建

启动应用后，首次与 "tax-assistant" Agent 交互时，系统会自动创建：

```
.home/homes/tax-assistant/
├── BOOTSTRAP.md
├── SOUL.md
├── IDENTITY.md
├── USER.md
├── NOTES.md
├── AGENTS.md
├── HEARTBEAT.md
├── memory/
└── skills/     # ✅ Agent 级 Skills 目录（自动创建）
```

## 第 3 步：创建专属 Skill - 增值税计算器

### 3.1 创建 Skill 目录

```bash
cd .home/homes/tax-assistant/skills/
mkdir -p tax-calculator/scripts
```

### 3.2 创建 SKILL.md

`.home/homes/tax-assistant/skills/tax-calculator/SKILL.md`：

````markdown
---
name: tax-calculator
description: 增值税计算工具，支持一般纳税人和小规模纳税人的税额计算
---

# 增值税计算器 Skill

专为"增值税助手" Agent 设计的税额计算工具。

## 功能

1. **一般纳税人增值税计算**
   - 适用税率：13%、9%、6%
   - 公式：应纳税额 = 销项税额 - 进项税额

2. **小规模纳税人增值税计算**
   - 征收率：3%（疫情期间减按1%）
   - 公式：应纳税额 = 不含税销售额 × 征收率

3. **发票金额计算**
   - 含税价 → 不含税价 + 税额
   - 不含税价 → 含税价

## Scripts

### `scripts/calculate-vat.py`

\```python
#!/usr/bin/env python3
"""
增值税计算脚本

Usage:
python calculate-vat.py --type general --sales 100000 --input-tax 5000 --rate 13
python calculate-vat.py --type small --sales 50000 --rate 3
\```

import argparse

def calculate_general_taxpayer(sales: float, input_tax: float, rate: float) -> dict:
"""一般纳税人增值税计算"""
output_tax = sales \* rate / 100
payable_tax = output_tax - input_tax
return {
"type": "一般纳税人",
"不含税销售额": sales,
"销项税额": round(output_tax, 2),
"进项税额": input_tax,
"应纳税额": round(payable_tax, 2),
"含税销售额": round(sales + output_tax, 2)
}

def calculate_small_taxpayer(sales: float, rate: float) -> dict:
"""小规模纳税人增值税计算"""
payable_tax = sales \* rate / 100
return {
"type": "小规模纳税人",
"不含税销售额": sales,
"征收率": f"{rate}%",
"应纳税额": round(payable_tax, 2),
"含税销售额": round(sales + payable_tax, 2)
}

def main():
parser = argparse.ArgumentParser(description='增值税计算器')
parser.add_argument('--type', required=True, choices=['general', 'small'], help='纳税人类型')
parser.add_argument('--sales', type=float, required=True, help='不含税销售额')
parser.add_argument('--rate', type=float, required=True, help='税率或征收率(%)')
parser.add_argument('--input-tax', type=float, default=0, help='进项税额（仅一般纳税人）')

    args = parser.parse_args()

    if args.type == 'general':
        result = calculate_general_taxpayer(args.sales, args.input_tax, args.rate)
    else:
        result = calculate_small_taxpayer(args.sales, args.rate)

    print("计算结果：")
    for key, value in result.items():
        print(f"  {key}: {value}")

if **name** == '**main**':
main()
\```

### `scripts/invoice-validator.py`

\```python
#!/usr/bin/env python3
"""
增值税发票验证脚本

验证发票金额计算是否正确

Usage:
python invoice-validator.py --price 113000 --rate 13
\```

import argparse

def validate_invoice(total_price: float, rate: float) -> dict:
"""验证发票金额""" # 含税价 = 不含税价 × (1 + 税率) # 不含税价 = 含税价 / (1 + 税率)
rate_decimal = rate / 100
net_price = total_price / (1 + rate_decimal)
tax_amount = total_price - net_price

    return {
        "含税价": round(total_price, 2),
        "不含税价": round(net_price, 2),
        "税额": round(tax_amount, 2),
        "税率": f"{rate}%",
        "验证": "✅ 计算正确" if abs(net_price * rate_decimal - tax_amount) < 0.01 else "❌ 计算有误"
    }

def main():
parser = argparse.ArgumentParser(description='增值税发票验证')
parser.add_argument('--price', type=float, required=True, help='含税价')
parser.add_argument('--rate', type=float, required=True, help='税率(%)')

    args = parser.parse_args()
    result = validate_invoice(args.price, args.rate)

    print("发票验证结果：")
    for key, value in result.items():
        print(f"  {key}: {value}")

if **name** == '**main**':
main()
\```

## 使用方法

### 从 Agent 对话中调用

\```
User: 请帮我计算一般纳税人的应纳税额，销售额100万，进项税5万，税率13%

Agent: 好的，我使用 tax-calculator Skill 来计算：

[读取 Skill 文档]
read({ path: ".home/homes/tax-assistant/skills/tax-calculator/SKILL.md" })

[执行计算脚本]
bash_tool({
command: "python .home/homes/tax-assistant/skills/tax-calculator/scripts/calculate-vat.py --type general --sales 1000000 --input-tax 50000 --rate 13"
})

计算结果：
类型: 一般纳税人
不含税销售额: 1000000.0
销项税额: 130000.0
进项税额: 50000.0
应纳税额: 80000.0
含税销售额: 1130000.0

您本期应缴纳增值税 80,000 元。
\```

## 注意事项

- **仅限"增值税助手" Agent 使用**：此 Skill 位于 Agent Home 下，其他 Agent 无法访问
- **税率更新**：如果税法有变动，只需更新脚本中的税率参数
- **专业建议**：复杂的税务筹划问题仍需咨询专业税务师
````

## 第 4 步：创建专属 Skill - 税法规查询

### 4.1 创建 Skill 目录

```bash
cd .home/homes/tax-assistant/skills/
mkdir -p tax-regulations/references
```

### 4.2 创建 SKILL.md

`.home/homes/tax-assistant/skills/tax-regulations/SKILL.md`：

````markdown
---
name: tax-regulations
description: 中国增值税法规知识库，提供税率表、政策解读和常见问题解答
---

# 增值税法规知识库

存储增值税相关法律法规、政策文件和常见问题解答。

## 内容

### `references/vat-rates.md`

增值税税率表（2026年版）：

\```markdown

# 增值税税率表（2026年版）

## 一般纳税人税率

| 适用范围           | 税率 | 说明       |
| ------------------ | ---- | ---------- |
| 销售货物（大部分） | 13%  | 默认税率   |
| 农产品、图书等     | 9%   | 低税率     |
| 现代服务、金融服务 | 6%   | 服务业税率 |
| 出口货物           | 0%   | 出口退税   |

## 小规模纳税人征收率

| 类型         | 征收率 | 备注                              |
| ------------ | ------ | --------------------------------- |
| 一般销售     | 3%     | 标准征收率                        |
| 疫情期间优惠 | 1%     | 临时性减免（截至 2026年12月31日） |

## 进项税额抵扣

可抵扣项目：

- 增值税专用发票注明的税额
- 海关进口增值税专用缴款书
- 农产品收购发票（按 9% 计算抵扣）
- 通行费发票（按 3% 计算抵扣）

不可抵扣项目：

- 用于简易计税项目的购进货物
- 用于免征增值税项目的购进货物
- 用于集体福利或个人消费的购进货物
- 非正常损失对应的购进货物
  \```

### `references/common-qa.md`

常见问题解答：

\```markdown

# 增值税常见问题解答

## Q1: 一般纳税人和小规模纳税人如何区分？

**A**:

- **一般纳税人**：年应税销售额超过500万元（工业企业）或80万元（商业企业）
- **小规模纳税人**：年应税销售额低于上述标准

## Q2: 进项税额什么时候可以抵扣？

**A**: 满足以下条件：

1. 取得合法有效的扣税凭证（增值税专用发票等）
2. 用于应税项目（非免税、非个人消费）
3. 在规定期限内认证（180天内）

## Q3: 开具红字发票需要什么条件？

**A**:

- 销货退回
- 开票有误
- 销售折让
- 服务中止

需在开票系统中申请红字信息表。

## Q4: 疫情期间的增值税优惠政策有哪些？

**A**: （2026年政策）

- 小规模纳税人征收率由 3% 减按 1%
- 生活服务业增值税免征
- 公共交通运输服务免征增值税
  \```

## 使用方法

\```
User: 一般纳税人和小规模纳税人有什么区别？

Agent: 让我查询一下税法规知识库。

[读取知识库]
read({ path: ".home/homes/tax-assistant/skills/tax-regulations/references/common-qa.md" })

根据知识库，一般纳税人和小规模纳税人的主要区别在于年应税销售额：

- **一般纳税人**：年应税销售额超过500万元（工业企业）或80万元（商业企业）
- **小规模纳税人**：年应税销售额低于上述标准

此外，两者在税率、发票开具、进项税抵扣等方面也有不同规定。
\```
````

## 第 5 步：测试 Agent 及其专属 Skills

### 5.1 启动对话

```
User: 你好，我是一家公司的会计，需要咨询增值税计算问题。

Agent: 您好！我是增值税助手，专业处理增值税相关问题。我拥有以下专属技能：
- tax-calculator: 增值税计算工具
- tax-regulations: 税法规知识库

请问您需要咨询什么问题？
```

### 5.2 计算增值税

```
User: 我公司是一般纳税人，本月销售额200万（不含税），进项税额12万，适用税率13%，请帮我计算应纳税额。

Agent: 好的，我来帮您计算。

[调用 tax-calculator Skill]
bash_tool({
  command: "python .home/homes/tax-assistant/skills/tax-calculator/scripts/calculate-vat.py --type general --sales 2000000 --input-tax 120000 --rate 13"
})

计算结果：
- 类型: 一般纳税人
- 不含税销售额: 2,000,000 元
- 销项税额: 260,000 元
- 进项税额: 120,000 元
- **应纳税额: 140,000 元**
- 含税销售额: 2,260,000 元

您本期应缴纳增值税 **14万元**。
```

### 5.3 验证发票

```
User: 我收到一张增值税专用发票，含税价226万，税率13%，请帮我验证一下金额是否正确。

Agent: 好的，我来验证一下。

[调用 invoice-validator]
bash_tool({
  command: "python .home/homes/tax-assistant/skills/tax-calculator/scripts/invoice-validator.py --price 2260000 --rate 13"
})

发票验证结果：
- 含税价: 2,260,000 元
- 不含税价: 2,000,000 元
- 税额: 260,000 元
- 税率: 13%
- 验证: ✅ 计算正确

这张发票的金额计算是**正确的**。
```

## 第 6 步：验证 Skill 隔离性

### 6.1 创建另一个 Agent（如"财务分析师"）

```json
{
  "id": "finance-analyst",
  "name": "财务分析师",
  "description": "专业的财务数据分析和报表解读助手"
}
```

### 6.2 测试 Skill 隔离

```
User: [对 finance-analyst 说] 请列出你可用的 Skills

Agent: [调用 skill_list 工具]

我当前可用的 Skills：
- execution-protocol (内置)
- self-reflection (内置)
- brain (内置)
- dimension-architect (内置)
...

**注意**：tax-calculator 和 tax-regulations **没有** 出现在列表中，因为它们是 "tax-assistant" Agent 的专属 Skills。
```

## 总结

通过以上步骤，我们成功创建了一个"增值税助手" Agent，并为其配置了两个专属 Skills：

1. **tax-calculator**：增值税计算工具（Python 脚本）
2. **tax-regulations**：税法规知识库（Markdown 文档）

这些 Skills 只对 "tax-assistant" Agent 可见，其他 Agent 无法访问，实现了**技能隔离**和**专业化分工**。

## 扩展建议

### 更多专属 Skills

- **tax-planning**: 税务筹划建议工具
- **tax-reporting**: 税务申报表生成工具
- **tax-audit-checker**: 税务稽查风险检查工具

### 与其他系统集成

- 连接企业 ERP 系统读取销售数据
- 对接税务局电子税务局 API
- 生成 PDF 格式的税务报表

### 持续优化

- 定期更新 `tax-regulations` 知识库以反映最新税法变化
- 收集用户反馈，改进计算脚本的准确性
- 使用 `brain` Skill 沉淀常见问题的解决方案

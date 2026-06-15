---
name: "OHIF 自定义审计与修复"
description: "审计并修复当前 OHIF workspace 的 Copilot customization 文件。Use when reviewing .github/agents, .github/prompts, .github/skills, copilot-instructions.md, settings.json, frontmatter, folder layout, invalid .skill.md files, prompt suffixes, or repo-specific command mismatches."
argument-hint: "审计范围、是否直接修复、是否自动提交"
model: "GPT-5 (copilot)"
agent: "agent"
---

对当前 OHIF workspace 的 Copilot customization 做一次完整审计，并在必要时直接修复。

执行要求：
1. 先只读取最少必要文件，锁定最近的 customization 锚点。
2. 先判断问题属于结构错误还是内容错误。
3. 优先修复结构错误，例如错误后缀、平铺 `.skill.md`、缺少 frontmatter、`name` 与目录名不一致。
4. 再修复内容错误，例如 description 不可发现、伪造仓库命令、职责边界混乱、验证步骤缺失。
5. 编辑后做最窄验证，至少覆盖 frontmatter、文件布局和相关 JSON 语法。
6. 只有输入里明确要求时才执行 git 提交。

输出要求：
- 先列出发现的问题
- 再说明已修改或新增的 customization 文件
- 最后给出验证结果，以及是否已提交

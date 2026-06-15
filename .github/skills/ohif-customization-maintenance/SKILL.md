---
name: ohif-customization-maintenance
description: "审计、修复、标准化并验证 OHIF workspace 的 Copilot 自定义文件。Use when reviewing or updating .github/agents, .github/prompts, .github/skills, copilot-instructions.md, settings.json, frontmatter, folder layout, invalid .skill.md files, prompt suffixes, or repo-specific command alignment."
argument-hint: "目标自定义范围、是否需要提交、是否只做审计或直接修复"
---

# OHIF Customization Maintenance

## 这个 skill 产出什么
- 对当前 OHIF workspace 的 Copilot 自定义文件做一次结构化审计
- 把无效或不规范的 agent、prompt、skill、instructions 修正为可发现格式
- 校验 frontmatter、目录结构、文件命名和仓库命令是否与当前 monorepo 一致
- 在需要时提交一次非交互 git commit

## 默认行为
- 默认作用域是当前 workspace，也就是优先修改 `.github/` 和 `.vscode/` 下的共享配置
- 默认先审计再修复，不直接大范围重写已有 customization
- 默认不自动提交；只有用户明确要求“提交”“自动提交”“commit”时才执行 git 提交
- 默认把结构正确性放在内容润色前面，先消除不会被 Copilot 发现的硬错误

## 何时使用
- 发现 `.github/skills/*.skill.md` 这类平铺文件，怀疑不会被 Copilot 正常发现
- prompt 还是普通 `.md`，需要改成 `.prompt.md`
- agent、skill 或 instructions 已写好，但不确定是否专业、是否完整、是否能自动加载
- 需要把当前对话里跑通的 customization workflow 沉淀成可复用流程
- 需要继续维护 OHIF AI 推理扩展相关的 Copilot 自定义体系

## 核心决策点
- 这是 workspace 共享能力还是个人偏好：团队共享放 `.github/`，个人偏好放用户目录
- 这是 always-on 规则还是按需工作流：always-on 用 instructions，按需工作流用 skill
- 这是单次模板还是多步骤方法：单次模板用 prompt，多步骤修复流程用 skill
- 内容是否明显过大：过大就拆成多个 skill，不把所有知识塞进一个文件
- 是否需要提交：只有用户明确要求或当前任务包含“自动提交”时才走 git commit

## 建议输出格式
- 先给出发现的问题，按结构错误、内容错误、验证风险分组
- 再说明已修改或新增的 customization 文件
- 最后给出验证结果，以及是否已提交

## 操作流程
1. 先锁定最近的 customization 锚点，只读最少必要文件。
   优先检查：`.github/agents/`、`.github/prompts/`、`.github/skills/`、`.github/copilot-instructions.md`、`.vscode/settings.json`。
2. 判断当前问题是结构错误还是内容错误。
   结构错误包括：平铺 `.skill.md`、错误后缀、缺少 frontmatter、`name` 与目录名不一致。
   内容错误包括：description 不可发现、伪造不存在的构建命令、职责边界混乱、缺少步骤和验证标准。
3. 先修结构，再修内容。
   skill 必须是 `.github/skills/<name>/SKILL.md`。
   prompt 必须是 `.github/prompts/*.prompt.md`。
   agent 必须是 `.github/agents/*.agent.md`。
4. 写 frontmatter 时把 `description` 当作发现入口，而不是摘要。
   description 必须包含明确触发词，例如 `OHIF`、`nnU-Net`、`YOLO`、`MONAI`、`FastAPI`、`prompt`、`skill`、`agent`、`frontmatter`、`layout`。
5. 让内容与当前仓库事实对齐。
   优先从本地包、脚本、扩展入口文件获取锚点，不要写不存在的命令或 API。
6. 如果一个 skill 代表的是成熟 workflow，就写出步骤、决策分支和完成标准。
   至少包含：何时使用、实施步骤、关键约束、完成定义。
7. 编辑后立即做最窄验证。
   校验文件存在、frontmatter 开头正确、skill `name` 与目录名一致、JSON 文件无错误、旧格式文件已移除。
8. 若用户要求自动提交，则使用非交互 git 提交，并在提交前确认工作区只包含本次预期改动。

## 邻接动作
- 如果用户反复用自然语言描述同一类审计任务，补一个 `.prompt.md` 作为直接入口
- 如果团队需要更稳定的审查边界，补一个只读 reviewer agent 专查 frontmatter、命名和发现性
- 如果问题集中在 `.vscode/settings.json`，考虑再拆一个 settings 专项 skill

## 推荐校验清单
- `SKILL.md` 位于正确目录，且 `name` 与目录名一致
- `.prompt.md`、`.agent.md` 后缀正确
- frontmatter 存在且 `description` 明确
- `.vscode/settings.json` 无语法错误
- 内容引用的是当前仓库真实存在的扩展、脚本和命令
- 不保留会误导团队的旧格式 customization 文件

## 常见失败模式
- 写了很多内容，但文件路径和命名不符合 Copilot 规范
- skill 描述过于抽象，导致模型根本不会自动发现它
- 说明里保留了仓库中不存在的脚本名
- 把 instructions、prompt、skill 的职责混在一起
- 编辑后没有做 frontmatter 和布局校验
- 没有声明默认是否自动提交，导致行为和用户预期不一致
- 只修了内容，没清理旧格式文件，团队仍会误用失效配置

## 完成标准
- 目标 customization 文件结构正确
- 说明内容与当前 OHIF monorepo 对齐
- 至少完成一次结构或语法层验证
- 如果用户要求提交，则已经完成本地提交并给出修改清单

## 示例调用
- `/ohif-customization-maintenance 审计当前 .github 下所有 Copilot 自定义文件，并修复无效结构`
- `/ohif-customization-maintenance 检查当前 skills 和 prompts 是否引用了不存在的 OHIF 命令`
- `/ohif-customization-maintenance 规范化当前 workspace 的 customization，并自动提交`

## 下一步可补的相关自定义
- 新增一个直接触发该 workflow 的 prompt
- 新增一个 customization reviewer agent
- 新增一个专管 Copilot settings 策略的 skill

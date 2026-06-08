# OHIF Viewer AI 推理扩展全局指令

## 适用范围
用于当前 OHIF Viewer workspace 的 AI 推理扩展开发、自定义 agent 与 skill 编写、前后端联动实现、编译测试与自动修复。

## 仓库事实
- 当前仓库是 OHIF v3 monorepo，根包版本为 `3.13.0-beta.87`。
- 扩展包位于 `extensions/*`，现有锚点优先参考 `extensions/test-extension` 和 `extensions/cornerstone-dicom-seg`。
- 根仓库存在通用脚本 `yarn build`、`yarn test:unit`，不存在 `build:ai-inference` 这类现成根脚本。
- 新 AI 扩展应优先做成独立包，例如 `extensions/ai-inference`，并在该包内提供 `build`、`dev`、`test:unit`、`test:unit:ci`。

## 非协商约束
1. 所有功能优先通过 OHIF Extension 机制实现，默认禁止修改 `platform/`、`modes/` 等核心目录。
2. nnU-Net、YOLO、MONAI 必须模型隔离，只能通过共享接口、工厂、契约和注册机制协作。
3. 不能伪造不存在的 OHIF API、脚本名或服务能力；必须先以本地代码为锚点再实现。
4. 不硬编码 API 地址、令牌、模型目录、GPU 设备号、DICOM 源地址等环境相关参数。
5. 不生成独立说明文档来替代实现；优先把知识沉淀到 `skills`、`agent`、`prompt` 和代码注释里。

## 代码与架构规范
- 扩展建议目录：

```text
extensions/ai-inference/
  package.json
  tsconfig.json
  src/
    index.tsx
    core/
      interfaces/
      factories/
      base/
    models/
      nnunet/
      yolo/
      monai/
    services/
    components/
    hooks/
    stores/
    utils/
    types/
    constants/
```

- 每个模型必须有独立的 service、adapter、renderer、types、constants。
- 前端状态优先通过 OHIF services、commands、pub/sub、stores 协调，不要用分散的组件局部状态拼接复杂业务。
- 与影像空间相关的逻辑必须显式处理 `StudyInstanceUID`、`SeriesInstanceUID`、`SOPInstanceUID`、方向矩阵、spacing、origin、坐标系。
- 公共接口、复杂转换、性能敏感逻辑必须添加专业注释，说明做什么、为什么、输入输出和注意事项。
- TypeScript 保持严格类型，不使用 `any` 逃避建模。

## 自动化开发流程
1. 先读取最近的代码锚点，再决定要新增的 extension module、panel、toolbar、viewport、service 或 backend API。
2. 先创建最小可编译骨架，再逐步加入模型实现和渲染能力。
3. 每完成一个关键切片，立刻运行最窄的构建或测试命令。
4. 对失败结果直接修复并复测，不把明显错误留到最后。
5. 如果新增 backend 服务，也要同时定义前后端共享契约、错误模型和健康检查。

## 推荐验证命令
- 前端包级构建：`yarn --cwd extensions/ai-inference build`
- 前端包级测试：`yarn --cwd extensions/ai-inference test:unit:ci`
- 根级回归：`yarn test:unit --runInBand --passWithNoTests`
- Python 后端测试：`pytest -q`

## 自定义能力装配要求
- `.github/agents/*.agent.md` 必须使用有效 frontmatter，并限制为最小必要工具集。
- `.github/prompts/*.prompt.md` 必须是单任务、参数化、可发现的 prompt 文件。
- `.github/skills/<name>/SKILL.md` 必须使用目录化结构，`name` 与目录名一致，`description` 包含明确触发词。
- 优先把专业流程拆成多个小 skill，而不是把所有内容堆到一个长文件里。

## 验收标准
- 自定义 agent、prompt、skill 结构可被 Copilot 发现。
- 技能内容覆盖扩展架构、模型集成、后台服务、渲染/MPR、数据契约、验证闭环。
- 说明与当前 OHIF monorepo 真实结构一致。
- 不保留明显无效的旧格式文件或误导性命令。

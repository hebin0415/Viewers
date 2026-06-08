---
name: ohif-ai-extension-architecture
description: "规划和实现 OHIF AI inference extension 架构。Use when creating extensions/ai-inference, defining package structure, wiring index.tsx modules, adding panels/toolbars/commands/viewports, isolating nnU-Net YOLO MONAI implementations, or aligning with existing OHIF extension patterns."
argument-hint: "目标能力、扩展模块范围、是否包含 panel/toolbar/viewport"
---

# OHIF AI Extension Architecture

## 何时使用
- 新建 `extensions/ai-inference` 包
- 重构 AI 扩展目录结构
- 设计模型工厂、共享接口、错误模型、配置模型
- 决定哪些能力应做成 command、panel、toolbar 或 viewport module

## 本地锚点
- 轻量扩展锚点：[test-extension package](../../../extensions/test-extension/package.json)
- 扩展入口锚点：[test-extension index](../../../extensions/test-extension/src/index.tsx)
- 分割类扩展锚点：[dicom-seg package](../../../extensions/cornerstone-dicom-seg/package.json)
- 视口模块锚点：[dicom-seg index](../../../extensions/cornerstone-dicom-seg/src/index.tsx)
- monorepo 脚本锚点：[root package](../../../package.json)

## 目标结构
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

## 实施步骤
1. 先复制一个最接近的扩展包骨架，不要从空白想象 OHIF 扩展结构。
2. 新包名称建议为 `@ohif/extension-ai-inference`，包级脚本至少包括 `build`、`dev`、`test:unit`、`test:unit:ci`。
3. 在 `src/index.tsx` 只做注册和装配，不把模型逻辑塞进入口文件。
4. 在 `src/core/interfaces` 定义统一接口，例如 `IModelInferenceService`、`IModelRenderer`、`IAiResultAdapter`。
5. 在 `src/core/factories` 用模型名称和结果类型做工厂分发，避免业务层到处 `switch`。
6. 把模型差异收敛到 `src/models/<model>/`，每个模型独立维护 service、adapter、renderer、types、constants。
7. 把跨模型共享能力放在 `services`、`stores`、`utils`，但不要让共享层反向依赖某个具体模型。
8. 需要界面时，优先做成 panel 或 toolbar 控制，不要一开始就定制 viewport。
9. 需要和 OHIF 状态同步时，优先用 servicesManager、commandsManager、pub/sub，而不是分散的组件局部状态。

## 关键约束
- 默认不修改 `platform/`、`modes/`；只有证明扩展机制做不到时才升级决策。
- UI 控制层不得直接知道模型内部实现细节，只消费统一 view model。
- 配置必须可替换，优先环境变量、运行时配置或注册表，而不是代码常量。
- 每个模型目录都要能单独被理解和测试。

## 最小完成定义
- 扩展包可被 monorepo 识别
- 入口文件只负责注册和依赖注入
- 模型间不存在直接 import 耦合
- 至少一个包级构建或测试命令可运行
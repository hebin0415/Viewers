---
name: monai-integration
description: "集成 MONAI 到 OHIF 和后台服务。 Use when implementing MONAI segmentation, detection, classification, transforms, inferers, post-processing adapters, task-based renderers, or flexible medical imaging pipelines that may output labelmaps, boxes, scores, or surfaces."
argument-hint: "MONAI 任务类型、输出格式、前端展示方式"
---

# MONAI Integration

## 适用场景
- 需要支持多个 MONAI 任务类型
- 同一个模型家族下既有分割又有检测或分类
- 需要更灵活的前后处理流水线

## 架构原则
- 先按 `taskType` 分层，再按具体模型名扩展。
- `MONAI` 目录中至少拆成 `service`、`task adapters`、`renderers`。
- 前端不能假设所有 MONAI 结果都是分割；必须根据任务类型分流。

## 推荐实现
1. `service` 负责发起请求和接收统一响应。
2. `task adapter factory` 根据 `taskType` 返回 segmentation、detection、classification 或 surface adapter。
3. `renderer factory` 根据前端目标视图和结果类型决定渲染器。
4. 后端把 transforms、inferers、post transforms 封装在模型执行层，不泄漏到 API 之外。

## 结果映射建议
- segmentation -> labelmap 或 contour
- detection -> boxes 或 points
- classification -> series 或 study 级标签卡片
- surface/mesh -> 仅在需要 3D 可视化时启用

## 关键风险
- 为了兼容所有 MONAI 任务而把前端接口做成超大联合类型，导致难以维护
- 后端把 MONAI pipeline 细节直接暴露给前端
- 不同任务共用同一 renderer，造成类型和行为混乱

## 最低验证
- 至少验证两种不同任务类型的分流正确
- 未支持的任务类型会给出明确错误
- 输出格式变化时只影响对应 adapter，不影响整体架构
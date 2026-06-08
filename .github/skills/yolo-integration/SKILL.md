---
name: yolo-integration
description: "集成 YOLO 到 OHIF 和后台服务。Use when implementing lesion detection, slice-based inference, bounding box overlays, confidence filtering, multi-plane box mapping, CT intervention candidate marking, or YOLO request batching for DICOM slices."
argument-hint: "输入粒度、检测类别、坐标空间"
---

# YOLO Integration

## 适用场景
- 切片级病灶检测
- 候选区域框选与置信度展示
- 多平面候选点提示

## 核心原则
- 检测结果必须绑定到具体切片或明确的空间坐标。
- 置信度过滤是 view model 能力，不应写死在后端输出中。
- 前端渲染层不直接依赖 YOLO 原始输出数组下标。

## 前端实现步骤
1. 在 `src/models/yolo/` 建立独立 service、adapter、renderer、types、constants。
2. adapter 把后端返回的框转换为前端统一 detection result 结构。
3. renderer 按 `imageId`、`sopInstanceUID` 或 slice 索引为当前视口筛选框。
4. UI 要支持类别显隐、颜色映射、置信度阈值、标签显示开关。
5. 必要时为 MPR 不同平面分别维护索引，而不是简单复用同一组 2D 框。

## 后端实现步骤
1. 明确输入是单切片、批量切片还是 MPR 重建后的 plane。
2. 对推理前图像窗宽窗位、归一化和尺寸缩放做显式配置。
3. 返回框时必须说明坐标空间和引用切片。
4. 若使用批处理，结果要能稳定映射回原始切片顺序。

## 关键风险
- 坐标是模型输入尺寸而不是原始影像尺寸
- 切片顺序和返回顺序不一致
- 只在当前轴位有效，切换 MPR 后结果错位
- 阈值改动需要重新请求后端，导致交互迟钝

## 最低验证
- 框、标签、置信度显示正确
- 调整阈值只触发前端过滤时仍然正确
- 切换切片或视口布局时不会显示错位框
- 不同类别颜色稳定且可配置
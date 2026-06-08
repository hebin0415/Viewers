---
name: nnunet-integration
description: "集成 nnU-Net 到 OHIF 和后台服务。Use when implementing medical image segmentation, DICOM-to-volume preprocessing, nnU-Net inference calls, labelmap conversion, contour rendering, multi-label visualization, or CT lesion segmentation workflows."
argument-hint: "任务类型、输入格式、期望渲染形式"
---

# nnU-Net Integration

## 适用场景
- CT 或 MRI 病灶分割
- 体数据分割结果回传到 OHIF
- labelmap、contour 或 DICOM SEG 相关实现

## 输入输出基线
- 输入：DICOM 序列、重建体数据或后端转换后的 NIfTI
- 输出：体级分割结果，至少包含 label value、空间信息和类别元数据
- 可选输出：轮廓、DICOM SEG、表面 mesh

## 前端实现步骤
1. 在 `src/models/nnunet/` 中定义独立的请求类型、响应类型、service、adapter、renderer。
2. 请求层只负责提交任务和获取结果，不在 service 内部做 UI 状态控制。
3. 结果 adapter 负责把后端 payload 转成 OHIF 可消费的 volume segmentation view model。
4. renderer 负责 labelmap 或 contour 叠加，并提供颜色、透明度、显隐控制。
5. UI 控件要支持多标签启停和当前标签高亮。

## 后端实现步骤
1. 把 DICOM 体数据转换、重采样、标准化与 nnU-Net 调用拆开。
2. 保留原始空间方向与体素信息，避免回传时丢失定位能力。
3. 模型执行完成后输出统一契约，不要把 nnU-Net 原始目录结构直接暴露给前端。
4. 大体积结果优先使用压缩文件或对象存储引用，避免直接内嵌超大数组。

## 关键风险
- LPS/RAS 方向混淆导致病灶漂移
- 重采样后 spacing 没有回写
- 多标签颜色和 label value 映射不稳定
- 一次性把整卷数组塞进浏览器导致内存暴涨

## 最低验证
- 单标签与多标签分割都能正确显示
- 三正交视图位置一致
- 显隐、透明度、轮廓/填充切换生效
- 契约包含完整空间字段
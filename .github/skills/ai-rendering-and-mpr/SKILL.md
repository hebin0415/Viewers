---
name: ai-rendering-and-mpr
description: "在 OHIF 中渲染 AI 结果并支持 MPR 同步。Use when overlaying segmentation, contour, detection boxes, labels, confidence, opacity, color controls, multi-viewport synchronization, slice mapping, or CT intervention planning workflows across axial coronal sagittal views."
argument-hint: "结果类型、视口范围、MPR 或 3D 范围"
---

# AI Rendering And MPR

## 何时使用
- 在 OHIF 视口叠加分割或检测结果
- 实现轴位、冠状位、矢状位 MPR 同步展示
- 增加显示/隐藏、透明度、颜色、阈值等交互
- 处理 CT 介入定位场景的多平面结果一致性

## 渲染策略
- 分割结果：优先使用 Cornerstone 分割能力或可回溯的 labelmap/contour 渲染。
- 检测结果：优先使用与影像切片绑定的 annotation 或 overlay，而不是悬浮绝对定位 DOM。
- 3D 表面：只在当前模式真正需要 3D 视图时启用，避免默认把复杂 surface 渲染引入 2D 流程。

## MPR 同步原则
- 所有结果都应绑定到明确的参考空间，而不是只绑定当前视口索引。
- 切片级结果需要能映射到 `SOPInstanceUID`、`frameNumber` 或 world position。
- 体级分割要在三正交视图中共享同一结果源，避免每个视口各自复制结果状态。
- 监听 OHIF 服务事件或 viewport 变更事件，优先 pub/sub，不要依赖脆弱的定时轮询。

## 实施步骤
1. 先确认结果类型和目标视口，再决定 renderer 是 labelmap、contour、annotation 还是 surface。
2. 把渲染状态抽象成统一 view model，例如 `visible`、`opacity`、`colorMap`、`threshold`、`activeLabel`。
3. UI 控件只更新 view model，由 renderer 订阅并刷新显示。
4. 对检测结果按切片或体位建立索引，避免每次视口变更都全量扫描结果。
5. 对大体积分割启用懒加载、缓存或分块转换，避免一次性占满内存。
6. 对 MPR 交互先保证正确性，再做缓存和渲染性能优化。

## 介入场景重点
- 轴位、冠状位、矢状位必须看到同一病灶的空间一致位置。
- 用户切换窗口宽窗位、缩放、平移后，AI 结果不能丢失锚点。
- 颜色和透明度默认值要兼顾病灶可见性与原始 CT 可读性。
- 检测框和分割结果同时存在时，要有清晰的图层优先级与图例。

## 验证清单
- 同一结果在三正交视图上位置一致
- 显示/隐藏、透明度、颜色切换即时生效
- 切换序列或 display set 后不会错误复用旧结果
- 大序列滚动时没有明显卡顿或内存失控
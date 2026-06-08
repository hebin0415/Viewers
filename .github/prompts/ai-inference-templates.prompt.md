---
name: "OHIF AI 推理集成实施模板"
description: "为当前 OHIF workspace 生成或执行 AI inference 集成任务。Use when planning or implementing nnU-Net, YOLO, MONAI, FastAPI backend, segmentation, detection, MPR overlay, extension scaffolding, compile/test loops, or CT intervention workflows."
argument-hint: "模型范围、前后端范围、目标交付物、验收标准"
agent: "OHIF AI扩展开发专家"
model: "GPT-5 (copilot)"
---

基于当前 OHIF workspace，执行一次完整的 AI 推理集成开发任务。

输入约束：
- 模型范围：`nnU-Net` / `YOLO` / `MONAI` / 组合
- 前端范围：extension 架构 / panel / toolbar / viewport overlay / MPR 同步 / 结果管理
- 后端范围：`FastAPI` 优先，必要时兼容 `Flask`
- 结果类型：分割 / 检测 / 分类 / 3D 表面
- 验收方式：构建、单测、联调、性能约束

执行要求：
1. 先以本地 OHIF 扩展代码为锚点，不要假设不存在的 API。
2. 自动选择并组合相关 skills：扩展架构、数据契约、后台服务、渲染与 MPR、模型专项、验证闭环。
3. 如目标扩展尚不存在，先创建 `extensions/ai-inference` 最小骨架和包级脚本。
4. 实现过程中保持模型隔离，禁止在不同模型实现之间直接耦合。
5. 每完成关键切片就运行最窄验证命令并修复问题。

输出要求：
- 直接落地代码或 customization 文件。
- 简明总结已改内容、验证结果、仍需后续实现的边界。
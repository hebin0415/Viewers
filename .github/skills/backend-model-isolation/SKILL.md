---
name: backend-model-isolation
description: "隔离 nnU-Net YOLO MONAI 后端实现。 Use when designing model registry, execution sandboxes, GPU scheduling, dependency isolation, per-model configs, result adapters, or avoiding cross-model coupling inside the AI inference backend."
argument-hint: "模型组合、资源隔离、运行方式"
---

# Backend Model Isolation

## 何时使用
- 后台服务同时托管多个模型家族
- 需要处理不同依赖、不同资源需求、不同返回格式
- 需要避免一个模型改动影响其他模型

## 设计原则
- 每个模型家族都有自己的配置、执行器、后处理器和错误映射。
- 统一入口只负责注册、鉴权、队列和契约，不直接写模型细节。
- 模型注册表明确声明依赖、资源、任务类型、输入输出约束。

## 实施步骤
1. 定义 `ModelRegistryEntry`，包含 `name`、`family`、`taskType`、`runner`、`resourceProfile`。
2. 为每个模型家族实现独立 runner，例如 `NnUNetRunner`、`YoloRunner`、`MonaiRunner`。
3. 把后处理和结果适配留在家族内部，统一出口再映射到共享契约。
4. 若依赖冲突明显，优先用独立 worker 或容器隔离，不要在一个进程里硬拼。
5. GPU 调度要考虑串行队列、并发上限和 OOM 回退策略。

## 验证清单
- 新增一个模型不会改动其他模型目录内代码
- 各模型失败时错误信息可区分来源
- 资源限制与模型配置可单独调整
- 统一 API 输出仍然保持一致

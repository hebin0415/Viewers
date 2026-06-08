---
name: ai-backend-service
description: "实现 OHIF AI inference 配套后台服务。Use when creating FastAPI or Flask services for nnU-Net YOLO MONAI inference, health endpoints, model registry, async jobs, DICOMweb ingestion, preprocessing, GPU execution, result persistence, or frontend integration contracts."
argument-hint: "后端框架、模型类型、同步或异步执行"
---

# AI Backend Service

## 何时使用
- 为 OHIF 扩展增加推理 API
- 创建 `FastAPI` 或 `Flask` 服务项目
- 设计模型注册、任务队列、结果缓存和健康检查
- 实现 DICOM 到模型输入的预处理流程

## 默认选择
- 优先 `FastAPI`：类型清晰、异步友好、OpenAPI 自带、适合多模型统一网关。
- 只有在现有后端生态已固定为 Flask 时，才退回 Flask。

## 推荐目录
```text
backend/ai-inference-service/
  app/
    main.py
    api/
      routes/
        health.py
        models.py
        inference.py
        jobs.py
    core/
      settings.py
      logging.py
      security.py
    schemas/
    services/
      model_registry.py
      dicom_loader.py
      preprocessing.py
      result_store.py
      queue.py
      nnunet_service.py
      yolo_service.py
      monai_service.py
    workers/
    tests/
```

## 最小接口集
- `GET /health`：进程、依赖和模型可用性
- `GET /models`：可用模型、任务类型、输入要求、版本
- `POST /infer`：统一入口，根据 `taskType` 和 `modelName` 分发
- `POST /infer/segmentation`：可选的显式分割入口
- `POST /infer/detection`：可选的显式检测入口
- `GET /jobs/{jobId}`：异步任务状态
- `GET /results/{inferenceId}`：结果提取或下载

## 实施步骤
1. 先落共享契约和配置层，再落各模型服务实现。
2. 把模型注册表做成显式结构，包含模型名、版本、任务类型、输入要求和资源需求。
3. DICOM 读取、NIfTI 转换、重采样、标准化等预处理放到共享服务层。
4. `nnU-Net`、`YOLO`、`MONAI` 各自单独封装调用逻辑，不共享内部推理代码。
5. 大体积 CT 推理默认支持异步任务和结果缓存，避免阻塞 HTTP 请求。
6. 把 GPU/CPU 设备、批大小、模型路径、缓存目录全部配置化。
7. 错误要区分用户输入问题、数据读取问题、模型执行问题和基础设施问题。

## 医疗影像注意事项
- 预处理后必须保留与原始 DICOM 的可追溯映射。
- 坐标系转换必须能回到前端渲染所需的空间定义。
- 对多期相、多序列、多 frame 数据要明确限制或支持策略。
- 不在日志中打印受保护的影像内容或敏感患者信息。

## 验证要求
- 至少有健康检查测试和一个推理接口测试。
- 若引入异步队列，要有状态流转测试：`queued -> running -> completed/failed`。
- 返回结果必须能被前端契约直接消费，不要求前端做二次猜测。
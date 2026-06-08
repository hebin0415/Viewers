---
name: inference-data-contracts
description: "设计 OHIF 前后端 AI inference 数据契约。Use when defining TypeScript types, Pydantic models, request/response payloads, DICOM identifiers, world or pixel coordinate mapping, async job payloads, segmentation metadata, detection boxes, or error schemas for nnU-Net YOLO MONAI integrations."
argument-hint: "结果类型、同步或异步模式、坐标空间"
---

# Inference Data Contracts

## 何时使用
- 设计前后端请求与响应结构
- 定义共享 TypeScript 类型和 Python Pydantic 模型
- 统一分割、检测、分类和 3D 结果的元数据
- 处理 DICOM UID、空间方向、切片索引和坐标空间

## 契约设计原则
- 每次推理都要有稳定的 `inferenceId`、`modelName`、`modelVersion`、`taskType`。
- 请求必须包含影像锚点：`studyInstanceUID`、`seriesInstanceUID`，必要时包含 `sopInstanceUIDs` 或 `imageIds`。
- 体数据结果必须显式返回 `dimensions`、`spacing`、`origin`、`direction`、`coordinateSystem`。
- 检测结果必须说明其坐标空间：`pixel`、`image`、`world` 三者之一。
- 错误响应必须统一为 `code`、`message`、`details`、`retriable`。

## 推荐请求模型
```json
{
  "inferenceId": "uuid",
  "taskType": "segmentation",
  "modelName": "nnunet-liver-v2",
  "studyInstanceUID": "1.2.3",
  "seriesInstanceUID": "4.5.6",
  "input": {
    "source": "dicomweb",
    "imageIds": [],
    "frameOfReferenceUID": "..."
  },
  "options": {
    "labels": [1, 2],
    "returnContours": false,
    "async": true
  }
}
```

## 推荐响应模型
```json
{
  "inferenceId": "uuid",
  "status": "completed",
  "taskType": "segmentation",
  "resultFormat": "labelmap-volume",
  "model": {
    "name": "nnunet-liver-v2",
    "version": "2026.06"
  },
  "reference": {
    "studyInstanceUID": "1.2.3",
    "seriesInstanceUID": "4.5.6",
    "frameOfReferenceUID": "..."
  },
  "spatial": {
    "dimensions": [512, 512, 320],
    "spacing": [0.8, 0.8, 1.0],
    "origin": [0, 0, 0],
    "direction": [1, 0, 0, 0, 1, 0, 0, 0, 1],
    "coordinateSystem": "LPS"
  },
  "labels": [
    { "value": 1, "name": "lesion", "rgba": [255, 80, 80, 180] }
  ],
  "payload": {
    "uri": "...",
    "encoding": "gzip-nifti"
  }
}
```

## 分任务要求
- 分割：优先体级结果，必要时补充 contour 或 DICOM SEG 导出信息。
- 检测：每个框至少包含 `sopInstanceUID` 或可回溯的 `imageId`，并带 `confidence`、`label`、`bbox`。
- 分类：必须注明粒度，是 study、series、volume 还是 slice 级分类。
- 3D 表面：返回 surface mesh 时必须说明顶点坐标空间和面片索引约定。

## 实施步骤
1. 先定义共享领域模型，再生成前端 TS 类型和后端 Pydantic 模型。
2. 为同步请求和异步作业各定义一套状态字段，不要复用模糊的 `status` 字符串。
3. 先决定结果在前端如何落点，再反推最小必要字段。
4. 把空间变换需要的字段显式建模，禁止依赖隐含默认值。
5. 给每个契约加版本号或兼容字段，避免以后破坏联调。

## 常见错误
- 只返回像素数组，不返回空间信息
- 只返回类别名字，不返回稳定 label value
- 检测框没有引用到具体切片
- 失败响应结构和成功响应结构差异过大，导致前端难以统一处理

---
name: ai-validation-and-release
description: "验证 OHIF AI inference 扩展和后台服务。Use when running compile, typecheck, unit tests, smoke checks, contract verification, regression checks, or final readiness review for extensions/ai-inference and its backend service."
argument-hint: "前端、后端或联调范围"
---

# AI Validation And Release

## 何时使用
- 完成一个前端或后端切片后立即验证
- 在提交前做最终检查
- 修复编译、测试、契约或联调问题

## 前端验证顺序
1. 包级构建：`yarn --cwd extensions/ai-inference build`
2. 包级单测：`yarn --cwd extensions/ai-inference test:unit:ci`
3. 必要时做根级回归：`yarn test:unit --runInBand --passWithNoTests`
4. 如新增视口或交互能力，再补最小手动 smoke 验证

## 后端验证顺序
1. 契约模型测试
2. 健康检查与配置测试
3. 推理路由测试
4. `pytest -q`

## 联调检查
- 前端请求字段与后端 schema 完全一致
- 错误响应结构统一
- 同步/异步两条路径的 `status` 语义一致
- 结果中的空间信息足以驱动前端渲染

## 完成标准
- 不依赖仓库中不存在的脚本名
- 没有新增明显 JSON、TypeScript、Python 语法错误
- AI 扩展不污染其他 OHIF 扩展的默认行为
- 自定义 agent、prompt、skill 文件结构正确，名称和 frontmatter 一致

## 常见失败模式
- 只跑根级命令，遗漏新包局部错误
- 后端通过测试，但返回 payload 缺少空间字段
- 前端构建通过，但视口模块注册名与实际导出不一致
- 保留旧格式 `.skill.md` 文件，导致团队误用无效配置
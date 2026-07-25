# Browser SAM 开发记录（2026-07）

## 本次完成

- 修复 input_points 4D Tensor 错误
- 修复 processor 调用方式（位置参数）
- 修复 post_process_masks this 丢失导致 feature_extractor undefined
- Browser SAM 已可成功生成 Mask
- UI 已支持：
  - Point Prompt
  - Box Prompt
  - Overlay Mask
  - Confirm / Retry

---

## 当前存在的问题

1. SAM 能生成 Mask，但精度较低。

表现：

- 桌子容易识别成柜门
- 墙面容易识别成整面墙
- 小物体识别不稳定

2. 当前仅使用 Point + Box Prompt。

没有：

- Color Constraint
- Largest Connected Component
- Box Crop
- Semantic Filtering

因此 Mask 质量仍需提升。

---

## 下一步

优先级：

**P1** 接 Replicate API

实现：

Mask → Flux → 材料替换

**P2** 优化 Browser SAM：

- Box 内颜色约束
- Largest Connected Component
- Box Crop
- 多点 Prompt

**P3** 评估是否迁移：

Python SAM2 替代 Browser SAM。

---

## 修改文件

本次与 Browser SAM / Inpaint 相关的改动文件：

新增：

- `services/localSamService.ts` —— Browser SAM 加载与 Mask 生成（本次三处修复的核心文件）
- `services/inpaintService.ts` —— 前端调用 `/api/inpaint` 的服务
- `server/inpaintHandler.ts` —— 后端 inpaint 处理逻辑（Replicate SDXL-inpainting）
- `api/inpaint.ts` —— `/api/inpaint` API 路由

修改：

- `components/MoodBoardDesigner.tsx` —— 智能选区交互（Point / Box Prompt、Overlay Mask、Confirm / Retry）
- `package.json` / `package-lock.json` —— 新增依赖（`@xenova/transformers`、`replicate`）

---

## 当前状态

- Browser SAM：✅ 可运行
- Mask：✅ 可生成
- UI：✅ 可交互
- Flux：❌ 尚未接入
- Replicate：❌ API 未配置
- Python SAM：❌ 未启用

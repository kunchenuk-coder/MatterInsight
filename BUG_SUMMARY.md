# MatterInsight Bug / 经验汇总

> 与 `PROJECT_MEMORY.md` 配套。Agent 做 GitHub 推送前先读记忆库。

---

## Git / GitHub 推送（2026-08-05 复盘）

### 为什么「之前推送不成功」（或看起来不成功）

| # | 现象 | 真实原因 | 误判点 |
|---|------|----------|--------|
| 1 | Agent 报 commit/push 失败 | Windows **PowerShell 不支持** bash HEREDOC：`git commit -m "$(cat <<'EOF' ...)"` | 把 shell 语法错误当成「GitHub 拒绝推送」 |
| 2 | 用户以为没推上去 | **第一次 push 其实已成功**；后续因 HEREDOC/重复操作报错，掩盖成功事实 | 未立刻用 `git status` / `git log origin/main` 核对 |
| 3 | 「代码已推，Admin 仍是旧版/虚拟数据」 | Git → 只更新 Vercel 项目 **`matterinsight`** 的默认生产域名；`matterinsightadmin.vercel.app` 是**手动 alias**，钉在旧 deployment（曾落后约 36 天） | 把「Admin 没更新」当成「push 失败」 |
| 4 | 本地 `.vercel` 链错项目 | 曾 link 到过期的 `material-matters`，不是线上主站 `matterinsight` | 本地 CLI 操作与线上主站脱节 |

**结论：** 多数不是 GitHub 权限或仓库坏了，而是 **(A) PowerShell 提交语法** + **(B) 推送成功与 Admin 域名未同步** 两件事被混为一谈。

### 这一次为什么成功（可复用流程）

1. **提交用 PowerShell 兼容写法**  
   `git add <文件>` → `git commit -m "简明说明"` → `git push -u origin HEAD`
2. **推送后立刻验远端**  
   `git status` 显示 `up to date with 'origin/main'`；`git log origin/main -1` 与本地 HEAD 一致。
3. **分清三层「上线」**  
   - GitHub `main`：源码真相  
   - Vercel `matterinsight.vercel.app`：跟 Git 自动部署  
   - `matterinsightadmin.vercel.app`：**同一项目**上的手动 alias，推送后若仍旧，执行：  
     `vercel alias set matterinsight.vercel.app matterinsightadmin.vercel.app`
4. **不要建第二个 Admin Vercel 项目**（当前账号下也没有独立 `matterinsightadmin` 项目）；靠域名 + `isAdminHost()` 区分门户即可。
5. **业务「假数据」另查**：Schema 迁移可能已在 Supabase；Admin 旧 UI 优先查 alias/部署，再查 `VITE_SUPABASE_*` 是否指向 `wwtfjxrfnkoixgptuemw`。

### 经验口诀

```
PowerShell 不用 HEREDOC → 先 status/log 确认 push → Admin 域名再 alias 一次
```

---

## 线上图片裂图 / 白块消失（2026-08-05）

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | 主站裂图 | `/api/get-read-url` ESM 缺 `.js` → MODULE_NOT_FOUND | `api/`/`server/` 相对导入补 `.js`；删假 Next `pages/api` |
| 2 | HTTPS 页空白/裂图 | ali-oss 签出 `http://` 混合内容 | `forceHttpsUrl` + 前端升 https |
| 3 | 后台白块（非裂图） | 刷新失败把 `image` 置 `''`；Admin SSO 同域 API 401 | 禁止置空；Admin 改打主站 API + CORS |
| 4 | 整站「配置缺失」 | 本地 `--prebuilt` 未注入 `VITE_SUPABASE_*` | 优先 Git 云端构建；prebuilt 前确认 env |

口诀：`OSS 私有桶要签 URL → ESM 带 .js → 强制 https → 失败不置空 → Admin 走主站 API → 推送后 alias Admin`

---

## Browser SAM 开发记录（2026-07）

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

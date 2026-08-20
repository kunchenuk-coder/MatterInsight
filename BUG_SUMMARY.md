# MatterInsight Bug / 经验汇总

> 与 `PROJECT_MEMORY.md` 配套。Agent 做 GitHub 推送前先读记忆库。  
> **鉴权 / 材料列表相关修改前：必读下方 P0 与 `PROJECT_MEMORY.md` §0.5。**

---

## 推广专题 What's New（2026-08-20）

> **功能：** 材料商撰文 → 提交审核 → Admin 通过后出现在探索库黑色栏目；访客点击整栏进入 `/topics/:id`。  
> **不是**材料商自发布。状态只能经 security definer RPC 变更。专题正文 **禁止**写入 LocalStorage。

### 已修 Bug

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | 保存草稿 / 提交审核报 `infinite recursion detected in policy for relation "topic_articles"` | `topic_articles` 与 `topic_article_versions` 的 RLS 互相 `EXISTS` 查对方；Postgres 会评估每条 permissive 策略 | `topic_article_has_published` / `topic_article_is_active` / `topic_article_owned_by`（SECURITY DEFINER）切断环；迁移 `20260820193000_fix_topic_articles_rls_recursion.sql` |
| 2 | 点首页黑栏仍打开「2026 材质趋势：生物共生」假文 | 静态 hero + picsum 占位弹窗 | 假文已删；只展示 `status=published` 且未下架的版本 |
| 3 | 编辑器要逐段「添加段落 / 插入图片」 | 分块 UI | 单一窗口连续输入；拖图插在光标后；图与图之间可打字；↑↓ / 拖动换位 |
| 4 | 主页栏写死 WHAT's NEW / 推广标签 /「立即查看专题」 | 占位文案 | 大字=真实标题，小字=副标题（≤50 字）；整栏可点；悬停只去掉黑色半透明，不缩放图片 |
| 5 | 刷新 `/supplier/topics/...` 后保存失败或跳错身份 | `getAppPortal()` 只认 `/supplier-dashboard` | `/supplier/topics` 视为 supplier portal，用材料商 JWT |

### 流程与表

- 表：`topic_articles`（稳定 id）+ `topic_article_versions`（内容快照）。  
- 状态：`draft` → `pending_review` → `published`（拒绝 `rejected`，可改后再交；改已发布会复制新草稿，线上仍显示旧版直到新版通过）。  
- RPC：`submit_topic_article_version`、`withdraw_topic_article_version`、`approve_topic_article_version`、`reject_topic_article_version`、`archive_topic_article`。  
- OSS 目录：`topics`（压缩 + 预签名，只存 `ossObjectKey`）。  
- Admin：`TOPICS` / 推广专题审核（待审池，非卡死 FIFO）。

### 防复发

- **禁止**客户端 `.update({ status: 'published' })`；状态只走 RPC。  
- **禁止**专题 JSON 写入 LocalStorage（库已 QuotaExceeded）。  
- 首页无已发布专题时：保留黑底栏 + 默认介绍，**不要**再挂假文章。  
- 远程 schema 须 MCP/`apply_migration`，只推 git 不会改 Supabase。

---

## P0 · SSO 互踢跳错账号 + 材料双状态（2026-08-12）

> **严重程度：P0（安全 + 数据一致性）** · 同类问题已反复出现两次。  
> **规范依据：《登录架构宪法》§4.2 / §4.3**

### 现象

1. **SSO 互踢后跳错账号**：Localhost 材料商登录顶号后，网页端未回登录页，反而进入 **设计师后台**（身份污染 / 越权观感）。
2. **材料商后台双状态**：同一材料（如「水泥花砖」）同时显示「待审核」与「已通过」；控制台 `QuotaExceededError` / `Failed to save library`（`matter_insight_library` 体积可达 ~700KB+）。

### 根因

| # | 根因 | 违宪点 |
|---|------|--------|
| 1 | 互踢只 `signOut` **当前 portal**，同浏览器残留 `designer-auth-session` | 未全退 |
| 2 | 踢后 `location.assign(原路径)` 或软跳到 `/`；`/` 默认 portal=designer → `restoreSession` 静默恢复设计师 | 未硬跳 `/login` |
| 3 | `library` / `pending` 读写 LocalStorage；云端空数组不覆盖（`if (length > 0)`）→ 脏 pending 与已发布并存 | 禁止业务 LocalStorage |
| 4 | 材料商未坚持以 `fetchSupplierMaterials(supplier_id)` 为唯一列表源，易与全局库/本地状态 merge | 数据唯一真理源 |

### 修复方案（已落地原则）

1. **全退策略**：互踢时清除 designer + supplier + admin 全部 Auth Session / 设备指纹 / 对应 storageKey，再 **`window.location.replace('/login')`**。
2. **独立登录页**：`LOGIN_PATH = '/login'`；`/` 仅探索库；`isAuthRoute` 不再把 `/` 当登录页。
3. **禁用业务 LocalStorage**：禁止 `matter_insight_library` / `matter_insight_pending` 读写；启动与材料商后台挂载时 `removeItem` 清残留。
4. **云端为准**：空数组也必须 `setState`；材料商产品/待审来自 `fetchSupplierMaterials`，展示侧对已发布 id 去重。
5. **探索水合守卫**：`libraryHydrated` 完成前不渲染空 Feed（骨架屏），避免闪回。

### 防复发警告（给 Agent / 后人）

- 修改 `useDeviceSessionGuard` / `authService` / `App` 路由守卫时：**禁止**恢复「只退当前 portal」的互踢逻辑。
- 修改材料列表同步时：**禁止**重新启用 LocalStorage 水合或 `if (cloud.length > 0) setState`。
- 登录落地 **禁止**再用 `/`；测试互踢必须验证：被踢端只能停在 `/login`，且同浏览器刷新 `/` 不得自动进任何后台。
- 详规见 `PROJECT_MEMORY.md` §0.5。

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

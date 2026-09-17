# MatterInsight Bug / 经验汇总

> 与 `PROJECT_MEMORY.md` 配套。Agent 做 GitHub 推送前先读记忆库。  
> **鉴权 / 材料列表相关修改前：必读下方 P0 与 `PROJECT_MEMORY.md` §0.5。**  
> **2026-09-17 起：** 后续任务 **禁止**改登录页外壳（`AuthShell`）和规则文件（`NON_NEGOTIABLE_RULES.md` 等），除非用户当场手动确认。材料商**注册表单**属于入驻审核，不在此禁令内。

---

## 供应商审核 / 入驻补全（2026-09-17）

> **功能：** 材料商申请加入必须填账号名、手机号、邮箱、密码、营业执照；账号保持 `pending` / `is_verified=false`，Admin 收到待审提示后才能通过认证。  
> 证件只存 OSS object key；Admin 大图必须走 `openVerificationDoc` 刷新预签名 URL。  
> 供应商评估表用真实资料；风险预警只看报价备注里的手机号/微信号，禁止假 AI 文案。

### 已修 Bug

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | 材料商只填邮箱+执照就「注册成功」，Admin 无待审提示；多数账号 `registered_phone` 为空 | 注册表无手机号；执照上传失败仍 `onAuthSuccess`；无 `supplier_pending_review` 通知 | 注册必填手机号写入 `profiles.registered_phone`；执照失败须补交；`handle_new_user` 保持 pending；新材料商 INSERT 后通知所有 admin |
| 2 | Admin 点开低分复议弹窗后，「材料库监管」红字 1 不消失 | Tab 角标按「仍存在复议/超低分」计数，不是未读通知 | 角标改为未读 `evaluation_disputed`；点开弹窗 `markNotificationsRead` |
| 3 | 「AI检测异常：引导线下私单」以及「对话质询 / 警告处分」 | 旧 RPC 用「上架≥3 且无流水」当 Suspicious；两按钮无真实逻辑 | 删假按钮；仅当报价备注含手机号或微信号才预警，点击展示备注原文 |
| 4 | 供应商评估表缺执照/手机/图册/评分等列 | 表结构过简 | 名称+邮箱、手机、执照、上架单品（点进编辑）、PDF、点赞、浏览、综合星级、积分、流水、风险 |
| 5 | 评估表能看到证件缩略图，点大图黑屏「无法加载证件图片」 | `onOpen={setViewingVerificationDoc}` 只开弹窗，未签 OSS 可读 URL | 与「供应商认证」相同，走 `openVerificationDoc` |

### 流程

1. 材料商注册：账号名 → **手机号** → 邮箱 → 密码 → 营业执照。  
2. `status=pending`，`is_verified=false`；执照 object key + 手机写入 `profiles`。  
3. Admin 头像红点 / 「供应商认证」队列；通过认证后才能发材料。  
4. 供应商评估：点上架数字 → 点单品 → 编辑信息；点执照缩略图/「查看证件大图」刷新可读 URL。  
5. 风险：只扫描 `inquiries.supplier_quote_note` 的手机号/微信，不是 GMV 启发式。

### 关键文件 / 迁移

- 前端：`Auth.tsx`（仅材料商注册字段）、`authService.ts`、`profileService.ts`、`notificationService.ts`、`SupplierDashboard.tsx`、`AdminDashboard.tsx`、`adminAnalyticsService.ts`、`App.tsx`、`i18n/locales/{zh,en}.json`  
- 迁移（远程已 apply）：`20260917104500_supplier_signup_pending_phone_admin_notify.sql`（`supplier_pending_review` + `handle_new_user` 写手机号）  
- Git push ≠ 远程 schema；本次远程通知类型已执行。

### 防复发

- **禁止**材料商注册成功后写成 `approved` / `is_verified=true`。  
- **禁止**执照存过期预签名 URL；大图禁止只 `setViewingVerificationDoc`，必须 `openVerificationDoc`。  
- **禁止**用上架数/GMV 伪造「引导线下私单」。  
- **禁止**在未获用户当场确认时修改登录页外壳 `AuthShell.tsx`、登录专用 UI、以及规则文件（`NON_NEGOTIABLE_RULES.md` / `REGRESSION_CHECKLIST.md`）。若必须改：先停下，等用户手动点通过。  
- 材料商注册表单（手机号/执照）属于入驻审核，与「登录页外壳」分开。

---

## 材料评分 / 复议（2026-09-16）

> **功能：** 沿用现有表 `material_designer_evaluations`（禁止另建 `material_ratings`）。设计师确认承诺后提交/更新评分；项目名来自询价 `project_name` 或「项目采纳」；材料商可复议；Admin「材料库监管」看综合分、设计师邮箱、超低分红点、复议材料商手机。  
> **远程 schema 必须在 SQL Editor 跑迁移**，只推 Git 不会创建 RPC。

### 已修 Bug

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | 点提交显示失败，控制台 `Could not find the function public.submit_material_evaluation(...commitment...)` / `list_material_evaluations` | 前端已调新 RPC，远程仍是旧 2 参 `submit_material_evaluation(text, jsonb)` | 在 SQL Editor 跑 `20260916084321_material_evaluation_project_and_dispute.sql` |
| 2 | 硬刷新后 `column reference "id" is ambiguous` | `list_material_evaluations` 的 `RETURNS TABLE(id uuid, ...)` 与表列 `id` 在 PL/pgSQL 里撞名 | `#variable_conflict use_column` |
| 3 | `operator does not exist: uuid = text` / `text = uuid` | 远程 `materials.id`、`material_designer_evaluations.material_id` 为 uuid，RPC 参数/比较用了 text；列表里 `m.supplier_id = v_uid` 亦混型 | 比较两侧 `::text`；INSERT 用 `p_material_id::uuid` |
| 4 | `function public.material_display_name(uuid) does not exist` | 只定义了 `(text)` 重载，列表传入 uuid 列 | 增加 `material_display_name(uuid)`，内部转 `::text`；调用处 `e.material_id::text` |
| 5 | AI 识材 Gemini 503 / 上传失败 | 高需求未当限流；PUT 预签名非 HTTPS | `aiMaterialAnalysis` 把 503 当 rate-limit；OSS PUT 强制 HTTPS |
| 6 | 情绪板「✨上传图片」与 +/- 重叠 | 绝对定位 `right` 不够 | `MoodBoardDesigner` 上传按钮 `right-20` / `md:right-24` |
| 7 | 点设计师头像/名字未进设计师主页 | 探索库/情绪板链接未走设计师主页路由 | `DesignerAuthorLink` / `MoodBoardViewer` / `App.tsx` 情绪板返回探索库 |

### 流程

1. 设计师材料详情 →「我要评分」→ 勾选承诺 → `submit_material_evaluation`（更新走 `update_material_evaluation`）。  
2. 项目名：入参 → 询价 `project_name` → 有项目采纳则为「{材料名} 项目案例」→ 否则材料名。  
3. 材料商「我的上架单品」红点：`evaluation_added` + `tag_added` + `story_pending_review`；详情分区显示未读数后按 target 标已读。  
4. 「已评」看最新一条；「复议该评价」→ `dispute_material_evaluation` → Admin 通知 `evaluation_disputed`（可看设计师邮箱、材料商 `registered_phone`）。  
5. Admin 材料库监管「评分综合评分」：多人综合分；超低分/复议红点；点进去评分管理。

### 关键文件 / 迁移

- 前端：`services/materialEvaluationService.ts`、`MaterialEvaluationsSection.tsx`、`MaterialDetail.tsx`、`AdminDashboard.tsx`、`SupplierDashboard.tsx`、`notificationService.ts`  
- 迁移：`20260916084321_material_evaluation_project_and_dispute.sql`、`20260916125507_fix_evaluation_rpc_id_and_uuid.sql`（须在远程 SQL Editor 跑；Git push ≠ 远程库已更新）  
- 前端 UUID 字符串：`normalizeMaterialIdForEventLog`；INSERT 仍须 SQL `::uuid`。

### 防复发

- **禁止**新建 `material_ratings` 表；评分真相在 `material_designer_evaluations` + `materials.data.humanDna` 重算。  
- **禁止**用 LocalStorage 记「已评分」。  
- 远程 `materials.id` 是 uuid：比较用 `::text` 或 `::uuid` 对齐，禁止裸 `uuid = text`。  
- 改 RPC 后必须在 SQL Editor 执行；只推 GitHub 线上仍会 `schema cache` 找不到函数。

---

## 供应商入驻审核（2026-08-21）

> **功能：** 材料商注册必须提交账号名、邮箱、密码、营业执照 → 进入 Admin「供应商认证」→ 通过后才能发布材料。  
> 证件存 OSS `verification` 目录的 object key；Admin 用预签名 URL 查看原图。

### 已修 Bug

| # | 现象 | 原因 | 修复 |
|---|------|------|------|
| 1 | 新供应商入驻后 Admin 供应商认证为空 | `handle_new_user` 把所有人写成 `status=approved` + `is_verified=true`；队列还要求必须已有 `verification_doc_url` | 供应商默认 `pending` / `is_verified=false`；队列列出所有未认证供应商；无证件也可出现并提示「未上传」 |
| 2 | 材料商头像常年红数字 3，卡片右上角红点，但没有新通知 | 头像把「待报价询价条数」当通知；卡片用材料 JSON 里写死的 `isAcknowledged=false` | 头像只计 `notifications` 未读；去掉卡片伪红点 |
| 3 | Admin 点「查看证件」看不到文件 | 前端把过期预签名 URL 写入 `verification_doc_url`，且无缩略图 | 写入 OSS object key；认证列表缩略图 + 大图刷新可读 URL |

### 流程

1. 注册（材料商）：账号名 → 邮箱 → 密码 → 营业执照。  
2. `profiles.status=pending`，`is_verified=false`；登录后只能看到「审核中」，不能发布材料。  
3. Admin「供应商认证」看账号名 / 邮箱 / 执照；无执照不能点「通过认证」。  
4. `approveSupplier` 写 `status=approved` + `is_verified=true`（非管理员无法改这两列）。

### 防复发

- **禁止** `handle_new_user` 再给供应商默认 approved/verified。  
- **禁止**用询价/小样 `status=pending` 条数充当头像通知数字。  
- 营业执照只存 object key，不要存预签名 URL。

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

## Git 提交与部署强制规范（2026-09-14 起 · 每次 push 必执行）

> Agent / 开发者每次 `git commit` / `git push` **必须按下列顺序执行**。跳过任一步视为违规。  
> Windows PowerShell：**禁止** bash HEREDOC（`git commit -m "$(cat <<'EOF' ...)"`），改用 `git commit -m "简明中文说明"`。

### 一、提交前必做流程

**第 1 步：暂存本次功能的全部改动（含新建文件）**

```powershell
git add .
```

必须确保所有新创建的文件（新组件、新 service、新工具函数、新 i18n、新 migration 等）都进入暂存区。  
例外（不得入库）：`.env*`、密钥、`supabase/.temp/`、登录/注册页无关改动、明确无关的本地草稿。

**第 2 步：检查暂存区状态**

```powershell
git status
```

必须确认本次功能涉及的文件都在 `Changes to be committed` 下。若新文件仍在 `Untracked files` 或 `Changes not staged for commit`，说明 `git add` 遗漏，必须重新执行第 1 步。

**第 3 步：本地构建验证（commit 之前）**

```powershell
npm run build
```

本地 `build` 失败则 **禁止** commit 和 push。

**第 4 步：提交并核对 commit 内容**

```powershell
git commit -m "简明中文说明"
git status
git log --oneline -5
```

确认最新 commit 包含本次所有改动文件，没有遗漏。

**第 5 步：推送并核对远端**

```powershell
git push -u origin HEAD
git status
git log -1
```

期望：`main` 与 `origin/main` 一致。

### 二、禁止行为

- 禁止跳过 `git add .`（或等价的完整暂存）直接 `git commit`
- 禁止跳过 `git status` 检查直接提交
- 禁止在本地 `npm run build` 失败时强行 push
- 禁止只提交部分功能文件（例如只提交修改过的文件，遗漏新创建的组件 / service）

### 三、Admin 后台域名同步

每次向 `main` 推送并触发 Vercel 部署后，必须确认两个域名都指向**最新成功的 Production 部署**：

| 站点 | 地址 | 更新方式 |
|------|------|----------|
| 主站 | https://matterinsight.vercel.app | Vercel 跟 `main` 自动部署（须 **Ready**，Error 不算上线） |
| Admin | https://matterinsightadmin.vercel.app | **手动 alias**，推送不会自动改 |

若 Admin 仍是旧版，执行：

```powershell
npx vercel alias set matterinsight.vercel.app matterinsightadmin.vercel.app
```

口诀：`git add 含新文件 → status 核对暂存 → npm run build → commit/push → 确认 Vercel Ready → alias Admin`

### 四、历史踩坑记录（2026-09-14）

`MaterialDetail.tsx` 引用了 `projectAdoptionService` 相关的 3 个新文件，但 commit 时未把新建文件加入暂存，导致这 3 个文件未进仓库。本地能跑（文件在硬盘上），Vercel 拉取后找不到文件，**生产构建失败**，线上继续服务 24 天前的旧包。

- **根因：** 跳过了完整 `git add` 与 `git status` 检查。
- **解决：** 补交 `d3c1812`，重新部署成功，并同步 Admin alias。

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

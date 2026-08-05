# MatterInsight 项目记忆库（防呆手册）

> **用法：** 每次在 Cursor 新开对话处理本项目时，先 `@PROJECT_MEMORY.md` 或粘贴本文要点。  
> **硬规则：** 用户只要提到 **推送 GitHub / git push / 发到远端**，Agent **必须先读本文**（尤其 §9），再执行 commit/push。详见 `.cursor/rules/github-push-memory.mdc`。  
> **更新日期：** 2026-08-05  
> **仓库：** https://github.com/kunchenuk-coder/MatterInsight.git  
> **当前 HEAD（参考）：** `73ccf16` — Fix: 修复线上OSS图片裂图与Admin白块，并固化防复发规范  
> **Supabase 项目：** `matterinsight` / `wwtfjxrfnkoixgptuemw`（ap-southeast-1）  
> **Vercel 主站项目：** `matterinsight`（`prj_PN5lW6r3wwhLBdV4YkwoBOFOuRhK`）— Admin 域名是同项目 alias，**不是**独立项目  

---

## 0. 一句话架构

React + Vite 前端，按 **portal（designer / supplier / admin）** 拆分 Auth storage；业务数据以 **Supabase Postgres + RLS** 为准，LocalStorage 仅作降级缓存。OSS 图片走阿里云私有桶，展示前必须刷新可读 URL。

---

## 1. 今日已修 Bug（必须记住）

### 1.1 小样申请 ID / 读写错位

| 现象 | 原因 | 正确做法 |
|------|------|----------|
| 材料商后台看不到小样 | 前端用水合 LocalStorage 空数组、或 RLS/session portal 不对 | 登录后强制 `fetchSampleRequestsForUser` / RPC `list_my_sample_requests` |
| 发货按钮无效 | 普通 UPDATE 被 RLS 静默 0 行 | 走 security definer RPC `ship_sample_request(p_request_id, p_tracking_number)` |
| ID 对不上 | 前端状态枚举与 DB 小写不一致 | DB：`pending` / `shipped` / `completed`；前端映射为 `PENDING` / `SHIPPED_BY_*` |

**关键文件：** `services/commerceRequestService.ts`、`App.tsx` hydrate、`supabase/migrations/20260804111111_*`、`20260804113224_ship_sample_request_rpc.sql`

### 1.2 状态流转不同步

- 材料商「已寄出」必须写云端 `status='shipped'` + `shipped_at`，设计师端「申请记录」从云端拉取后才能显示「已寄出」。
- 询价报价：`inquiries.status='quoted'` + `supplier_quote_price` + `quoted_at`；同时 `is_read_by_designer=false`。
- **禁止**只改前端 state / LocalStorage 当作业务真相。

### 1.3 通知角标与已读逻辑

**设计师 Navbar 红点（真实逻辑）：**

```
count = count_designer_unread_requests()
      = sample_requests(designer_id=me, is_read_by_designer=false)
      + inquiries(designer_id=me, is_read_by_designer=false)
      （可选再加 notifications.story_featured）
```

| 事件 | 字段变化 |
|------|----------|
| 材料商寄出小样 | `sample_requests.is_read_by_designer = false`（在 `ship_sample_request` 内） |
| 材料商报价 | `inquiries.is_read_by_designer = false`，`quote_read_at = null` |
| 设计师打开「申请记录」或报价详情 | RPC `mark_designer_requests_read()` → 全部标 `true`，角标清零 |

**材料商角标：** pending 小样 + pending 询价 + `notifications.type='tag_added'` 未读。

**迁移：** `20260804113948_designer_unread_and_avatar.sql`  
**前端：** `App.tsx`（`designerUnreadRequests`）、`DesignerDashboard.tsx`（进 RECORDS 调 mark）

### 1.4 本地与线上环境差异

| 环境 | URL | 注意 |
|------|-----|------|
| Local 设计师/材料商 | `localhost:3000` | 有热更新；LocalStorage 可能污染数据 |
| Local/线上 Admin | `/admin` 或 `matterinsightadmin.vercel.app` | **与主站同一 Vercel 项目** `matterinsight`；Admin 是手动 alias，不会随每次 deploy 自动更新 |
| 线上设计师站 | `matterinsight.vercel.app` | HTTPS；OSS `http://` 会混合内容空白 |
| Supabase | `wwtfjxrfnkoixgptuemw.supabase.co` | 迁移要用 MCP/`apply_migration` 或 SQL Editor，不只靠 git |

**常见坑：**

1. Git 已推送，但 `matterinsightadmin.vercel.app` 仍显示旧菜单 → **alias 钉在旧 deployment**（不是缺第二个 Vercel 项目）。修好：`vercel alias set matterinsight.vercel.app matterinsightadmin.vercel.app`。
2. Local 材料商有情绪标签、线上/设计师没有 → LocalStorage 有缓存，云端 `materials.data.humanDna` 被清空或不完整（缺 `application_cases` 等会白屏）。
3. PowerShell **不支持** bash HEREDOC（`$(cat <<'EOF'`）；提交用 `git commit -m "..."`。曾因此误判「推送失败」。
4. 打开 Admin 若先看到 Vercel 登录页 → Deployment Protection（`*.vercel.app` 需 Vercel 账号），不是业务登录坏了。

### 1.5 情绪标签显示逻辑

**权威来源优先级：**

1. RPC `list_material_mood_tags(material_id)`  
   - 先读 `materials.data.humanDna.mood_tags`  
   - 若空：从 `material_tag_relation` + `tag_pool` **重建**，并回写 humanDna（heal）
2. 前端 `MaterialDetail` 挂载时调用 `fetchMaterialMoodTags`（勿只信嵌入 JSON / mock）
3. 写入：`submit_material_mood_tag` / `vote_material_mood_tag`（security definer；设计师不能直接 UPDATE materials）

**已知根因（黑色大理石案例）：**  
`material_tag_relation` 有行，但 `data.humanDna` 整段缺失（材料商本地仍显示）→ 设计师空白。  
**修复提交：** `aabd06e` + 迁移 `20260804115720_fix_mood_tags_fetch_and_vote.sql`

### 1.6 数据持久化：LocalStorage vs Supabase

| 数据类型 | 真相来源 | LocalStorage |
|----------|----------|--------------|
| 小样 / 询价 | Supabase 表 + RPC | **Supabase 模式下不要再回写**（避免空数组覆盖） |
| 材料库列表 | `materials` + `enrichMaterialsWithFreshImages` | 可缓存，但 payload 过大（>512KB）会跳过并报 `QuotaExceededError` |
| 情绪标签 / 灵感故事 | 表 + humanDna / RPC | 仅乐观 UI |
| 头像 | `profiles.avatar`（优先存 **object key**） | 展示前 `resolveProfileAvatarUrl` 刷新签名 |

**硬规则：** 业务状态以云端为准；LocalStorage 失败不得阻塞主流程。

### 1.7 Profile 头像空白

- 列名是 `profiles.avatar`（不是 `avatar_url`）。
- 旧数据常为过期 OSS 签名 URL → 必须 `parseOssObjectKey` + `/api/get-read-url`。
- 新上传优先持久化 `objectKey`（`AvatarUpload.tsx`）。

### 1.8 材料主图空白 / 裂图（线上）— 2026-08-05 已闭环

**现象对照**

| 表现 | 常见原因 |
|------|----------|
| 裂图（破图图标） | 过期签名 URL / `http` 混合内容 |
| 白块消失（`src=""`） | 刷新失败后把签名 URL **清空成空串** |
| 仅 Admin 白块 | `matterinsightadmin.vercel.app` 有 Vercel SSO，同域 `/api/get-read-url` → 401 |

**根因链（已修）**

1. 图片在 **阿里云 OSS 私有桶**，不在 `public/`。权威：`materials.oss_object_key` + `data.image`。
2. `"type":"module"` 下 Vercel 函数相对导入缺 `.js` → `ERR_MODULE_NOT_FOUND` → API 500。
3. `ali-oss` 默认签出 `http://` → HTTPS 页混合内容。
4. `resolveUrlFromMap` 曾在刷新失败时 `return ''` → 后台白块；且污染 Admin 独立 LocalStorage。
5. Admin SSO：必须改调主站 `https://matterinsight.vercel.app/api/get-read-url` + CORS。

**硬规则（防复发）**

- 展示前必须 `enrichMaterialsWithFreshImages` / `fetchReadUrlsForObjectKeys`。
- **禁止**刷新失败时把 `image` 静默置空；至少 `http→https` 保留。
- 服务端签读 URL 一律 `forceHttpsUrl`。
- `api/`↔`server/` 相对导入必须带 `.js` 扩展名。
- Admin 域名走主站 get-read-url；推送后执行 `vercel alias set matterinsight.vercel.app matterinsightadmin.vercel.app`。
- **禁止**本地 `vercel build --prebuilt` 时漏掉 `VITE_SUPABASE_*`（会整站「配置缺失」）；优先 Git 推送触发云端构建，或确认 env 已注入再 prebuilt。
- 列：`materials.oss_object_key` + `data.image`（持久化优先 object key）。

---

## 2. 核心数据表与字段约束

### 2.1 `sample_requests`

| 字段 | 说明 |
|------|------|
| `designer_id` / `supplier_id` / `material_id` | uuid → profiles / materials |
| `status` | **`pending` \| `shipped` \| `completed`**（小写） |
| `receiver_name` / `phone` / `address` | 收件信息 |
| `tracking_number` / `shipped_at` | 发货 |
| `is_read_by_designer` | bool，默认 true；寄出后 false |

**RPC：** `ship_sample_request`、`list_my_sample_requests`、`count_my_pending_sample_requests`、`count_designer_unread_requests`、`mark_designer_requests_read`

### 2.2 `inquiries`

| 字段 | 说明 |
|------|------|
| `status` | **`pending` \| `quoted` \| `closed`** |
| `supplier_quote_price` / `supplier_quote_note` / `quoted_at` | 报价 |
| `quote_read_at` | 设计师已读报价时间 |
| `is_read_by_designer` | 报价后 false；申请记录已读 true |
| 结构化字段 | `project_name`、`project_location`、`estimated_area`、`delivery_date`、`remarks` |

### 2.3 `notifications`

- `type`：`tag_added`、`inquiry`、`sample_request`、`story_featured`、`quote_received` 等  
- `is_read`、`receiver_id`、`target_id`  
- RPC：`create_notification`、`mark_notifications_read`

### 2.4 `materials`（Human DNA）

- JSON：`data.humanDna.mood_tags` / `inspiration_stories` / `evaluations` / `application_cases`
- 统计列：`view_count`、`favorite_count`、`quote_count`、`official_mood_tags`、`oss_object_key`
- 状态：探索库查询用 **`已发布` / `published`**；草稿 `draft`

### 2.5 情绪标签相关表

- `tag_pool`（`tag_word` unique）
- `material_tag_relation`（singular，业务写入用；注意与旧名 `material_tag_relations` 区分）
- tag_type 常见：`官方标签`、`自定义标签`

### 2.6 `profiles`

- `role`：小写 `designer` \| `supplier` \| `admin`
- `avatar`、`company`、`username`、`is_verified`、`status`

---

## 3. 前端状态枚举映射（防呆）

```
DB sample status     → 前端 SampleRequest.status
pending              → PENDING
shipped              → SHIPPED_BY_SUPPLIER | SHIPPED_BY_ADMIN
completed            → COMPLETED

DB inquiry status    → 前端 Inquiry.status
pending              → PENDING
quoted               → QUOTED
closed               → COMPLETED
```

映射集中在 `services/commerceRequestService.ts` 的 `mapSampleStatus` / `mapInquiryStatus`。

---

## 4. Portal / Auth / RLS 约束

1. **一邮箱可多身份，但 session 按 portal 分 storage**（`utils/appPortal.ts`、`services/supabaseClient.ts`）。
2. Admin 入口：`isAdminPortal()`（host/path）；非 admin 不得挂载 Admin UI，且 **禁止乱 signOut 清掉其他 portal**。
3. 材料商写材料：必须用 **supplier portal JWT**（详情页 URL 默认可能是 designer portal）。
4. 设计师不能靠 RLS 直接 UPDATE `materials` 改标签 → 必须 RPC。
5. UPDATE 需要配套 SELECT policy，否则静默 0 行——发货已用 security definer 规避。
6. **禁止**用 `user_metadata` 做授权；角色以 `profiles.role` / `app_metadata` 为准。

---

## 5. 关键路径速查

| 场景 | 文件 |
|------|------|
| 总装 / 角标 / hydrate | `App.tsx` |
| 运营后台菜单 | `components/AdminDashboard.tsx`（含 STORIES / MOOD_TAGS） |
| 设计师申请记录 | `components/DesignerDashboard.tsx` |
| 材料详情 / 情绪标签 UI | `components/MaterialDetail.tsx`、`MaterialMoodTagsSection.tsx` |
| 小样询价服务 | `services/commerceRequestService.ts` |
| 情绪标签服务 | `services/moodTagService.ts` |
| 图片刷新 | `services/materialImageService.ts`、`assetReadUrlService.ts`、`api/get-read-url.ts` |
| 路由 | `router/index.ts`、`utils/authRoutes.ts` |

**近期迁移（按时间）：**

- `20260804104703_view_count_and_notifications.sql`
- `20260804105643_admin_stats_and_supplier_eval.sql`
- `20260804111111_sample_requests_and_inquiries.sql`
- `20260804112217_fix_sample_requests_rls_and_read.sql`
- `20260804113224_ship_sample_request_rpc.sql`
- `20260804113948_designer_unread_and_avatar.sql`
- `20260804115720_fix_mood_tags_fetch_and_vote.sql`
- `20260805030000_heal_incomplete_material_humandna.sql`（远程名 `heal_incomplete_material_humandna`）

---

## 6. 已知问题清单（未完全关闭）

| ID | 问题 | 状态 | 备注 |
|----|------|------|------|
| K1 | Admin 域名显示旧菜单/旧数据 | **已定位并处理** | 非独立项目；手动 alias 曾钉旧部署；推送后要 `vercel alias set`（见 §9） |
| K2 | LocalStorage `matter_insight_library` >512KB 跳过保存 | 已知 | 控制台 QuotaExceeded；应减负或只缓存 meta |
| K3 | 部分材料 humanDna 不完整导致详情白屏 | **库内已 heal** | 前端 `toMaterialDetail` 已 merge 默认值；仍禁止用空 mood_tags 覆盖 |
| K4 | `/api/get-read-url` ESM 缺 `.js` / Admin SSO 401 / http 签名 | **已修 2026-08-05** | 见 §1.8；仍需 Vercel `ALIYUN_OSS_*` |
| K5 | RAG / 知识图谱表格与同步 | 待查 | 提交说明「RAG表格待查」；024 迁移含 enqueue_kg_sync |
| K6 | 设计师角标与 `quote_received` 通知表双轨 | 可接受 | 角标以 `is_read_by_designer` 为主 |
| K7 | PowerShell 下 git HEREDOC「推送失败」误判 | **已写入规范** | 见 §9 / `BUG_SUMMARY.md` |

---

## 7. 给 Agent 的硬性禁令

1. **不要**把 LocalStorage 当小样/询价的 source of truth。  
2. **不要**用客户端直接 UPDATE 绕过已有 security definer RPC（发货、标签、未读）。  
3. **不要**在未确认 portal JWT 时写供应商数据。  
4. **不要**假设 `avatar_url` 字段存在；用 `avatar`。  
5. **不要**在刷新 OSS 失败时把图片 URL 置空（会变后台白块）；至少做 http→https 回退。Admin 签 URL 须打主站 API。  
6. **不要**空提交；有真实代码/迁移变更再 push。  
7. 改 schema：**先** `supabase migration new`，再改 SQL，再 `apply_migration`（远程）并推 git。  
8. **不要**在用户提「推送 GitHub」时跳过阅读本文 §9；**不要**用 bash HEREDOC 在 PowerShell 里 commit。  
9. **不要**假设存在独立 Vercel 项目 `matterinsightadmin`；Admin = 同项目 alias。

---

## 8. 快速自检命令

```powershell
git status
git log -5 --oneline
git show --name-only --oneline HEAD
```

验证未读 RPC（SQL Editor）：

```sql
select public.count_designer_unread_requests(); -- 需设计师 JWT
select public.list_material_mood_tags('589ae869-b22a-44c6-ba00-7de9f19cbe01');
```

---

## 9. Git / GitHub 推送规范（Windows · 必读）

**触发：** 用户说「推送」「push」「GitHub」「发到远端」→ **先读本节**，再操作。完整复盘见 `BUG_SUMMARY.md`。

### 为什么以前像「推送不成功」

1. PowerShell 跑 bash HEREDOC → commit 报错 → 误判整次推送失败（有时第一次其实已成功）。  
2. GitHub 已更新，但 Admin 域名仍指向旧 Vercel deployment → 误判「代码没上去」。  
3. 未用 `git status` / `origin/main` 做推送后核对。

### 成功标准流程

```powershell
# 1) 确认改动
git status
git diff
git log -3 --oneline

# 2) 暂存并提交（禁止 HEREDOC）
git add <具体文件...>
git commit -m "简明中文说明"

# 3) 推送并核对
git push -u origin HEAD
git status
# 期望：Your branch is up to date with 'origin/main'

# 4) 若用户要 Admin 同步最新构建（每次 production 后建议做）
vercel link --project matterinsight --yes
vercel alias set matterinsight.vercel.app matterinsightadmin.vercel.app
```

### 三层「上线」不要混

| 层 | 地址 | 谁更新 |
|----|------|--------|
| 源码 | GitHub `main` | `git push` |
| 主站 | `matterinsight.vercel.app` | Vercel 跟 `main` 自动部署 |
| Admin | `matterinsightadmin.vercel.app` | **手动 alias**（推送不会自动改） |

口诀：`PowerShell 不用 HEREDOC → status/log 确认 push → Admin 再 alias 一次`。

---

*本文是会话记忆摘要，细节以迁移文件与服务层代码为准。有冲突时：以已 apply 的远程 DB + `main` 最新提交为准。*

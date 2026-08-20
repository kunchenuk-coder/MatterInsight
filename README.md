<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# MatterInsight

设计材料平台（设计师 / 材料商 / 管理员）。技术栈：React + Vite + Supabase + Vercel。

View in AI Studio: https://ai.studio/apps/518c9e55-123c-4135-80e5-678f818ff401

---

## ⚠️ 核心安全与数据规范（必读）

> 任何人或 AI 改鉴权、路由、材料列表前，先读 `PROJECT_MEMORY.md` §0.5 与 `BUG_SUMMARY.md` 顶部 P0。

1. **全退策略（SSO 互踢 / 强制下线）**  
   必须清除同浏览器下 **全部 Portal**（Designer / Supplier / Admin）的 Session，并 **`location.replace('/login')`**。  
   **严禁**只清当前角色却保留其他角色 Session（会导致跳进错误后台）。

2. **禁用 LocalStorage 存业务数据**  
   **严禁**把材料库、待审列表、审核状态等写入 LocalStorage。  
   **唯一真理源 = Supabase**；云端空数组也必须覆盖内存，禁止与本地脏缓存 merge。

3. **路径隔离**  
   - `/` = 公开探索库（先逛后登录；顶部 What's New 为已审核推广专题）  
   - `/topics/:id` = 专题详情（仅 published）  
   - `/login` = 独立登录通道  
   - Admin = 独立域名 / `/admin`，不可从主站 UI 直达

---

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies: `npm install`
2. Configure `.env.local`（`VITE_SUPABASE_*`、`GEMINI_API_KEY` 等）
3. Run: `npm run dev`

更多防呆与推送规范见 `PROJECT_MEMORY.md`、`BUG_SUMMARY.md`。

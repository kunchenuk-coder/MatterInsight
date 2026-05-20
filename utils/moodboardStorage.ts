import type { MoodBoard, MoodBoardItem } from "../types";
import { dataUrlByteSize } from "./imageCompression";

const DRAFT_CACHE_PREFIX = "matter_insight_mb_draft_";
const LARGE_DATA_URL_BYTES = 120 * 1024;

function isLocalBoardItem(item: MoodBoardItem): boolean {
  return !!(item.isLocalStorageMaterial ?? item.isLocalOnly);
}

/** 去掉无效草稿键（非当前会话的临时缓存） */
export function clearMoodboardDraftCaches(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k?.startsWith(DRAFT_CACHE_PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* ignore */
  }
}

/** 配额不足时瘦身情绪板 payload，避免反复写入失败 */
export function pruneMoodboardsForQuota(boards: MoodBoard[]): MoodBoard[] {
  return boards.map((board) => ({
    ...board,
    items: board.items.map((item) => {
      const next: MoodBoardItem = { ...item };
      if (
        next.snapshotImageUrl &&
        next.imageUrl &&
        next.snapshotImageUrl === next.imageUrl
      ) {
        delete next.snapshotImageUrl;
      }
      if (isLocalBoardItem(next) && next.imageUrl && dataUrlByteSize(next.imageUrl) > LARGE_DATA_URL_BYTES) {
        delete next.imageUrl;
        delete next.snapshotImageUrl;
      }
      return next;
    }),
  }));
}

/** 按体积从大到小剥离效果图 data URL，直到能写入或无可剥 */
export function stripLargestDrawingImages(
  boards: MoodBoard[],
  maxStrip = 3
): MoodBoard[] {
  const entries: { boardId: string; itemId: string; size: number }[] = [];
  for (const b of boards) {
    for (const i of b.items) {
      if (i.type === "drawing" && i.imageUrl) {
        entries.push({ boardId: b.id, itemId: i.id, size: dataUrlByteSize(i.imageUrl) });
      }
    }
  }
  entries.sort((a, b) => b.size - a.size);
  const stripIds = new Set(entries.slice(0, maxStrip).map((e) => e.itemId));
  if (!stripIds.size) return boards;

  return boards.map((b) => ({
    ...b,
    items: b.items.map((i) =>
      stripIds.has(i.id)
        ? { ...i, imageUrl: undefined, remark: i.remark || "效果图（已释放缓存以节省空间）" }
        : i
    ),
  }));
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return e.name === "QuotaExceededError" || e.code === 22;
}

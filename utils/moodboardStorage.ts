import type { MoodBoard, MoodBoardItem } from "../types";
import { dataUrlByteSize } from "./imageCompression";

const DRAFT_CACHE_PREFIX = "matter_insight_mb_draft_";
/** Soft cap for localStorage moodboard payloads (bytes of JSON string). */
export const LOCALSTORAGE_PAYLOAD_MAX_BYTES = 500 * 1024;

function isDataUrl(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("data:");
}

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

/**
 * Strip heavy / binary fields before writing moodboards to localStorage.
 * Keeps http(s) URLs; drops data: URLs, mask base64, and duplicate snapshots.
 */
export function pruneMoodboardsForQuota(boards: MoodBoard[]): MoodBoard[] {
  return boards.map((board) => ({
    ...board,
    items: board.items.map((item) => {
      const next: MoodBoardItem = { ...item };

      // Never persist inline images / masks in localStorage.
      if (isDataUrl(next.imageUrl)) {
        delete next.imageUrl;
      }
      if (isDataUrl(next.snapshotImageUrl)) {
        delete next.snapshotImageUrl;
      }
      if (
        next.snapshotImageUrl &&
        next.imageUrl &&
        next.snapshotImageUrl === next.imageUrl
      ) {
        delete next.snapshotImageUrl;
      }

      // Extra safety for local-only cards that somehow still carry large strings.
      if (
        isLocalBoardItem(next) &&
        next.imageUrl &&
        dataUrlByteSize(next.imageUrl) > 32 * 1024
      ) {
        delete next.imageUrl;
        delete next.snapshotImageUrl;
      }

      return next;
    }),
  }));
}

/** Lightweight meta-only boards (no item payloads) for last-resort persistence. */
export function toMoodboardMetaOnly(boards: MoodBoard[]): MoodBoard[] {
  return boards.map((b) => ({
    id: b.id,
    name: b.name,
    items: [],
    isPaid: b.isPaid,
    maxMaterials: b.maxMaterials,
    visibility: b.visibility,
    isPublished: b.isPublished,
    publishedAt: b.publishedAt,
    ownerId: b.ownerId,
  }));
}

/** 按体积从大到小剥离效果图 URL（含残留 data URL），直到能写入或无可剥 */
export function stripLargestDrawingImages(
  boards: MoodBoard[],
  maxStrip = 3
): MoodBoard[] {
  const entries: { boardId: string; itemId: string; size: number }[] = [];
  for (const b of boards) {
    for (const i of b.items) {
      if (i.type === "drawing" && i.imageUrl) {
        entries.push({
          boardId: b.id,
          itemId: i.id,
          size: dataUrlByteSize(i.imageUrl),
        });
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
        ? {
            ...i,
            imageUrl: undefined,
            remark: i.remark || "效果图（已释放缓存以节省空间）",
          }
        : i
    ),
  }));
}

export function isQuotaExceededError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { name?: string; code?: number };
  return e.name === "QuotaExceededError" || e.code === 22;
}

/** Estimate JSON payload size in bytes (UTF-16-ish string length ≈ bytes for ASCII-heavy JSON). */
export function estimateJsonBytes(data: unknown): number {
  try {
    return JSON.stringify(data).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

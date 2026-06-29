import type { Material, MoodBoard, MoodBoardItem } from '../types';

function spaceDrawingItem(board: MoodBoard): MoodBoardItem | undefined {
  if (board.spaceImage) return undefined;
  return board.items.find(
    (i) =>
      i.type === 'drawing' &&
      i.imageUrl &&
      (i.remark?.includes('空间') || i.remark?.includes('效果图'))
  );
}

/** 主效果图：mainRenderImage > 非空间 drawing > spaceImage */
export function getMoodboardMainRenderImage(board: MoodBoard): string | null {
  if (board.mainRenderImage) return board.mainRenderImage;

  const nonSpaceDrawing = board.items.find(
    (i) =>
      i.type === 'drawing' &&
      i.imageUrl &&
      !(i.remark?.includes('空间') || i.remark?.includes('效果图'))
  );
  if (nonSpaceDrawing?.imageUrl) return nonSpaceDrawing.imageUrl;

  if (board.spaceImage) return board.spaceImage;
  const space = spaceDrawingItem(board);
  if (space?.imageUrl) return space.imageUrl;

  return null;
}

/**
 * 瀑布流封面优先级：
 * 1. mainRenderImage
 * 2. spaceImage（或空间效果图 drawing）
 * 3. 关联材料的第一张 project photo
 * 4. 板内材料图（item imageUrl / snapshot，非库缩略图）
 */
export function getMoodboardCoverImage(
  board: MoodBoard,
  materials: Material[]
): string | null {
  if (board.mainRenderImage) return board.mainRenderImage;

  if (board.spaceImage) return board.spaceImage;
  const space = spaceDrawingItem(board);
  if (space?.imageUrl) return space.imageUrl;

  for (const item of board.items) {
    if (!item.materialId) continue;
    const mat = materials.find((m) => m.id === item.materialId);
    if (mat?.projectPhotos?.[0]) return mat.projectPhotos[0];
  }

  for (const item of board.items) {
    if (item.type === 'drawing') continue;
    if (item.snapshotImageUrl) return item.snapshotImageUrl;
    if (item.imageUrl) return item.imageUrl;
  }

  return null;
}

export function moodboardMaterialCount(board: MoodBoard): number {
  return board.items.filter(
    (i) =>
      i.materialId ||
      i.localMaterialId ||
      i.type === 'material' ||
      i.type === 'sample'
  ).length;
}

export type MoodboardFeedMaterial = {
  itemId: string;
  materialId?: string;
  localMaterialId?: string;
  name: string;
  code: string;
  imageUrl: string | null;
  isCustom: boolean;
};

export function getMoodboardFeedMaterials(
  board: MoodBoard,
  materials: Material[]
): MoodboardFeedMaterial[] {
  const seen = new Set<string>();
  const result: MoodboardFeedMaterial[] = [];

  for (const item of board.items) {
    if (item.type === 'drawing' || item.type === 'marker') continue;
    if (!item.materialId && !item.localMaterialId && item.type !== 'sample' && item.type !== 'material') {
      continue;
    }
    const key = item.materialId ?? item.localMaterialId ?? item.id;
    if (seen.has(key)) continue;
    seen.add(key);

    const mat = item.materialId
      ? materials.find((m) => m.id === item.materialId)
      : undefined;

    const isCustom =
      Boolean(item.localMaterialId) ||
      Boolean(item.isLocalOnly) ||
      Boolean(item.isLocalStorageMaterial) ||
      (mat?.isCustom ?? false);

    result.push({
      itemId: item.id,
      materialId: item.materialId,
      localMaterialId: item.localMaterialId,
      name: item.displayName ?? mat?.name ?? '材料',
      code: isCustom ? '' : (item.displaySpec ?? mat?.specifications ?? mat?.id?.slice(0, 8) ?? '—'),
      imageUrl: item.snapshotImageUrl ?? item.imageUrl ?? mat?.image ?? null,
      isCustom,
    });
  }

  return result;
}

export type FeedEntry =
  | { kind: 'material'; material: Material; sortKey: number }
  | { kind: 'moodboard'; board: MoodBoard; sortKey: number };

/** 材料与已发布 Moodboard 混合（按间隔插入 Moodboard，Moodboard 按 published_at 降序） */
export function buildMixedFeed(
  materials: Material[],
  moodboards: MoodBoard[]
): FeedEntry[] {
  const boards = [...moodboards].sort(
    (a, b) =>
      (b.publishedAt ? new Date(b.publishedAt).getTime() : 0) -
      (a.publishedAt ? new Date(a.publishedAt).getTime() : 0)
  );

  const result: FeedEntry[] = [];
  let boardIdx = 0;
  const interval = Math.max(
    1,
    Math.min(4, Math.ceil(materials.length / Math.max(1, boards.length)))
  );

  materials.forEach((material, index) => {
    result.push({ kind: 'material', material, sortKey: index });
    if ((index + 1) % interval === 0 && boardIdx < boards.length) {
      result.push({
        kind: 'moodboard',
        board: boards[boardIdx],
        sortKey: boardIdx,
      });
      boardIdx += 1;
    }
  });

  while (boardIdx < boards.length) {
    result.push({
      kind: 'moodboard',
      board: boards[boardIdx],
      sortKey: boardIdx,
    });
    boardIdx += 1;
  }

  return result;
}

import { isSupabaseConfigured } from './supabaseClient';
import { fetchMoodboards } from './moodboardService';
import { fetchSavedMaterialIds } from './savedMaterialService';
import { fetchPublishedMaterials, fetchPendingMaterials } from './materialService';
import type { User, MoodBoard, Material, PendingMaterial } from '../types';

export interface DesignerCloudData {
  moodboards: MoodBoard[];
  savedMaterialIds: string[];
}

export interface GlobalCloudData {
  library: Material[];
  pendingMaterials: PendingMaterial[];
}

/** 登录后拉取设计师私有数据 */
export async function loadDesignerCloudData(
  userId: string
): Promise<DesignerCloudData> {
  if (!isSupabaseConfigured()) {
    return { moodboards: [], savedMaterialIds: [] };
  }
  const [moodboards, savedMaterialIds] = await Promise.all([
    fetchMoodboards(userId),
    fetchSavedMaterialIds(userId),
  ]);
  return { moodboards, savedMaterialIds };
}

/** 拉取全局材料库（已发布 + 待审核） */
export async function loadGlobalCloudData(): Promise<GlobalCloudData> {
  if (!isSupabaseConfigured()) {
    return { library: [], pendingMaterials: [] };
  }
  const [library, pendingMaterials] = await Promise.all([
    fetchPublishedMaterials(),
    fetchPendingMaterials(),
  ]);
  return { library, pendingMaterials };
}

/** 将 profile 积分同步到 User 对象 */
export function mergeUserWithCloud(user: User, points?: number): User {
  if (points === undefined) return user;
  return { ...user, points };
}

import { useEffect, useRef, useState } from 'react';
import { incrementMaterialViewCount } from '../services/materialService';

const SESSION_KEY_PREFIX = 'mi_viewed_material:';

function hasViewedInSession(materialId: string): boolean {
  try {
    return sessionStorage.getItem(`${SESSION_KEY_PREFIX}${materialId}`) === '1';
  } catch {
    return false;
  }
}

function markViewedInSession(materialId: string): void {
  try {
    sessionStorage.setItem(`${SESSION_KEY_PREFIX}${materialId}`, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

/**
 * 进入材料详情页时真实 +1 view_count（sessionStorage 防 F5 刷）。
 * 返回最新浏览次数，供顶部展示。
 */
export function useMaterialViewCount(options: {
  materialId: string | null | undefined;
  initialCount?: number;
  /** false = 跳过计数（如材料商编辑自己的草稿） */
  enabled?: boolean;
}): { viewCount: number; isIncrementing: boolean } {
  const { materialId, initialCount = 0, enabled = true } = options;
  const [viewCount, setViewCount] = useState(initialCount);
  const [isIncrementing, setIsIncrementing] = useState(false);
  const ranForId = useRef<string | null>(null);

  useEffect(() => {
    setViewCount(initialCount);
  }, [materialId, initialCount]);

  useEffect(() => {
    if (!enabled || !materialId) return;
    if (ranForId.current === materialId) return;
    ranForId.current = materialId;

    if (hasViewedInSession(materialId)) return;

    let cancelled = false;
    setIsIncrementing(true);

    void (async () => {
      const next = await incrementMaterialViewCount(materialId);
      if (cancelled) return;
      markViewedInSession(materialId);
      if (typeof next === 'number' && next >= 0) {
        setViewCount(next);
      } else {
        setViewCount((c) => c + 1);
      }
      setIsIncrementing(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, materialId]);

  return { viewCount, isIncrementing };
}

export default useMaterialViewCount;

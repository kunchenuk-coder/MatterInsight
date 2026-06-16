import { useCallback, useState } from 'react';
import type { UserAsset } from '../types';
import { fetchPendingReviewAssets } from '../services/userAssetService';

/**
 * AI 审核队列 Hook（占位）。
 *
 * TODO: 接入 Gemini / Qwen 视觉 API，对 user_assets 中 review_status=pending_review
 * 的图片自动打分并更新为 approved | rejected。
 * 当前阶段仅拉取待审核列表，不调用任何 AI 密钥。
 */
export function useAiReviewQueue(userId: string | undefined) {
  const [pendingAssets, setPendingAssets] = useState<UserAsset[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) {
      setPendingAssets([]);
      return;
    }
    setLoading(true);
    try {
      const list = await fetchPendingReviewAssets(userId);
      setPendingAssets(list);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  /**
   * TODO: runAiReview(assetId) → 调用 vision API → update review_status
   */
  const runAiReview = useCallback(async (_assetId: string) => {
    console.info('[useAiReviewQueue] AI review not implemented yet');
    return { ok: false as const, reason: 'not_implemented' };
  }, []);

  return { pendingAssets, loading, refresh, runAiReview };
}

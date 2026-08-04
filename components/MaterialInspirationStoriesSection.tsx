import React, { useEffect, useRef, useState } from 'react';
import type { User, Material } from '../types';
import type { InspirationStory } from '../types/materialDetail';
import {
  getStoryAuthorLabel,
  persistInspirationStories,
  submitInspirationStory,
} from '../services/inspirationStoryService';
import useMarkNotificationsRead from '../hooks/useMarkNotificationsRead';
import { isSupabaseConfigured } from '../services/supabaseClient';

interface MaterialInspirationStoriesSectionProps {
  stories: InspirationStory[];
  onStoriesChange?: (stories: InspirationStory[]) => void;
  user: User | null;
  isPublicView?: boolean;
  materialId: string;
  canSubmitDesignerStory?: boolean;
  canSubmitBrandStory?: boolean;
  materialSupplierId?: string;
  material?: Material;
  /** Sync brand stories to published material row for designer explore feed. */
  persistBrandStories?: boolean;
  isLoading?: boolean;
}

/**
 * Visibility:
 * - published/approved → everyone
 * - pending_review/pending + rejected → author only
 */
function visibleStoriesForUser(
  stories: InspirationStory[],
  userId: string | undefined,
  isPublicView: boolean
): InspirationStory[] {
  return stories.filter((s) => {
    if (s.status === 'approved') return true;
    if (isPublicView || !userId) return false;
    if (s.author_id !== userId) return false;
    return s.status === 'pending' || s.status === 'rejected';
  });
}

export const MaterialInspirationStoriesSection: React.FC<
  MaterialInspirationStoriesSectionProps
> = ({
  stories,
  onStoriesChange,
  user,
  isPublicView = false,
  materialId,
  canSubmitDesignerStory = false,
  canSubmitBrandStory = false,
  materialSupplierId,
  material,
  persistBrandStories = false,
  isLoading = false,
}) => {
  const [localStories, setLocalStories] = useState(stories);
  const [showEditor, setShowEditor] = useState(false);
  const [draftText, setDraftText] = useState('');
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showAddHint, setShowAddHint] = useState(false);
  const [expandedStoryIds, setExpandedStoryIds] = useState<Record<string, boolean>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDesigner = !!user && user.role === 'DESIGNER' && !isPublicView && canSubmitDesignerStory;
  const isBrandEditor = !!user && canSubmitBrandStory;
  const canWriteStory = isDesigner || isBrandEditor;
  const storyMode: 'designer' | 'brand' = isBrandEditor && !isDesigner ? 'brand' : 'designer';

  /** 设计师进入灵感故事区 → story_featured 未读清零 */
  useMarkNotificationsRead({
    enabled:
      Boolean(user) &&
      user?.role === 'DESIGNER' &&
      !isPublicView &&
      isSupabaseConfigured(),
    types: ['story_featured'],
    portal: 'designer',
  });

  useEffect(() => {
    setLocalStories(stories);
    setExpandedStoryIds({});
  }, [stories, materialId]);

  useEffect(() => {
    if (showEditor) textareaRef.current?.focus();
  }, [showEditor]);

  const visibleStories = visibleStoriesForUser(localStories, user?.id, isPublicView);

  const commitStories = (next: InspirationStory[]) => {
    setLocalStories(next);
    onStoriesChange?.(next);
  };

  const handleSubmit = async () => {
    if (!user || !canWriteStory) return;
    const trimmed = draftText.trim();
    if (!trimmed) {
      setSubmitError('请写下你的设计叙事或材料感悟');
      return;
    }
    if (trimmed.length < 50) {
      setSubmitError('故事至少需要 50 个字（后台审核要求）');
      return;
    }
    if (trimmed.length > 800) {
      setSubmitError('故事最多 800 字');
      return;
    }

    setSubmitError(null);
    setIsSubmitting(true);
    try {
      console.info('[MaterialInspirationStories] submit click', {
        userId: user.id,
        role: user.role,
        dbRole: user.dbRole,
        storyMode,
        is_brand_story: storyMode === 'brand',
        materialId,
        textLen: trimmed.length,
      });
      const created = await submitInspirationStory({
        material_id: materialId,
        story_text: trimmed,
        status: 'pending',
        author_id: user.id,
        is_brand_story: storyMode === 'brand',
        auth_portal: storyMode === 'brand' ? 'supplier' : 'designer',
      });
      const next = [created, ...localStories.filter((s) => s.id !== created.id)];
      commitStories(next);

      if (storyMode === 'brand' && persistBrandStories && material && materialSupplierId) {
        const ok = await persistInspirationStories({
          material,
          supplierId: materialSupplierId,
          stories: next.filter((s) => s.status === 'approved'),
        });
        if (!ok) {
          setSubmitError('故事已保存，但同步到探索页失败，请尝试「再次发布」');
        }
      }
      setDraftText('');
      setShowEditor(false);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[MaterialInspirationStories] submit failed', msg);
      if (/at least 50/i.test(msg)) {
        setSubmitError('故事至少需要 50 个字');
      } else if (/only suppliers/i.test(msg) || /only designers/i.test(msg) || /not authenticated/i.test(msg)) {
        setSubmitError(`提交失败，权限错误：${msg}`);
      } else {
        setSubmitError(`提交失败：${msg}`);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className="mt-8 lg:mt-12 pt-8 lg:pt-12 border-t border-gray-100">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-6">
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-1">
            Human DNA
          </p>
          <h2 className="text-lg sm:text-xl font-bold">灵感故事 Inspiration</h2>
        </div>

        {canWriteStory && !showEditor && (
          <div
            className="relative self-start"
            onMouseEnter={() => setShowAddHint(true)}
            onMouseLeave={() => setShowAddHint(false)}
          >
            <button
              type="button"
              onClick={() => {
                setShowEditor(true);
                setSubmitError(null);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-full border-2 border-dashed border-gray-300 text-sm font-bold text-gray-600 hover:border-black hover:text-black hover:bg-white transition-all cursor-pointer"
              aria-label={storyMode === 'brand' ? '撰写品牌故事' : '撰写灵感故事'}
            >
              <span className="w-6 h-6 rounded-full bg-black text-white inline-flex items-center justify-center text-base leading-none">
                +
              </span>
              {storyMode === 'brand' ? '品牌故事' : '撰写故事'}
            </button>
            {showAddHint && (
              <span className="hidden sm:block absolute left-0 top-full mt-2 whitespace-nowrap px-3 py-1.5 rounded-lg bg-black text-white text-[10px] font-bold shadow-lg z-10">
                {storyMode === 'brand' ? '提交官方品牌叙事' : '分享你对这件材料的设计叙事'}
              </span>
            )}
          </div>
        )}
      </div>

      {showEditor && canWriteStory && (
        <div className="mb-8 rounded-2xl border border-gray-200 bg-gradient-to-br from-gray-50 to-white p-4 sm:p-6 shadow-sm">
          <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
            {storyMode === 'brand' ? '官方品牌故事' : '你的灵感故事'}
          </label>
          <textarea
            ref={textareaRef}
            value={draftText}
            onChange={(e) => {
              setDraftText(e.target.value);
              setSubmitError(null);
            }}
            rows={5}
            maxLength={800}
            placeholder={
              storyMode === 'brand'
                ? '介绍品牌理念、工艺标准或官方推荐的应用场景…'
                : '描述你在项目中如何使用这件材料、它带来的空间气质，或你的设计概念…'
            }
            className="w-full px-4 py-3 text-sm leading-relaxed rounded-xl border border-gray-200 bg-white outline-none focus:border-black transition-colors resize-y min-h-[120px]"
          />
          <p className="mt-3 text-xs text-gray-500 leading-relaxed bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
            精选叙事会公开展示；你自己的未精选故事仅自己可见。
          </p>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mt-3">
            <span className="text-[10px] text-gray-400 font-medium tabular-nums">
              {draftText.length}/800 · 至少 50 字 · 提交后进入审核
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowEditor(false);
                  setDraftText('');
                  setSubmitError(null);
                }}
                className="flex-1 sm:flex-none px-4 py-2.5 rounded-xl text-sm font-bold text-gray-500 hover:text-black transition-colors"
              >
                取消
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none px-6 py-2.5 rounded-xl bg-black text-white text-sm font-bold hover:bg-gray-800 disabled:opacity-50 transition-colors shadow-lg shadow-black/10"
              >
                {isSubmitting ? '提交中…' : '提交'}
              </button>
            </div>
          </div>
          {submitError && (
            <p className="mt-2 text-[11px] text-red-500 font-medium">{submitError}</p>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-gray-400">正在加载灵感故事…</p>
        </div>
      ) : visibleStories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-200 bg-gray-50/60 px-6 py-10 text-center">
          <p className="text-sm font-semibold text-gray-500">暂无精选灵感故事</p>
          <p className="text-xs text-gray-400 mt-2">
            {canWriteStory
              ? storyMode === 'brand'
                ? '点击「品牌故事」提交官方叙事，通过审核后将公开展示。'
                : '点击「撰写故事」分享你的设计叙事，通过审核后将公开展示。'
              : '设计师与材料商提交并精选后的故事将出现在这里。'}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
          {visibleStories.map((story) => {
            const isUnselected = story.status === 'pending' || story.status === 'rejected';
            const isApproved = story.status === 'approved';
            const expanded = !!expandedStoryIds[story.id];

            return (
              <li
                key={story.id}
                className={`relative min-w-0 overflow-hidden rounded-2xl border p-5 sm:p-6 transition-shadow hover:shadow-md ${
                  isUnselected
                    ? 'bg-gray-50 border-gray-200/80'
                    : 'bg-white border-gray-100'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 mb-3">
                  <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">
                    {getStoryAuthorLabel(story.author_id, user?.id, materialSupplierId)}
                  </span>
                  {isUnselected && (
                    <span className="px-2.5 py-0.5 rounded-full bg-gray-200/70 text-gray-500 text-[10px] font-bold tracking-wide">
                      未精选
                    </span>
                  )}
                  {isApproved && (
                    <span className="px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 text-[10px] font-bold border border-emerald-100">
                      已精选
                    </span>
                  )}
                </div>
                {story.title && (
                  <p
                    className={`text-sm font-bold mb-2 break-all ${
                      isUnselected ? 'text-gray-500' : 'text-gray-800'
                    }`}
                  >
                    {story.title}
                  </p>
                )}
                <p
                  role="button"
                  tabIndex={0}
                  onClick={() => {
                    setExpandedStoryIds((prev) => ({ ...prev, [story.id]: !prev[story.id] }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setExpandedStoryIds((prev) => ({ ...prev, [story.id]: !prev[story.id] }));
                    }
                  }}
                  title={expanded ? '点击收起' : '点击展开全文'}
                  className={`text-sm sm:text-[15px] leading-relaxed cursor-pointer select-text max-w-full ${
                    isUnselected ? 'text-gray-500' : 'text-gray-700'
                  }`}
                  style={
                    expanded
                      ? {
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'break-word',
                        }
                      : {
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'break-word',
                          display: '-webkit-box',
                          WebkitLineClamp: 3,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }
                  }
                >
                  {story.text}
                </p>
                {isUnselected && story.status === 'rejected' && (
                  <p className="mt-3 text-[10px] text-gray-400 leading-relaxed break-all">
                    {story.review_notes?.trim()
                      ? `未通过说明：${story.review_notes.trim()}`
                      : '未通过审核（未填写具体说明）'}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
};

export default MaterialInspirationStoriesSection;

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { User } from '../types';
import type { MaterialMoodTag } from '../types/materialDetail';
import {
  applyReliabilityPenalty,
  containsMaliciousMoodWord,
  MAX_DESIGNER_CUSTOM_MOOD_TAGS,
  MAX_SUPPLIER_BRAND_MOOD_TAGS,
  MOOD_TAG_RELIABILITY_PENALTY,
} from '../utils/moodTagModeration';
import { persistMaterialMoodTag, voteMaterialMoodTag } from '../services/moodTagService';
import { pickLocale, tagIdentity } from '../utils/localizedText';
import type { LocalizedText } from '../utils/localizedText';

interface BubbleBurst {
  id: string;
  tag: string;
  x: number;
  y: number;
}

interface MaterialMoodTagsSectionProps {
  moodTags: MaterialMoodTag[];
  onMoodTagsChange?: (tags: MaterialMoodTag[]) => void;
  user: User | null;
  isPublicView?: boolean;
  materialId: string;
  interactive?: boolean;
  canAddCustomMoodTags?: boolean;
  canAddBrandMoodTags?: boolean;
  compact?: boolean;
  /** Fired when a designer clicks a mood tag (+1 interaction). */
  onMoodTagInteract?: (tagName: string, tag: MaterialMoodTag) => void;
}

export const MaterialMoodTagsSection: React.FC<MaterialMoodTagsSectionProps> = ({
  moodTags,
  onMoodTagsChange,
  user,
  isPublicView = false,
  materialId,
  interactive = false,
  canAddCustomMoodTags = false,
  canAddBrandMoodTags = false,
  compact = false,
  onMoodTagInteract,
}) => {
  const { t } = useTranslation();
  const [tags, setTags] = useState(materialMoodTagsSorted(moodTags));
  const [bubbles, setBubbles] = useState<BubbleBurst[]>([]);
  const [showAddInput, setShowAddInput] = useState(false);
  const [newTagText, setNewTagText] = useState('');
  const [addError, setAddError] = useState<string | null>(null);
  const [designerReliability, setDesignerReliability] = useState(100);
  const [reliabilityNotice, setReliabilityNotice] = useState<string | null>(null);
  const [showAddHint, setShowAddHint] = useState(false);
  const [persistBusy, setPersistBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bubbleIdRef = useRef(0);

  const isDesignerInteractive =
    !!user && user.role === 'DESIGNER' && !isPublicView && interactive;
  const isAdmin = !!user && user.role === 'ADMIN';
  const addMode: 'brand' | 'custom' | null = canAddBrandMoodTags
    ? 'brand'
    : canAddCustomMoodTags
      ? 'custom'
      : null;

  const brandTagCount = tags.filter((t) => t.is_brand_official).length;
  const designerCustomCount = user
    ? tags.filter((t) => t.is_custom && t.author_id === user.id).length
    : 0;
  const brandLimitReached = brandTagCount >= MAX_SUPPLIER_BRAND_MOOD_TAGS;
  const customLimitReached = designerCustomCount >= MAX_DESIGNER_CUSTOM_MOOD_TAGS;
  const addLimitReached = addMode === 'brand' ? brandLimitReached : customLimitReached;
  const addLimitMax =
    addMode === 'brand' ? MAX_SUPPLIER_BRAND_MOOD_TAGS : MAX_DESIGNER_CUSTOM_MOOD_TAGS;

  useEffect(() => {
    setTags(materialMoodTagsSorted(moodTags));
  }, [moodTags, materialId]);

  useEffect(() => {
    if (showAddInput) inputRef.current?.focus();
  }, [showAddInput]);

  const commitTags = useCallback(
    (next: MaterialMoodTag[]) => {
      const sorted = materialMoodTagsSorted(next);
      setTags(sorted);
      onMoodTagsChange?.(sorted);
    },
    [onMoodTagsChange]
  );

  const spawnBubble = (tag: string, event: React.MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    const id = `bubble-${bubbleIdRef.current++}`;
    setBubbles((prev) => [...prev, { id, tag, x: event.clientX - rect.left, y: event.clientY - rect.top }]);
    window.setTimeout(() => {
      setBubbles((prev) => prev.filter((b) => b.id !== id));
    }, 720);
  };

  const handleTagClick = async (
    tagValue: LocalizedText,
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    if (!isDesignerInteractive || persistBusy) return;
    const tagName = tagIdentity(tagValue);
    spawnBubble(tagName, event);
    const target = tags.find((t) => tagIdentity(t.tag) === tagName);
    const optimistic = tags.map((t) =>
      tagIdentity(t.tag) === tagName ? { ...t, count: t.count + 1 } : t
    );
    commitTags(optimistic);
    if (target) onMoodTagInteract?.(tagName, target);

    setPersistBusy(true);
    const result = await voteMaterialMoodTag({ materialId, tagWord: tagName, portal: 'designer' });
    setPersistBusy(false);
    if (!result.ok) {
      console.warn('[MaterialMoodTags] vote persist failed, keeping optimistic UI:', result.error);
      setAddError(result.error);
      return;
    }
    commitTags(result.mood_tags);
  };

  const handleAddTag = async () => {
    if (!user || !addMode || persistBusy) return;
    setAddError(null);
    const trimmed = newTagText.trim();
    if (!trimmed) {
      setAddError('请输入情绪描述');
      return;
    }
    if (trimmed.length > 12) {
      setAddError('标签最多 12 个字');
      return;
    }
    if (tags.some((t) => tagIdentity(t.tag).toLowerCase() === trimmed.toLowerCase())) {
      setAddError('该标签已存在');
      return;
    }
    if (containsMaliciousMoodWord(trimmed)) {
      if (addMode === 'custom') {
        const nextScore = applyReliabilityPenalty(designerReliability);
        setDesignerReliability(nextScore);
        setReliabilityNotice(
          `检测到不当内容，背景可靠度 −${MOOD_TAG_RELIABILITY_PENALTY}（当前 ${nextScore}）`
        );
        window.setTimeout(() => setReliabilityNotice(null), 4000);
      }
      setAddError('内容未通过审核，请使用专业描述');
      return;
    }
    if (addLimitReached) {
      setAddError(`已达上限 ${addLimitMax} 个`);
      return;
    }

    const newTag: MaterialMoodTag =
      addMode === 'brand'
        ? { tag: trimmed, count: 0, is_brand_official: true }
        : {
            tag: trimmed,
            count: 1,
            is_custom: true,
            author_id: user.id,
          };

    console.info('[MaterialMoodTags] ADD_TAG local payload (before API)', {
      materialId,
      addMode,
      userId: user.id,
      role: user.role,
      dbRole: user.dbRole,
      newTag,
      existingTags: tags,
    });

    // Optimistic UI
    commitTags([...tags, newTag]);
    setNewTagText('');
    setShowAddInput(false);

    setPersistBusy(true);
    const result = await persistMaterialMoodTag({
      materialId,
      tagWord: trimmed,
      mode: addMode,
      portal: addMode === 'brand' ? 'supplier' : 'designer',
    });
    setPersistBusy(false);

    if (!result.ok) {
      console.error('[MaterialMoodTags] ADD_TAG cloud persist failed:', result.error);
      setAddError(`保存失败：${result.error}`);
      // rollback optimistic tag
      commitTags(tags);
      return;
    }
    commitTags(result.mood_tags);
  };

  const handleDeleteTag = (tagValue: LocalizedText, isBrand: boolean) => {
    if (isAdmin || (canAddBrandMoodTags && isBrand)) {
      const id = tagIdentity(tagValue);
      commitTags(tags.filter((t) => tagIdentity(t.tag) !== id));
    }
  };

  const tagButtonClass = (item: MaterialMoodTag) => {
    if (item.is_brand_official) {
      return 'bg-amber-50 border-amber-200 text-amber-900 hover:bg-amber-100 hover:border-amber-300';
    }
    if (item.is_custom) {
      return 'bg-violet-50 border-violet-200 text-violet-800 hover:bg-violet-100 hover:border-violet-300';
    }
    return 'bg-white border-gray-200 text-gray-800 hover:bg-black hover:text-white hover:border-black';
  };

  return (
    <section
      className={`bg-gray-50 rounded-2xl border border-gray-100 ${
        compact ? 'p-3 sm:p-4' : 'p-4 sm:p-6'
      }`}
    >
      <style>{`
        @keyframes mood-tag-bubble-rise {
          0% { opacity: 0.88; transform: translate(-50%, 4px) scale(0.55); }
          35% { opacity: 0.72; transform: translate(-50%, -14px) scale(1); }
          100% { opacity: 0; transform: translate(-50%, -52px) scale(1.08); }
        }
        .mood-tag-bubble {
          animation: mood-tag-bubble-rise 700ms cubic-bezier(0.22, 1, 0.36, 1) forwards;
          pointer-events: none;
        }
      `}</style>

      <div className="flex flex-wrap items-start justify-between gap-2 mb-3 sm:mb-4">
        <div>
          <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] mb-0.5">
            Human DNA
          </p>
          <h2 className={`font-bold ${compact ? 'text-base' : 'text-lg'}`}>{t('mood.title')}</h2>
          <p className="text-[11px] sm:text-xs text-gray-500 mt-0.5">
            {canAddBrandMoodTags
              ? t('mood.hintBrand')
              : isDesignerInteractive
                ? t('mood.hintDesigner')
                : t('mood.hintView')}
          </p>
        </div>
        {addMode === 'brand' && (
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              brandLimitReached
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {t('mood.officialCount', {
              current: brandTagCount,
              max: MAX_SUPPLIER_BRAND_MOOD_TAGS,
            })}
          </span>
        )}
        {addMode === 'custom' && isDesignerInteractive && (
          <span
            className={`text-[10px] font-bold px-2.5 py-1 rounded-full border ${
              customLimitReached
                ? 'bg-amber-50 text-amber-700 border-amber-200'
                : 'bg-white text-gray-500 border-gray-200'
            }`}
          >
            {t('mood.customCount', {
              current: designerCustomCount,
              max: MAX_DESIGNER_CUSTOM_MOOD_TAGS,
            })}
          </span>
        )}
      </div>

      {reliabilityNotice && (
        <div className="mb-3 px-3 py-2 rounded-xl bg-red-50 border border-red-100 text-xs text-red-700 font-medium">
          {reliabilityNotice}
        </div>
      )}

      <div className="flex flex-wrap gap-2 items-center">
        {tags.map((item) => {
          const idKey = tagIdentity(item.tag);
          const label = pickLocale(item.tag);
          return (
          <div key={idKey} className="relative group/tag">
            <button
              type="button"
              onClick={(e) => handleTagClick(item.tag, e)}
              disabled={!isDesignerInteractive}
              className={`relative overflow-visible inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs sm:text-sm font-semibold transition-all duration-200 ${
                isDesignerInteractive
                  ? 'cursor-pointer hover:scale-[1.04] active:scale-[0.98]'
                  : 'cursor-default'
              } ${tagButtonClass(item)}`}
            >
              {item.is_brand_official && (
                <span className="text-[9px] font-black uppercase text-amber-600/80">
                  {t('mood.official')}
                </span>
              )}
              <span>{label}</span>
              <span className="text-[10px] font-black opacity-50 tabular-nums">{item.count}</span>
            </button>

            <span className="pointer-events-none absolute inset-0 overflow-visible">
              {bubbles
                .filter((b) => b.tag === idKey)
                .map((bubble) => (
                  <span
                    key={bubble.id}
                    className="mood-tag-bubble absolute z-20 inline-flex items-center justify-center min-w-[2rem] h-7 px-2 rounded-full bg-black/35 text-white text-xs font-black backdrop-blur-sm border border-white/25 shadow-lg"
                    style={{ left: bubble.x, top: bubble.y }}
                  >
                    +1
                  </span>
                ))}
            </span>

            {(isAdmin && item.is_custom) || (canAddBrandMoodTags && item.is_brand_official) ? (
              <button
                type="button"
                onClick={() => handleDeleteTag(item.tag, !!item.is_brand_official)}
                className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black opacity-0 group-hover/tag:opacity-100 transition-opacity shadow-md hover:bg-red-600"
                aria-label={t('mood.deleteTag', { tag: label })}
              >
                ×
              </button>
            ) : null}
          </div>
          );
        })}

        {addMode && (
          <div className="relative">
            {!showAddInput ? (
              <div
                className="relative"
                onMouseEnter={() => setShowAddHint(true)}
                onMouseLeave={() => setShowAddHint(false)}
              >
                <button
                  type="button"
                  onClick={() => {
                    if (addLimitReached) return;
                    setShowAddInput(true);
                    setAddError(null);
                  }}
                  disabled={addLimitReached}
                  className={`inline-flex items-center justify-center w-9 h-9 rounded-full border-2 border-dashed transition-all duration-200 ${
                    addLimitReached
                      ? 'border-gray-200 text-gray-300 cursor-not-allowed'
                      : 'border-gray-300 text-gray-500 hover:border-black hover:text-black hover:bg-white cursor-pointer'
                  }`}
                  aria-label={addMode === 'brand' ? t('mood.addOfficial') : t('mood.addCustom')}
                >
                  +
                </button>
                {showAddHint && !addLimitReached && (
                  <span className="absolute left-1/2 -translate-x-1/2 top-full mt-1.5 whitespace-nowrap px-2.5 py-1 rounded-lg bg-black text-white text-[10px] font-bold shadow-lg z-10">
                    {addMode === 'brand' ? t('mood.addOfficial') : t('mood.addCustom')}
                  </span>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-1 min-w-[180px]">
                <div className="flex items-center gap-1.5">
                  <input
                    ref={inputRef}
                    type="text"
                    value={newTagText}
                    onChange={(e) => {
                      setNewTagText(e.target.value);
                      setAddError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddTag();
                      }
                      if (e.key === 'Escape') {
                        setShowAddInput(false);
                        setNewTagText('');
                        setAddError(null);
                      }
                    }}
                    placeholder={t('mood.placeholder')}
                    maxLength={12}
                    className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-gray-200 bg-white outline-none focus:border-black"
                  />
                  <button
                    type="button"
                    onClick={handleAddTag}
                    className="px-2.5 py-1.5 rounded-lg bg-black text-white text-xs font-bold"
                  >
                    {t('mood.confirmAdd')}
                  </button>
                </div>
                {addError && <p className="text-[10px] text-red-500 font-medium">{addError}</p>}
              </div>
            )}
          </div>
        )}
      </div>

      {tags.length === 0 && (
        <p className="mt-3 text-xs text-gray-400">
          {addMode === 'brand' ? t('mood.emptyBrand') : t('mood.empty')}
        </p>
      )}
    </section>
  );
};

function materialMoodTagsSorted(tags: MaterialMoodTag[]): MaterialMoodTag[] {
  return [...tags].sort((a, b) => b.count - a.count);
}

export default MaterialMoodTagsSection;

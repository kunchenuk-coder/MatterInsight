import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { MaterialApplicationCase } from '../types/materialDetail';
import { uploadImage } from '../services/uploadService';

const MAX_APPLICATION_CASES = 10;

const AI_TOOLTIP_TEXT =
  '该材料已接收AI训练，可以用于效果图的题图。试试将材料拖入你的情绪板效果图中。';

interface MaterialDetailTopSectionProps {
  mainImageUrl: string;
  mainImageAlt: string;
  colorAccent?: string;
  aiTrainedStatus: boolean;
  applicationCases: MaterialApplicationCase[];
  isSupplierEditMode?: boolean;
  onApplicationCasesChange?: (cases: MaterialApplicationCase[]) => void;
  canUploadApplicationCases?: boolean;
  variantPicker?: React.ReactNode;
}

export const MaterialDetailTopSection: React.FC<MaterialDetailTopSectionProps> = ({
  mainImageUrl,
  mainImageAlt,
  colorAccent,
  aiTrainedStatus,
  applicationCases,
  isSupplierEditMode = false,
  onApplicationCasesChange,
  canUploadApplicationCases = false,
  variantPicker,
}) => {
  const [caseModalIndex, setCaseModalIndex] = useState<number | null>(null);
  const [aiTooltipVisible, setAiTooltipVisible] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sliderRef = useRef<HTMLDivElement>(null);
  const dragState = useRef({ active: false, startX: 0, scrollLeft: 0, moved: false });
  const modalTouchStartX = useRef<number | null>(null);

  const openCaseModal = (index: number) => setCaseModalIndex(index);
  const closeCaseModal = () => setCaseModalIndex(null);

  const goToPrevCase = useCallback(() => {
    setCaseModalIndex((idx) => {
      if (idx === null || applicationCases.length === 0) return idx;
      return (idx - 1 + applicationCases.length) % applicationCases.length;
    });
  }, [applicationCases.length]);

  const goToNextCase = useCallback(() => {
    setCaseModalIndex((idx) => {
      if (idx === null || applicationCases.length === 0) return idx;
      return (idx + 1) % applicationCases.length;
    });
  }, [applicationCases.length]);

  useEffect(() => {
    if (caseModalIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') goToPrevCase();
      if (e.key === 'ArrowRight') goToNextCase();
      if (e.key === 'Escape') closeCaseModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [caseModalIndex, goToNextCase, goToPrevCase]);

  const handleSliderMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = sliderRef.current;
    if (!el) return;
    dragState.current = {
      active: true,
      startX: e.pageX - el.offsetLeft,
      scrollLeft: el.scrollLeft,
      moved: false,
    };
    el.style.cursor = 'grabbing';
    el.style.scrollSnapType = 'none';
  };

  const handleSliderMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const el = sliderRef.current;
    if (!el || !dragState.current.active) return;
    e.preventDefault();
    const x = e.pageX - el.offsetLeft;
    const walk = x - dragState.current.startX;
    if (Math.abs(walk) > 4) dragState.current.moved = true;
    el.scrollLeft = dragState.current.scrollLeft - walk;
  };

  const endSliderDrag = () => {
    const el = sliderRef.current;
    if (!el) return;
    dragState.current.active = false;
    el.style.cursor = 'grab';
    el.style.scrollSnapType = 'x mandatory';
  };

  const handleCaseClick = (index: number) => {
    if (dragState.current.moved) {
      dragState.current.moved = false;
      return;
    }
    openCaseModal(index);
  };

  const toggleTraining = (caseId: string, checked: boolean) => {
    if (!onApplicationCasesChange) return;
    onApplicationCasesChange(
      applicationCases.map((c) =>
        c.id === caseId ? { ...c, is_for_training: checked } : c
      )
    );
  };

  const handleUploadCases = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files?.length || !onApplicationCasesChange) return;
    const remaining = MAX_APPLICATION_CASES - applicationCases.length;
    if (remaining <= 0) {
      alert(`最多上传 ${MAX_APPLICATION_CASES} 张应用案例图`);
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    try {
      const toUpload = Array.from(files).slice(0, remaining);
      const uploaded: MaterialApplicationCase[] = [];
      for (const file of toUpload) {
        const result = await uploadImage(file, 'project-photos');
        uploaded.push({
          id: `case_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          url: result.url,
          is_for_training: false,
        });
      }
      onApplicationCasesChange([...applicationCases, ...uploaded]);
    } catch {
      alert('上传失败，请重试');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  const handleModalTouchStart = (e: React.TouchEvent) => {
    modalTouchStartX.current = e.touches[0]?.clientX ?? null;
  };

  const handleModalTouchEnd = (e: React.TouchEvent) => {
    const startX = modalTouchStartX.current;
    const endX = e.changedTouches[0]?.clientX;
    modalTouchStartX.current = null;
    if (startX == null || endX == null) return;
    const delta = endX - startX;
    if (Math.abs(delta) < 48) return;
    if (delta > 0) goToPrevCase();
    else goToNextCase();
  };

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 sm:gap-8 lg:gap-10 mb-6 sm:mb-8">
        {/* Left: main image */}
        <div className="lg:col-span-5">
          <div
            className="relative group rounded-2xl"
            onMouseEnter={() => aiTrainedStatus && setAiTooltipVisible(true)}
            onMouseLeave={() => setAiTooltipVisible(false)}
            onFocus={() => aiTrainedStatus && setAiTooltipVisible(true)}
            onBlur={() => setAiTooltipVisible(false)}
          >
            <img
              src={mainImageUrl}
              alt={mainImageAlt}
              className="w-full aspect-[4/5] object-cover rounded-2xl shadow-lg border border-gray-200 transition-all duration-500"
              style={colorAccent ? { filter: `drop-shadow(0 0 10px ${colorAccent}44)` } : undefined}
            />

            {aiTrainedStatus && (
              <>
                <div className="absolute top-4 left-4 flex items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-gradient-to-r from-violet-600/90 to-indigo-500/90 text-white text-[10px] font-black uppercase tracking-wider shadow-lg shadow-violet-500/30 backdrop-blur-sm border border-white/20 transition-transform duration-300 group-hover:scale-105">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2zm0 10l2 6 6 2-6 2-2 6-2-6-6-2 6-2 2-6z" />
                    </svg>
                    AI Ready
                  </span>
                  <button
                    type="button"
                    className="lg:hidden w-7 h-7 rounded-full bg-black/40 text-white text-xs backdrop-blur-sm border border-white/20"
                    aria-label="AI 训练说明"
                    onClick={() => setAiTooltipVisible((v) => !v)}
                  >
                    i
                  </button>
                </div>

                <div
                  className={`absolute left-4 right-4 top-16 lg:top-14 z-10 pointer-events-none transition-all duration-300 ease-out ${
                    aiTooltipVisible
                      ? 'opacity-100 translate-y-0'
                      : 'opacity-0 -translate-y-1 lg:group-hover:opacity-100 lg:group-hover:translate-y-0'
                  }`}
                >
                  <div className="rounded-2xl bg-white/95 backdrop-blur-md border border-violet-100 shadow-xl shadow-violet-500/10 px-4 py-3 text-sm text-gray-700 leading-relaxed">
                    <p className="font-semibold text-violet-700 text-xs mb-1">AI 效果图题图</p>
                    {AI_TOOLTIP_TEXT}
                  </div>
                </div>
              </>
            )}

            {variantPicker}
          </div>
        </div>

        {/* Right: application cases */}
        <div className="lg:col-span-7 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-4 gap-3">
            <h2 className="text-xl font-bold">应用案例</h2>
            <div className="flex items-center gap-2">
              {canUploadApplicationCases && (
                <>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={handleUploadCases}
                  />
                  <button
                    type="button"
                    disabled={isUploading || applicationCases.length >= MAX_APPLICATION_CASES}
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black text-white text-[10px] font-black uppercase tracking-wide disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-800 transition-colors"
                  >
                    {isUploading ? '上传中…' : '+ 上传图片'}
                  </button>
                </>
              )}
              {(applicationCases.length > 0 || canUploadApplicationCases) && (
                <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                  {applicationCases.length} / {MAX_APPLICATION_CASES}
                </span>
              )}
            </div>
          </div>

          {applicationCases.length === 0 ? (
            <div className="flex-1 min-h-[280px] lg:min-h-[420px] rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/80 flex flex-col items-center justify-center gap-3 px-6 text-center">
              <div className="w-14 h-14 rounded-2xl bg-white border border-gray-100 flex items-center justify-center text-2xl shadow-sm">
                🖼
              </div>
              <p className="text-sm font-bold text-gray-500">暂无应用案例</p>
              <p className="text-xs text-gray-400 max-w-xs">
                {canUploadApplicationCases
                  ? '上传项目实拍图，勾选「参加训练」即可用于 AI 模型训练。'
                  : '该材料尚未收录项目应用实拍图。'}
              </p>
              {canUploadApplicationCases && (
                <button
                  type="button"
                  disabled={isUploading}
                  onClick={() => fileInputRef.current?.click()}
                  className="mt-2 px-5 py-2.5 rounded-xl bg-black text-white text-xs font-bold hover:bg-gray-800 disabled:opacity-50 transition-colors"
                >
                  {isUploading ? '上传中…' : '上传第一张案例图'}
                </button>
              )}
            </div>
          ) : (
            <div
              ref={sliderRef}
              className="flex gap-4 overflow-x-auto pb-3 cursor-grab select-none snap-x snap-mandatory touch-pan-x [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              style={{ WebkitOverflowScrolling: 'touch' }}
              onMouseDown={handleSliderMouseDown}
              onMouseMove={handleSliderMouseMove}
              onMouseUp={endSliderDrag}
              onMouseLeave={endSliderDrag}
            >
              {applicationCases.map((item, index) => (
                <div
                  key={item.id}
                  className="flex-shrink-0 w-[72%] sm:w-[48%] lg:w-[42%] snap-start"
                >
                  <button
                    type="button"
                    onClick={() => handleCaseClick(index)}
                    className="relative w-full aspect-[4/3] rounded-2xl overflow-hidden group/card border border-gray-200 shadow-sm hover:shadow-md transition-shadow text-left"
                  >
                    <img
                      src={item.url}
                      alt={`应用案例 ${index + 1}`}
                      className="w-full h-full object-cover transition-transform duration-500 group-hover/card:scale-[1.03] pointer-events-none"
                      draggable={false}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity flex items-end p-4">
                      <span className="text-white text-xs font-bold">点击查看大图</span>
                    </div>
                    {item.is_for_training && (
                      <span className="absolute top-3 right-3 px-2 py-0.5 rounded-full bg-violet-600/90 text-white text-[9px] font-black uppercase tracking-wide">
                        训练
                      </span>
                    )}
                  </button>

                  {isSupplierEditMode && (
                    <label className="mt-2 flex items-center gap-2 cursor-pointer px-1">
                      <input
                        type="checkbox"
                        checked={item.is_for_training}
                        onChange={(e) => toggleTraining(item.id, e.target.checked)}
                        className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                      />
                      <span className="text-xs font-semibold text-gray-600">参加训练</span>
                    </label>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {caseModalIndex !== null && applicationCases[caseModalIndex] && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
          onClick={closeCaseModal}
        >
          <div className="absolute inset-0 bg-black/40 backdrop-blur-xl" aria-hidden />
          <div
            className="relative z-10 w-full max-w-5xl flex flex-col items-center"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleModalTouchStart}
            onTouchEnd={handleModalTouchEnd}
          >
            <button
              type="button"
              onClick={closeCaseModal}
              className="absolute -top-2 right-0 sm:-top-4 sm:right-0 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20 transition-colors"
              aria-label="关闭"
            >
              ✕
            </button>

            {applicationCases.length > 1 && (
              <>
                <button
                  type="button"
                  onClick={goToPrevCase}
                  className="absolute left-0 sm:-left-14 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-sm border border-white/20 transition-colors hidden sm:flex items-center justify-center"
                  aria-label="上一张"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={goToNextCase}
                  className="absolute right-0 sm:-right-14 top-1/2 -translate-y-1/2 z-20 w-11 h-11 rounded-full bg-white/10 hover:bg-white/25 text-white backdrop-blur-sm border border-white/20 transition-colors hidden sm:flex items-center justify-center"
                  aria-label="下一张"
                >
                  ›
                </button>
              </>
            )}

            <div className="rounded-2xl overflow-hidden shadow-2xl bg-black/20 border border-white/10 max-h-[80vh]">
              <img
                src={applicationCases[caseModalIndex].url}
                alt={`应用案例 ${caseModalIndex + 1}`}
                className="max-w-full max-h-[80vh] object-contain"
              />
            </div>

            {applicationCases.length > 1 && (
              <p className="mt-4 text-white/70 text-xs font-bold tracking-widest">
                {caseModalIndex + 1} / {applicationCases.length}
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
};

export default MaterialDetailTopSection;

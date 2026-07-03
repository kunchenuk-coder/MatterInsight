import React, { useEffect, useMemo, useState } from 'react';
import type { MaterialEvaluations } from '../types/materialDetail';

const EVALUATION_LABELS: Record<keyof MaterialEvaluations, string> = {
  aesthetics: '美观',
  durability: '耐用',
  service: '服务',
  cleanliness: '易洁',
  recommendation: '推荐',
};

interface MaterialEvaluationsSectionProps {
  evaluations: MaterialEvaluations;
  readOnly: boolean;
  showAggregateLabel?: boolean;
  /** Designer interactive mode (sliders + rating flow). */
  interactive?: boolean;
  hasSubmitted?: boolean;
  onSubmitRating?: (submission: MaterialEvaluations) => Promise<void>;
}

export const MaterialEvaluationsSection: React.FC<MaterialEvaluationsSectionProps> = ({
  evaluations,
  readOnly,
  showAggregateLabel = false,
  interactive = false,
  hasSubmitted = false,
  onSubmitRating,
}) => {
  const [draft, setDraft] = useState<MaterialEvaluations>(evaluations);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    setDraft(evaluations);
  }, [evaluations]);

  const aggregateScore = useMemo(() => {
    const values = Object.values(evaluations);
    if (values.length === 0) return 0;
    return values.reduce((sum, v) => sum + v, 0) / values.length;
  }, [evaluations]);

  const submitted = hasSubmitted;
  const canStartRating = interactive && !readOnly && !submitted && !isEditing;
  const canSubmit = interactive && !readOnly && !submitted && isEditing;
  const sliderDisabled = readOnly || !interactive || submitted || !isEditing;

  const handlePrimaryAction = async () => {
    if (canStartRating) {
      setDraft(evaluations);
      setIsEditing(true);
      return;
    }

    if (!canSubmit || !onSubmitRating) return;

    setIsSubmitting(true);
    try {
      await onSubmitRating(draft);
      setIsEditing(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50 p-4 sm:p-6 rounded-2xl border border-gray-100">
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h2 className="text-lg font-bold">材料综合评估</h2>
        {showAggregateLabel && (
          <span className="text-[10px] font-bold bg-white px-3 py-1 rounded-full border text-gray-600">
            已评/统计综合得分 · {aggregateScore.toFixed(1)}
          </span>
        )}
        {interactive && !readOnly && (
          <button
            type="button"
            onClick={handlePrimaryAction}
            disabled={submitted || isSubmitting || (!canStartRating && !canSubmit)}
            className={`text-xs font-bold px-4 py-1.5 rounded-full transition-transform ${
              submitted
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : canSubmit
                  ? 'bg-black text-white hover:scale-105'
                  : canStartRating
                    ? 'bg-white text-black border border-black hover:scale-105'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            {submitted
              ? '已提交评分'
              : isSubmitting
                ? '提交中…'
                : canSubmit
                  ? '提交评分'
                  : '我要评分'}
          </button>
        )}
      </div>

      <div className="space-y-4">
        {(Object.keys(EVALUATION_LABELS) as Array<keyof MaterialEvaluations>).map((key) => {
          const aggregateVal = evaluations[key];
          const displayVal = sliderDisabled ? aggregateVal : draft[key];

          return (
            <div key={key} className="flex items-center gap-3 sm:gap-4">
              <span className="w-16 sm:w-20 text-xs font-bold text-gray-500 shrink-0">
                {EVALUATION_LABELS[key]}
              </span>
              <div className="flex-1 relative h-2 bg-gray-200 rounded-full overflow-hidden">
                {interactive && !readOnly && (
                  <div
                    className="absolute inset-y-0 left-0 bg-gray-300/80 rounded-full transition-all duration-300"
                    style={{ width: `${(aggregateVal / 5) * 100}%` }}
                  />
                )}
                <div
                  className={`absolute inset-y-0 left-0 rounded-full transition-all duration-300 ${
                    readOnly ? 'bg-black/70' : 'bg-black'
                  }`}
                  style={{ width: `${(displayVal / 5) * 100}%` }}
                />
              </div>
              {readOnly ? (
                <span className="text-xs font-bold tabular-nums w-8 text-right">{aggregateVal}</span>
              ) : (
                <input
                  type="range"
                  min={1}
                  max={5}
                  step={0.1}
                  value={draft[key]}
                  disabled={sliderDisabled}
                  onChange={(e) =>
                    setDraft((prev) => ({ ...prev, [key]: Number(e.target.value) }))
                  }
                  className={`w-20 sm:w-24 shrink-0 accent-black ${
                    sliderDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                  }`}
                  aria-label={EVALUATION_LABELS[key]}
                />
              )}
            </div>
          );
        })}
      </div>

      {readOnly && (
        <p className="mt-4 text-[11px] text-gray-400">
          以上分数来自设计师社区反馈的综合统计，材料商不可修改。
        </p>
      )}
    </div>
  );
};

export default MaterialEvaluationsSection;

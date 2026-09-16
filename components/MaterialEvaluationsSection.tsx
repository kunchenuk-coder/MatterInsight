import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MaterialEvaluations } from '../types/materialDetail';
import type { MaterialEvaluationRow } from '../services/materialEvaluationService';
import { evaluationAverage } from '../services/materialEvaluationService';

const EVAL_KEYS: Array<keyof MaterialEvaluations> = [
  'aesthetics',
  'durability',
  'service',
  'cleanliness',
  'recommendation',
];

interface MaterialEvaluationsSectionProps {
  evaluations: MaterialEvaluations;
  readOnly: boolean;
  showAggregateLabel?: boolean;
  interactive?: boolean;
  hasSubmitted?: boolean;
  onSubmitRating?: (submission: MaterialEvaluations) => Promise<void>;
  projectName?: string;
  unreadCount?: number;
  myEvaluations?: MaterialEvaluations | null;
  latestEvaluation?: MaterialEvaluationRow | null;
  isSupplierView?: boolean;
  onDisputeLatest?: () => Promise<void>;
}

export const MaterialEvaluationsSection: React.FC<MaterialEvaluationsSectionProps> = ({
  evaluations,
  readOnly,
  showAggregateLabel = false,
  interactive = false,
  hasSubmitted = false,
  onSubmitRating,
  projectName = '',
  unreadCount = 0,
  myEvaluations = null,
  latestEvaluation = null,
  isSupplierView = false,
  onDisputeLatest,
}) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<MaterialEvaluations>(evaluations);
  const [isEditing, setIsEditing] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [commitment, setCommitment] = useState(false);
  const [showLatest, setShowLatest] = useState(false);
  const [disputing, setDisputing] = useState(false);

  useEffect(() => {
    setDraft(evaluations);
  }, [evaluations]);

  const aggregateScore = useMemo(() => evaluationAverage(evaluations), [evaluations]);
  const labelFor = (key: keyof MaterialEvaluations) => t(`eval.${key}`);
  const displayProject = projectName.trim() || latestEvaluation?.projectName || t('eval.defaultProject');

  const submitted = hasSubmitted;
  const canStartRating = interactive && !readOnly && !submitted && !isEditing;
  const canResubmit = interactive && !readOnly && submitted && !isEditing;
  const canSubmit = interactive && !readOnly && isEditing;
  const sliderDisabled = readOnly || !interactive || !isEditing;

  const handlePrimaryAction = () => {
    if (canStartRating || canResubmit) {
      setDraft(canResubmit ? (myEvaluations ?? latestEvaluation?.evaluations ?? evaluations) : evaluations);
      setIsEditing(true);
      return;
    }
    if (!canSubmit || !onSubmitRating) return;
    setCommitment(false);
    setShowConfirm(true);
  };

  const handleConfirmSubmit = async () => {
    if (!commitment || !onSubmitRating) return;
    setIsSubmitting(true);
    try {
      await onSubmitRating(draft);
      setIsEditing(false);
      setShowConfirm(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-gray-50 p-4 sm:p-6 rounded-2xl border border-gray-100 relative">
      {unreadCount > 0 && (
        <span className="absolute -top-2 -right-2 min-w-[20px] h-5 px-1.5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">
          {unreadCount}
        </span>
      )}
      <div className="flex flex-wrap justify-between items-center gap-2 mb-4">
        <h2 className="text-lg font-bold">{t('eval.title')}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {showAggregateLabel && (
            <span className="text-[10px] font-bold bg-white px-3 py-1 rounded-full border text-gray-600">
              {t('eval.aggregate', { score: aggregateScore.toFixed(1) })}
            </span>
          )}
          {isSupplierView && latestEvaluation && (
            <button
              type="button"
              onClick={() => setShowLatest(true)}
              className="text-[10px] font-bold bg-white px-3 py-1 rounded-full border border-black/20 hover:bg-black hover:text-white transition-colors"
            >
              {t('eval.latestRating')}
            </button>
          )}
          {interactive && !readOnly && (
            <button
              type="button"
              onClick={handlePrimaryAction}
              disabled={isSubmitting || (!canStartRating && !canSubmit && !canResubmit)}
              className={`text-xs font-bold px-4 py-1.5 rounded-full transition-transform ${
                canSubmit || canStartRating || canResubmit
                  ? canSubmit
                    ? 'bg-black text-white hover:scale-105'
                    : 'bg-white text-black border border-black hover:scale-105'
                  : 'bg-gray-200 text-gray-400 cursor-not-allowed'
              }`}
            >
              {isSubmitting
                ? t('eval.submitting')
                : canSubmit
                  ? t('eval.submit')
                  : canResubmit
                    ? t('eval.resubmit')
                    : canStartRating
                      ? t('eval.rate')
                      : t('eval.submitted')}
            </button>
          )}
          {interactive && !readOnly && submitted && (
            <span className="text-[10px] font-bold text-gray-400">{t('eval.submitted')}</span>
          )}
        </div>
      </div>

      <div className="space-y-4">
        {EVAL_KEYS.map((key) => {
          const aggregateVal = evaluations[key];
          const displayVal = sliderDisabled ? aggregateVal : draft[key];
          const label = labelFor(key);

          return (
            <div key={key} className="flex items-center gap-3 sm:gap-4">
              <span className="w-16 sm:w-20 text-xs font-bold text-gray-500 shrink-0">{label}</span>
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
                  aria-label={label}
                />
              )}
            </div>
          );
        })}
      </div>

      {readOnly && (
        <p className="mt-4 text-[11px] text-gray-400">{t('eval.readOnlyHint')}</p>
      )}

      {showConfirm && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-black mb-3">{t('eval.confirmTitle')}</h3>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              {t('eval.confirmBody', { project: displayProject })}
            </p>
            <label className="flex items-start gap-2 text-sm font-medium text-gray-800 mb-6">
              <input
                type="checkbox"
                checked={commitment}
                onChange={(e) => setCommitment(e.target.checked)}
                className="mt-0.5 accent-black"
              />
              <span>{t('eval.confirmCheck')}</span>
            </label>
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowConfirm(false)}
                className="px-4 py-2 rounded-full text-xs font-bold border"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!commitment || isSubmitting}
                onClick={() => void handleConfirmSubmit()}
                className={`px-4 py-2 rounded-full text-xs font-bold ${
                  commitment && !isSubmitting
                    ? 'bg-black text-white'
                    : 'bg-gray-200 text-gray-400 cursor-not-allowed'
                }`}
              >
                {t('eval.confirmSubmit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {showLatest && latestEvaluation && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl">
            <h3 className="text-lg font-black mb-3">{t('eval.latestTitle')}</h3>
            <p className="text-sm text-gray-700 leading-relaxed mb-4">
              {t('eval.latestBody', {
                designer: latestEvaluation.designerName,
                project: latestEvaluation.projectName || t('eval.defaultProject'),
              })}
            </p>
            <div className="space-y-2 mb-6">
              {EVAL_KEYS.map((key) => (
                <div key={key} className="flex justify-between text-xs font-bold">
                  <span className="text-gray-500">{labelFor(key)}</span>
                  <span>{latestEvaluation.evaluations[key]}</span>
                </div>
              ))}
            </div>
            {latestEvaluation.status === 'disputed' && (
              <p className="text-[11px] font-bold text-amber-600 mb-3">{t('eval.alreadyDisputed')}</p>
            )}
            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setShowLatest(false)}
                className="px-4 py-2 rounded-full text-xs font-bold border"
              >
                {t('common.close')}
              </button>
              {onDisputeLatest && latestEvaluation.status !== 'disputed' && latestEvaluation.status !== 'revoked' && (
                <button
                  type="button"
                  disabled={disputing}
                  onClick={async () => {
                    setDisputing(true);
                    try {
                      await onDisputeLatest();
                      setShowLatest(false);
                    } finally {
                      setDisputing(false);
                    }
                  }}
                  className="px-4 py-2 rounded-full text-xs font-bold bg-black text-white"
                >
                  {t('eval.dispute')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialEvaluationsSection;

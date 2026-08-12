import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AI_BILINGUAL_COST_POINTS,
  generateMaterialBilingualEn,
} from '../services/materialBilingualAi';
import { recordPointsConsume } from '../services/adminAnalyticsService';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { pickLocale } from '../utils/localizedText';
import type { MaterialVariant } from '../types';

export type PublishFormState = {
  name: string;
  nameEn: string;
  description: string;
  descriptionEn: string;
  category: import('../types').Category;
  brand: string;
  specifications: string;
  priceRange: string;
  stock: boolean;
  leadTime: string;
  fireRating: string;
  supplierNotes: string;
  supplierNotesEn: string;
  image: string;
  variants: Array<MaterialVariant & { nameEn?: string }>;
  projectPhotos: string[];
};

type Props = {
  formData: PublishFormState;
  setFormData: React.Dispatch<React.SetStateAction<PublishFormState>>;
  points: number;
  onPointsUpdated: (balanceAfter: number) => void;
  disabled?: boolean;
};

const AiBilingualFillButton: React.FC<Props> = ({
  formData,
  setFormData,
  points,
  onPointsUpdated,
  disabled,
}) => {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy || disabled) return;
    if (!formData.name.trim()) {
      alert(t('supplier.aiBilingualNeedName'));
      return;
    }
    if (points < AI_BILINGUAL_COST_POINTS) {
      alert(t('supplier.aiBilingualNeedPoints', { cost: AI_BILINGUAL_COST_POINTS, points }));
      return;
    }
    const ok = window.confirm(
      t('supplier.aiBilingualConfirm', { cost: AI_BILINGUAL_COST_POINTS })
    );
    if (!ok) return;

    setBusy(true);
    try {
      if (isSupabaseConfigured()) {
        const charged = await recordPointsConsume({
          amount: AI_BILINGUAL_COST_POINTS,
          description: 'AI 一键生成双语',
          portal: 'supplier',
        });
        if (!charged.ok) {
          alert(('error' in charged && charged.error) || t('supplier.aiBilingualChargeFail'));
          return;
        }
        onPointsUpdated(charged.balanceAfter);
      } else {
        onPointsUpdated(Math.max(0, points - AI_BILINGUAL_COST_POINTS));
      }

      const result = await generateMaterialBilingualEn({
        name: formData.name,
        description: formData.description,
        supplierNotes: formData.supplierNotes,
        variantNames: formData.variants.map((v) =>
          typeof v.name === 'string' ? v.name : pickLocale(v.name, 'zh')
        ),
      });

      setFormData((prev) => ({
        ...prev,
        nameEn: result.name,
        descriptionEn: result.description || prev.descriptionEn,
        supplierNotesEn: result.supplierNotes || prev.supplierNotesEn,
        variants: prev.variants.map((v, i) => ({
          ...v,
          nameEn: result.variantNames[i] || v.nameEn || '',
        })),
      }));
      alert(t('supplier.aiBilingualSuccess'));
    } catch (e) {
      alert(e instanceof Error ? e.message : t('supplier.aiBilingualFail'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={() => void handleClick()}
      disabled={busy || disabled}
      className="w-full flex flex-col items-center justify-center gap-1 px-4 py-3 rounded-2xl border-2 border-amber-400/80 bg-amber-50 text-amber-950 font-black hover:bg-amber-100 transition-colors disabled:opacity-50"
    >
      <span className="text-sm sm:text-base">
        {busy ? t('supplier.aiBilingualBusy') : t('supplier.aiBilingualButton')}
      </span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-amber-700/80">
        {t('supplier.aiBilingualCost', { cost: AI_BILINGUAL_COST_POINTS })}
      </span>
    </button>
  );
};

export default AiBilingualFillButton;

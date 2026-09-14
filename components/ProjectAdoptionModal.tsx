import React, { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadImage } from '../services/uploadService';
import { submitProjectAdoption, type ProjectAdoptionRow } from '../services/projectAdoptionService';

const MAX_IMAGES = 6;
const MAX_RAW_BYTES = 8 * 1024 * 1024;
const ACCEPT = 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp';

interface LocalPreview {
  previewUrl: string;
  objectKey: string;
}

interface ProjectAdoptionModalProps {
  open: boolean;
  materialId: string;
  designerId: string;
  onClose: () => void;
  onSubmitted: (row: ProjectAdoptionRow) => void;
}

const ProjectAdoptionModal: React.FC<ProjectAdoptionModalProps> = ({
  open,
  materialId,
  designerId,
  onClose,
  onSubmitted,
}) => {
  const { t } = useTranslation();
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<LocalPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    return () => {
      setItems((prev) => {
        prev.forEach((p) => {
          if (p.previewUrl.startsWith('blob:')) URL.revokeObjectURL(p.previewUrl);
        });
        return [];
      });
      setUploading(false);
      setSubmitting(false);
      setError(null);
    };
  }, [open]);

  if (!open) return null;

  const remaining = MAX_IMAGES - items.length;

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList?.length || uploading || submitting || remaining <= 0) return;
    setError(null);
    setUploading(true);
    try {
      const selected = Array.from(fileList).slice(0, remaining);
      const uploaded: LocalPreview[] = [];
      for (const file of selected) {
        if (!/^image\/(jpeg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name)) {
          setError(t('materialDetail.adoptionBadType'));
          continue;
        }
        if (file.size > MAX_RAW_BYTES) {
          setError(t('materialDetail.adoptionTooLarge'));
          continue;
        }
        const result = await uploadImage(file, 'project-photos');
        const objectKey = result.objectKey?.trim();
        if (!objectKey) {
          setError(t('materialDetail.adoptionUploadNeedKey'));
          continue;
        }
        const previewUrl = result.url || URL.createObjectURL(file);
        uploaded.push({ previewUrl, objectKey });
      }
      if (uploaded.length) {
        setItems((prev) => [...prev, ...uploaded]);
      }
    } catch (err) {
      console.error('[ProjectAdoptionModal] upload:', err);
      setError(t('materialDetail.adoptionUploadFailed'));
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const removeAt = (index: number) => {
    setItems((prev) => {
      const next = [...prev];
      const [removed] = next.splice(index, 1);
      if (removed?.previewUrl.startsWith('blob:')) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  };

  const handleSubmit = async () => {
    if (submitting || uploading) return;
    if (items.length < 1 || items.length > MAX_IMAGES) {
      setError(t('materialDetail.adoptionNeedImages'));
      return;
    }
    setSubmitting(true);
    setError(null);
    const result = await submitProjectAdoption(
      materialId,
      designerId,
      items.map((i) => i.objectKey)
    );
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    alert(t('materialDetail.adoptionSubmitted'));
    onSubmitted(result.row);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-lg p-6 sm:p-8 rounded-3xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <h2 className="text-xl sm:text-2xl font-bold mb-2">{t('materialDetail.adoptionTitle')}</h2>
        <p className="text-sm text-gray-500 mb-5">{t('materialDetail.adoptionHint')}</p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {items.map((item, index) => (
            <div key={`${item.objectKey}-${index}`} className="relative aspect-square rounded-xl overflow-hidden border border-gray-200 bg-gray-50">
              <img src={item.previewUrl} alt="" className="w-full h-full object-cover" />
              <button
                type="button"
                onClick={() => removeAt(index)}
                disabled={uploading || submitting}
                className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/70 text-white text-xs font-bold"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>
          ))}
          {remaining > 0 && (
            <label
              htmlFor={inputId}
              className={`aspect-square rounded-xl border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-gray-400 text-xs font-bold cursor-pointer hover:border-black hover:text-black transition-colors ${
                uploading || submitting ? 'opacity-50 pointer-events-none' : ''
              }`}
            >
              <span className="text-2xl leading-none mb-1">+</span>
              {uploading ? t('materialDetail.adoptionUploading') : t('materialDetail.adoptionAdd')}
            </label>
          )}
        </div>

        <input
          id={inputId}
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="hidden"
          disabled={uploading || submitting || remaining <= 0}
          onChange={(e) => void handleFiles(e.target.files)}
        />

        <p className="text-[11px] text-gray-400 mb-3">
          {t('materialDetail.adoptionCount', { count: items.length, max: MAX_IMAGES })}
        </p>

        {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

        <div className="pt-2 flex gap-4">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="flex-1 py-3 text-gray-500 font-bold"
          >
            {t('common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || uploading || items.length < 1}
            className="flex-1 py-3 bg-black text-white rounded-xl font-bold shadow-lg shadow-black/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? t('materialDetail.adoptionSubmitting') : t('materialDetail.adoptionSubmit')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectAdoptionModal;

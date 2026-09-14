import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchReadUrlsForObjectKeys, resolveUrlFromMap } from '../services/assetReadUrlService';
import { parseOssObjectKey } from '../utils/parseOssObjectKey';
import {
  approveProjectAdoption,
  fetchPendingProjectAdoptionsForAdmin,
  rejectProjectAdoption,
  type AdminProjectAdoptionRow,
} from '../services/projectAdoptionService';

interface AdminProjectAdoptionReviewPanelProps {
  onPendingCountChange?: (count: number) => void;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const Thumb: React.FC<{ objectKey: string }> = ({ objectKey }) => {
  const [src, setSrc] = useState('');

  useEffect(() => {
    let cancelled = false;
    const key = parseOssObjectKey(objectKey) ?? objectKey;
    void fetchReadUrlsForObjectKeys([key]).then((map) => {
      if (cancelled) return;
      setSrc(resolveUrlFromMap('', key, map));
    });
    return () => {
      cancelled = true;
    };
  }, [objectKey]);

  if (!src) {
    return <div className="w-14 h-14 rounded-xl bg-gray-100 animate-pulse shrink-0" />;
  }
  return (
    <img
      src={src}
      alt=""
      className="w-14 h-14 object-cover rounded-xl border border-gray-100 shrink-0"
    />
  );
};

const AdminProjectAdoptionReviewPanel: React.FC<AdminProjectAdoptionReviewPanelProps> = ({
  onPendingCountChange,
}) => {
  const { t } = useTranslation();
  const [rows, setRows] = useState<AdminProjectAdoptionRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<AdminProjectAdoptionRow | null>(null);
  const [detailUrls, setDetailUrls] = useState<string[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await fetchPendingProjectAdoptionsForAdmin();
      setRows(list);
      onPendingCountChange?.(list.length);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (!detail) {
      setDetailUrls([]);
      setRejectReason('');
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    const keys = detail.project_images
      .map((k) => parseOssObjectKey(k) ?? k)
      .filter(Boolean);
    void fetchReadUrlsForObjectKeys(keys).then((map) => {
      if (cancelled) return;
      setDetailUrls(
        detail.project_images.map((raw) => {
          const key = parseOssObjectKey(raw) ?? raw;
          return resolveUrlFromMap('', key, map);
        }).filter(Boolean)
      );
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [detail]);

  const handleApprove = async (id: string) => {
    if (!window.confirm(t('admin.adoptionConfirmApprove'))) return;
    setBusyId(id);
    const result = await approveProjectAdoption(id);
    setBusyId(null);
    if (!result.ok) {
      alert(result.error || t('admin.adoptionApproveFail'));
      return;
    }
    setDetail(null);
    await reload();
  };

  const handleReject = async () => {
    if (!detail) return;
    setBusyId(detail.id);
    const result = await rejectProjectAdoption(detail.id, rejectReason);
    setBusyId(null);
    if (!result.ok) {
      alert(result.error || t('admin.adoptionRejectFail'));
      return;
    }
    setDetail(null);
    setRejectReason('');
    await reload();
  };

  return (
    <div>
      <div className="px-6 md:px-8 pt-8 pb-4 flex justify-between items-start gap-4">
        <div>
          <h2 className="text-lg font-black">{t('admin.tabProjectAdoptions')}</h2>
          <p className="text-xs text-gray-400 mt-1">{t('admin.adoptionHint')}</p>
        </div>
        <button
          type="button"
          onClick={() => void reload()}
          className="text-xs font-bold text-gray-500 hover:text-black"
        >
          {t('admin.adoptionRefresh')}
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
              <th className="p-4 md:p-6">{t('admin.adoptionColThumb')}</th>
              <th className="p-4 md:p-6">{t('admin.adoptionColDesigner')}</th>
              <th className="p-4 md:p-6">{t('admin.adoptionColMaterial')}</th>
              <th className="p-4 md:p-6">{t('admin.adoptionColTime')}</th>
              <th className="p-4 md:p-6 text-right">{t('admin.adoptionColActions')}</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-sm text-gray-400">
                  {t('admin.adoptionLoading')}
                </td>
              </tr>
            )}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="p-10 text-center text-sm text-gray-400">
                  {t('admin.adoptionEmpty')}
                </td>
              </tr>
            )}
            {!loading &&
              rows.map((row) => {
                const firstKey = row.project_images[0] ?? '';
                return (
                  <tr key={row.id} className="border-b border-gray-50 hover:bg-gray-50/60">
                    <td className="p-4 md:p-6">
                      {firstKey ? <Thumb objectKey={firstKey} /> : (
                        <div className="w-14 h-14 rounded-xl bg-gray-100" />
                      )}
                    </td>
                    <td className="p-4 md:p-6">
                      <p className="font-bold text-sm">{row.designer_name}</p>
                      {row.designer_email && (
                        <p className="text-[11px] text-gray-400 mt-0.5">{row.designer_email}</p>
                      )}
                    </td>
                    <td className="p-4 md:p-6 text-sm font-medium">{row.material_name}</td>
                    <td className="p-4 md:p-6 text-xs text-gray-500 whitespace-nowrap">
                      {formatTime(row.created_at)}
                    </td>
                    <td className="p-4 md:p-6 text-right">
                      <button
                        type="button"
                        onClick={() => setDetail(row)}
                        className="text-xs font-bold text-blue-600 hover:underline"
                      >
                        {t('admin.adoptionReview')}
                      </button>
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>

      {detail && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[120] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-3xl shadow-2xl p-6 sm:p-8">
            <div className="flex justify-between items-start gap-4 mb-4">
              <div>
                <h3 className="text-xl font-black">{t('admin.adoptionDetailTitle')}</h3>
                <p className="text-sm text-gray-500 mt-1">
                  {detail.designer_name} · {detail.material_name}
                </p>
                <p className="text-[11px] text-gray-400 mt-1">{formatTime(detail.created_at)}</p>
              </div>
              <button
                type="button"
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-black text-xl font-bold leading-none"
                aria-label={t('common.cancel')}
              >
                ×
              </button>
            </div>

            {detailLoading ? (
              <div className="py-16 text-center text-sm text-gray-400">{t('admin.adoptionLoading')}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
                {detailUrls.map((url, i) => (
                  <a
                    key={`${url}-${i}`}
                    href={url}
                    target="_blank"
                    rel="noreferrer"
                    className="aspect-square rounded-2xl overflow-hidden border border-gray-100 bg-gray-50"
                  >
                    <img src={url} alt="" className="w-full h-full object-cover" />
                  </a>
                ))}
                {detailUrls.length === 0 && (
                  <p className="col-span-full text-sm text-gray-400">{t('admin.adoptionNoImages')}</p>
                )}
              </div>
            )}

            <label className="block text-xs font-bold text-gray-400 uppercase mb-1">
              {t('admin.adoptionRejectReason')}
            </label>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={3}
              placeholder={t('admin.adoptionRejectPlaceholder')}
              className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black resize-none mb-5"
            />

            <div className="flex flex-col sm:flex-row gap-3">
              <button
                type="button"
                disabled={busyId === detail.id}
                onClick={() => void handleApprove(detail.id)}
                className="flex-1 py-3 bg-black text-white rounded-xl font-bold disabled:opacity-40"
              >
                {t('admin.adoptionApprove')}
              </button>
              <button
                type="button"
                disabled={busyId === detail.id}
                onClick={() => void handleReject()}
                className="flex-1 py-3 border-2 border-red-500 text-red-600 rounded-xl font-bold disabled:opacity-40"
              >
                {t('admin.adoptionReject')}
              </button>
              <button
                type="button"
                disabled={busyId === detail.id}
                onClick={() => setDetail(null)}
                className="flex-1 py-3 text-gray-500 font-bold"
              >
                {t('common.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminProjectAdoptionReviewPanel;

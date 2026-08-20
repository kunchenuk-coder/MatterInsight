import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopicContentRenderer from './TopicContentRenderer';
import {
  approveTopicVersion,
  fetchPendingTopicReviews,
  fetchTopicReviewHistory,
  rejectTopicVersion,
} from '../../services/topicArticleAdminService';
import type { TopicArticle } from '../../types/topicArticle';

interface AdminTopicReviewPanelProps {
  onPendingCountChange?: (count: number) => void;
}

const AdminTopicReviewPanel: React.FC<AdminTopicReviewPanelProps> = ({ onPendingCountChange }) => {
  const { t } = useTranslation();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [pending, setPending] = useState<TopicArticle[]>([]);
  const [history, setHistory] = useState<TopicArticle[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TopicArticle | null>(null);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const [p, h] = await Promise.all([fetchPendingTopicReviews(), fetchTopicReviewHistory()]);
      setPending(p);
      setHistory(h);
      onPendingCountChange?.(p.length);
    } finally {
      setLoading(false);
    }
  }, [onPendingCountChange]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const versionOf = (row: TopicArticle) =>
    row.workingVersion || row.publishedVersion || row.versions?.[0] || null;

  const handleApprove = async (versionId: string) => {
    setBusyId(versionId);
    const result = await approveTopicVersion(versionId);
    setBusyId(null);
    if (!result.ok) {
      alert(result.error || t('topics.approveFail'));
      return;
    }
    setDetail(null);
    await reload();
  };

  const handleReject = async () => {
    if (!rejectId) return;
    if (!rejectReason.trim()) {
      alert(t('topics.rejectReasonRequired'));
      return;
    }
    setBusyId(rejectId);
    const result = await rejectTopicVersion(rejectId, rejectReason.trim());
    setBusyId(null);
    if (!result.ok) {
      alert(result.error || t('topics.rejectFail'));
      return;
    }
    setRejectId(null);
    setRejectReason('');
    setDetail(null);
    await reload();
  };

  const rows = tab === 'pending' ? pending : history;

  return (
    <div>
      <div className="px-8 pt-8 pb-2 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
        <div>
          <h2 className="text-lg font-black">{t('admin.tabTopics')}</h2>
          <p className="text-xs text-gray-400 mt-1">{t('topics.adminHint')}</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setTab('pending')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${
                tab === 'pending' ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
            >
              {t('topics.pendingQueue')} {pending.length > 0 && `(${pending.length})`}
            </button>
            <button
              type="button"
              onClick={() => setTab('history')}
              className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase ${
                tab === 'history' ? 'bg-white shadow-sm' : 'text-gray-400'
              }`}
            >
              {t('topics.reviewHistory')}
            </button>
          </div>
          <button type="button" onClick={() => void reload()} className="text-xs font-bold border px-4 py-2 rounded-xl">
            {t('topics.refresh')}
          </button>
        </div>
      </div>
      <table className="w-full text-left border-collapse">
        <thead>
          <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
            <th className="p-6">{t('topics.colTitle')}</th>
            <th className="p-6">{t('topics.colSupplier')}</th>
            <th className="p-6">{t('topics.colSubmitted')}</th>
            <th className="p-6">{t('topics.colStatus')}</th>
            <th className="p-6 text-right">{t('topics.colActions')}</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="p-16 text-center text-gray-400 text-sm">
                {t('common.loading')}
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={5} className="p-16 text-center text-gray-300 italic">
                {tab === 'pending' ? t('topics.emptyPending') : t('topics.emptyHistory')}
              </td>
            </tr>
          ) : (
            rows.map((row) => {
              const version = versionOf(row);
              if (!version) return null;
              return (
                <tr key={version.id} className="border-b hover:bg-gray-50">
                  <td className="p-6 font-bold text-sm">{version.title || t('topics.untitled')}</td>
                  <td className="p-6">
                    <p className="text-xs font-bold">{row.supplierName || '—'}</p>
                    <p className="text-[10px] text-gray-400 break-all">{row.supplierEmail}</p>
                  </td>
                  <td className="p-6 text-xs text-gray-400 whitespace-nowrap">
                    {version.submittedAt ? new Date(version.submittedAt).toLocaleString() : '—'}
                  </td>
                  <td className="p-6 text-xs font-bold">{version.status}</td>
                  <td className="p-6 text-right space-x-3 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => setDetail(row)}
                      className="text-xs font-bold hover:underline"
                    >
                      {t('topics.reviewDetail')}
                    </button>
                    {tab === 'pending' && (
                      <>
                        <button
                          type="button"
                          disabled={busyId === version.id}
                          onClick={() => void handleApprove(version.id)}
                          className="text-xs font-bold bg-black text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                        >
                          {t('topics.approve')}
                        </button>
                        <button
                          type="button"
                          disabled={busyId === version.id}
                          onClick={() => {
                            setRejectId(version.id);
                            setRejectReason('');
                          }}
                          className="text-xs font-bold text-amber-700 hover:underline"
                        >
                          {t('topics.reject')}
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>

      {detail && versionOf(detail) && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-3xl max-h-[90vh] overflow-y-auto rounded-[32px] p-8 space-y-6">
            <div className="flex justify-between items-start gap-4">
              <h3 className="text-2xl font-black">{versionOf(detail)?.title}</h3>
              <button type="button" onClick={() => setDetail(null)} className="text-gray-400 text-xl">
                ✕
              </button>
            </div>
            <p className="text-xs text-gray-400">
              {detail.supplierName} · {versionOf(detail)?.submittedAt
                ? new Date(versionOf(detail)!.submittedAt!).toLocaleString()
                : ''}
            </p>
            <TopicContentRenderer blocks={versionOf(detail)!.content} />
            {tab === 'pending' && (
              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  className="flex-1 py-3 rounded-2xl bg-black text-white font-bold"
                  onClick={() => void handleApprove(versionOf(detail)!.id)}
                >
                  {t('topics.approve')}
                </button>
                <button
                  type="button"
                  className="flex-1 py-3 rounded-2xl border font-bold"
                  onClick={() => {
                    setRejectId(versionOf(detail)!.id);
                    setRejectReason('');
                  }}
                >
                  {t('topics.reject')}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {rejectId && (
        <div className="fixed inset-0 bg-black/60 z-[210] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md rounded-[32px] p-8 space-y-4">
            <h3 className="text-xl font-black">{t('topics.rejectTitle')}</h3>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              rows={4}
              placeholder={t('topics.rejectPlaceholder')}
              className="w-full border rounded-2xl p-4 text-sm outline-none focus:border-black resize-none"
            />
            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => {
                  setRejectId(null);
                  setRejectReason('');
                }}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-gray-500"
              >
                {t('common.cancel')}
              </button>
              <button
                type="button"
                disabled={!!busyId}
                onClick={() => void handleReject()}
                className="flex-1 py-3 rounded-2xl text-sm font-bold bg-black text-white"
              >
                {t('topics.reject')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminTopicReviewPanel;

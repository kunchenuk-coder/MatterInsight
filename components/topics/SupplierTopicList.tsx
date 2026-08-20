import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  archiveTopicArticle,
  deleteTopicVersion,
  fetchSupplierTopicArticles,
  withdrawTopicVersion,
} from '../../services/topicArticleService';
import { getSupplierTopicEditPath, getTopicPath, navigateTo } from '../../router';
import type { TopicArticle } from '../../types/topicArticle';

interface SupplierTopicListProps {
  supplierId: string;
}

type TopicBucket = 'draft' | 'pending' | 'published' | 'archived';

function bucketOf(article: TopicArticle): TopicBucket {
  if (article.isArchived) return 'archived';
  const working = article.workingVersion?.status;
  if (working === 'pending_review') return 'pending';
  if (working === 'draft' || working === 'rejected') return 'draft';
  if (article.publishedVersion) return 'published';
  return 'draft';
}

const SupplierTopicList: React.FC<SupplierTopicListProps> = ({ supplierId }) => {
  const { t } = useTranslation();
  const [items, setItems] = useState<TopicArticle[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    setLoading(true);
    const rows = await fetchSupplierTopicArticles(supplierId);
    setItems(rows);
    setLoading(false);
  }, [supplierId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const onEdit = (article: TopicArticle) => {
    if (article.workingVersion?.status === 'pending_review') {
      alert(t('topics.needWithdraw'));
      return;
    }
    navigateTo(getSupplierTopicEditPath(article.id));
  };

  const onWithdraw = async (article: TopicArticle) => {
    const versionId = article.workingVersion?.id;
    if (!versionId) return;
    const result = await withdrawTopicVersion(versionId);
    if (!result.ok) {
      alert(result.error || t('topics.withdrawFail'));
      return;
    }
    await reload();
  };

  const onDeleteWorking = async (article: TopicArticle) => {
    const working = article.workingVersion;
    if (!working || (working.status !== 'draft' && working.status !== 'rejected')) return;
    if (!window.confirm(t('topics.confirmDeleteVersion'))) return;
    const result = await deleteTopicVersion(working.id);
    if (!result.ok) {
      alert(result.error || t('topics.deleteFail'));
      return;
    }
    await reload();
  };

  const onArchive = async (article: TopicArticle) => {
    if (!window.confirm(t('topics.confirmArchive'))) return;
    const result = await archiveTopicArticle(article.id);
    if (!result.ok) {
      alert(result.error || t('topics.archiveFail'));
      return;
    }
    await reload();
  };

  const renderCard = (article: TopicArticle) => {
    const published = article.publishedVersion;
    const working = article.workingVersion;
    const title = working?.title || published?.title || t('topics.untitled');
    return (
      <div key={article.id} className="bg-white border border-gray-100 rounded-3xl p-6 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-black text-lg">{title}</h3>
            {article.isArchived && (
              <p className="text-xs font-bold text-gray-400 mt-1">{t('topics.statusArchived')}</p>
            )}
            {published && !article.isArchived && (
              <p className="text-xs font-bold text-emerald-700 mt-1">{t('topics.statusPublished')}</p>
            )}
            {working?.status === 'draft' && (
              <p className="text-xs font-bold text-gray-500 mt-1">{t('topics.saved')}</p>
            )}
            {working?.status === 'pending_review' && (
              <p className="text-xs font-bold text-amber-600 mt-1">{t('topics.statusPending')}</p>
            )}
            {working?.status === 'rejected' && (
              <div className="mt-2 text-sm text-red-600">
                <p className="font-bold">{t('topics.statusRejected')}</p>
                {working.rejectionReason && (
                  <p className="text-xs mt-1 text-red-500">
                    {t('topics.rejectedReason')}: {working.rejectionReason}
                  </p>
                )}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {published && !article.isArchived && (
              <button
                type="button"
                onClick={() => navigateTo(getTopicPath(article.id))}
                className="text-xs font-bold px-3 py-2 rounded-xl border"
              >
                {t('topics.viewLive')}
              </button>
            )}
            {working?.status === 'pending_review' && (
              <button
                type="button"
                onClick={() => void onWithdraw(article)}
                className="text-xs font-bold px-3 py-2 rounded-xl border"
              >
                {t('topics.withdraw')}
              </button>
            )}
            {working?.status !== 'pending_review' && !article.isArchived && (
              <button
                type="button"
                onClick={() => onEdit(article)}
                className="text-xs font-bold px-3 py-2 rounded-xl bg-black text-white"
              >
                {published && working?.status !== 'draft' && working?.status !== 'rejected'
                  ? t('topics.editNewVersion')
                  : t('topics.edit')}
              </button>
            )}
            {(working?.status === 'draft' || working?.status === 'rejected') && (
              <button
                type="button"
                onClick={() => void onDeleteWorking(article)}
                className="text-xs font-bold px-3 py-2 rounded-xl text-red-500"
              >
                {t('topics.deleteVersion')}
              </button>
            )}
            {published && !article.isArchived && (
              <button
                type="button"
                onClick={() => void onArchive(article)}
                className="text-xs font-bold px-3 py-2 rounded-xl text-gray-500"
              >
                {t('topics.archive')}
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  if (loading) {
    return <p className="text-sm text-gray-400">{t('common.loading')}</p>;
  }
  if (items.length === 0) {
    return <p className="text-sm text-gray-400">{t('topics.emptyMine')}</p>;
  }

  const drafts = items.filter((row) => bucketOf(row) === 'draft');
  const pending = items.filter((row) => bucketOf(row) === 'pending');
  const published = items.filter((row) => bucketOf(row) === 'published');
  const archived = items.filter((row) => bucketOf(row) === 'archived');

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h3 className="text-sm font-black tracking-widest uppercase text-gray-400">{t('topics.draftBox')}</h3>
        {drafts.length === 0 ? (
          <p className="text-sm text-gray-400">{t('topics.emptyDraftBox')}</p>
        ) : (
          <div className="space-y-4">{drafts.map(renderCard)}</div>
        )}
      </section>
      {pending.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-widest uppercase text-gray-400">{t('topics.inReviewBox')}</h3>
          <div className="space-y-4">{pending.map(renderCard)}</div>
        </section>
      )}
      {published.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-widest uppercase text-gray-400">{t('topics.publishedBox')}</h3>
          <div className="space-y-4">{published.map(renderCard)}</div>
        </section>
      )}
      {archived.length > 0 && (
        <section className="space-y-3">
          <h3 className="text-sm font-black tracking-widest uppercase text-gray-400">{t('topics.statusArchived')}</h3>
          <div className="space-y-4">{archived.map(renderCard)}</div>
        </section>
      )}
    </div>
  );
};

export default SupplierTopicList;

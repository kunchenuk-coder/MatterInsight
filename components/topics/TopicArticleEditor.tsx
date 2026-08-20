import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopicContentEditor from './TopicContentEditor';
import {
  SUBTITLE_MAX,
  createEmptyTextBlock,
  createTopicArticle,
  ensureWorkingDraft,
  fetchTopicArticleForSupplier,
  saveTopicVersionDraft,
  submitTopicVersion,
  topicContentIsPublishable,
} from '../../services/topicArticleService';
import { getSupplierTopicEditPath, navigateTo } from '../../router';
import type { TopicContentBlock } from '../../types/topicArticle';

interface TopicArticleEditorProps {
  userId: string;
  articleId?: string | null;
  onBack: () => void;
  onSubmitted?: () => void;
}

const TITLE_MAX = 150;

const TopicArticleEditor: React.FC<TopicArticleEditorProps> = ({
  userId,
  articleId: articleIdProp,
  onBack,
  onSubmitted,
}) => {
  const { t } = useTranslation();
  const [articleId, setArticleId] = useState(articleIdProp ?? '');
  const [versionId, setVersionId] = useState('');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [blocks, setBlocks] = useState<TopicContentBlock[]>([createEmptyTextBlock()]);
  const [status, setStatus] = useState('draft');
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [messageKind, setMessageKind] = useState<'ok' | 'err'>('ok');
  const [draftSaved, setDraftSaved] = useState(false);
  const [hydrateKey, setHydrateKey] = useState('new');

  useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      if (!articleIdProp) {
        setHydrateKey('new');
        setLoading(false);
        return;
      }
      setLoading(true);
      try {
        const article = await fetchTopicArticleForSupplier(articleIdProp);
        if (cancelled) return;
        if (!article) {
          setMessageKind('err');
          setMessage(t('topics.notFound'));
          return;
        }
        const ensured = await ensureWorkingDraft(articleIdProp);
        if (cancelled) return;
        if (ensured.ok === false) {
          setMessageKind('err');
          setMessage(ensured.error);
          return;
        }
        setArticleId(article.id);
        setVersionId(ensured.version.id);
        setTitle(ensured.version.title);
        setSubtitle(ensured.version.subtitle ?? '');
        setBlocks(
          ensured.version.content.length > 0 ? ensured.version.content : [createEmptyTextBlock()]
        );
        setStatus(ensured.version.status);
        setRejectionReason(ensured.version.rejectionReason);
        setDraftSaved(ensured.version.status === 'draft');
        setHydrateKey(`${article.id}:${ensured.version.id}:${ensured.version.updatedAt}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void boot();
    return () => {
      cancelled = true;
    };
  }, [articleIdProp, t]);

  const persist = async (thenSubmit: boolean) => {
    const trimmed = title.trim();
    const trimmedSubtitle = subtitle.trim();
    if (thenSubmit) {
      if (!trimmed) {
        setMessageKind('err');
        setMessage(t('topics.titleRequired'));
        return;
      }
      if (!trimmedSubtitle) {
        setMessageKind('err');
        setMessage(t('topics.subtitleRequired'));
        return;
      }
      if (!topicContentIsPublishable(blocks)) {
        setMessageKind('err');
        setMessage(t('topics.bodyRequired'));
        return;
      }
    }
    setSaving(true);
    setMessage('');
    let nextVersionId = versionId;
    let createdArticleId = articleId;
    if (!nextVersionId) {
      const created = await createTopicArticle(userId);
      if (created.ok === false) {
        setSaving(false);
        setMessageKind('err');
        setMessage(created.error);
        return;
      }
      createdArticleId = created.articleId;
      nextVersionId = created.versionId;
      setArticleId(created.articleId);
      setVersionId(created.versionId);
    }
    const saved = await saveTopicVersionDraft(nextVersionId, {
      title: trimmed,
      subtitle: trimmedSubtitle,
      content: blocks,
    });
    if (saved.ok === false) {
      setSaving(false);
      setMessageKind('err');
      setMessage(saved.error || t('topics.saveFail'));
      return;
    }
    if (!thenSubmit) {
      if (!articleIdProp && createdArticleId) {
        navigateTo(getSupplierTopicEditPath(createdArticleId), true);
      }
      setSaving(false);
      setStatus('draft');
      setDraftSaved(true);
      setMessageKind('ok');
      setMessage(t('topics.saved'));
      return;
    }
    const submitted = await submitTopicVersion(nextVersionId);
    if (!articleIdProp && createdArticleId) {
      navigateTo(getSupplierTopicEditPath(createdArticleId), true);
    }
    setSaving(false);
    if (submitted.ok === false) {
      setMessageKind('err');
      setMessage(submitted.error || t('topics.submitFail'));
      return;
    }
    setStatus('pending_review');
    setDraftSaved(false);
    setMessageKind('ok');
    setMessage(t('topics.submitted'));
    onSubmitted?.();
  };

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-gray-400 font-bold">
        {t('common.loading')}
      </div>
    );
  }

  const readOnly = status === 'pending_review';

  return (
    <div className="max-w-3xl mx-auto py-10 space-y-8">
      <div className="flex items-center justify-between gap-4">
        <button type="button" onClick={onBack} className="text-sm font-bold text-gray-500 hover:text-black">
          ← {t('topics.backSupplier')}
        </button>
        <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">
          {status === 'pending_review'
            ? t('topics.statusPending')
            : draftSaved
              ? t('topics.saved')
              : articleId
                ? t('topics.statusDraft')
                : ''}
        </span>
      </div>
      <h1 className="text-3xl font-black tracking-tight">{t('topics.editorTitle')}</h1>
      {rejectionReason && (
        <div className="rounded-2xl bg-amber-50 border border-amber-100 p-4 text-sm text-amber-800">
          {t('topics.rejectedReason')}: {rejectionReason}
        </div>
      )}
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
          {t('topics.titleLabel')}
        </label>
        <input
          disabled={readOnly || saving}
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => {
            setDraftSaved(false);
            setTitle(e.target.value);
          }}
          placeholder={t('topics.titlePlaceholder')}
          className="w-full rounded-2xl bg-gray-50 p-4 text-lg font-bold outline-none focus:ring-2 focus:ring-black"
        />
        <p className="text-[10px] text-gray-400 mt-2 text-right">
          {title.length}/{TITLE_MAX}
        </p>
      </div>
      <div>
        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-2">
          {t('topics.subtitleLabel')}
        </label>
        <input
          disabled={readOnly || saving}
          value={subtitle}
          maxLength={SUBTITLE_MAX}
          onChange={(e) => {
            setDraftSaved(false);
            setSubtitle(e.target.value);
          }}
          placeholder={t('topics.subtitlePlaceholder')}
          className="w-full rounded-2xl bg-gray-50 p-4 text-sm outline-none focus:ring-2 focus:ring-black"
        />
        <p className="text-[10px] text-gray-400 mt-2 text-right">
          {Array.from(subtitle).length}/{SUBTITLE_MAX}
        </p>
      </div>
      <TopicContentEditor
        blocks={blocks}
        hydrateKey={hydrateKey}
        disabled={readOnly || saving}
        onChange={(next) => {
          setDraftSaved(false);
          setBlocks(next);
        }}
      />
      {message && (
        <p className={`text-sm font-bold ${messageKind === 'err' ? 'text-red-600' : 'text-emerald-700'}`}>
          {message}
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={readOnly || saving}
          onClick={() => void persist(false)}
          className="px-6 py-3 rounded-2xl border font-bold"
        >
          {t('topics.saveDraft')}
        </button>
        <button
          type="button"
          disabled={readOnly || saving}
          onClick={() => void persist(true)}
          className="px-6 py-3 rounded-2xl bg-black text-white font-bold"
        >
          {t('topics.submitReview')}
        </button>
      </div>
    </div>
  );
};

export default TopicArticleEditor;

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import TopicContentRenderer from './TopicContentRenderer';
import { fetchPublishedTopicById } from '../../services/topicArticleService';
import type { TopicArticle, TopicContentBlock } from '../../types/topicArticle';

interface TopicArticleDetailProps {
  articleId: string;
  onBack: () => void;
}

const TopicArticleDetail: React.FC<TopicArticleDetailProps> = ({ articleId, onBack }) => {
  const { t } = useTranslation();
  const [article, setArticle] = useState<TopicArticle | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void fetchPublishedTopicById(articleId).then((row) => {
      if (cancelled) return;
      setArticle(row);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [articleId]);

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center text-gray-400 font-bold">
        {t('common.loading')}
      </div>
    );
  }

  const version = article?.publishedVersion;
  if (!version) {
    return (
      <div className="max-w-3xl mx-auto py-20 text-center">
        <p className="text-gray-400 font-bold mb-4">{t('topics.notPublished')}</p>
        <button type="button" onClick={onBack} className="text-sm font-bold">
          {t('common.backToExplore')}
        </button>
      </div>
    );
  }

  const publishedLabel = version.publishedAt
    ? new Date(version.publishedAt).toLocaleDateString()
    : '';
  const firstImage = version.content.find(
    (block): block is Extract<TopicContentBlock, { type: 'image' }> =>
      block.type === 'image' && Boolean(block.imageUrl)
  );
  const restBlocks = firstImage
    ? version.content.filter((block) => block.id !== firstImage.id)
    : version.content;
  const trailingImages: Extract<TopicContentBlock, { type: 'image' }>[] = [];
  const middle: TopicContentBlock[] = [...restBlocks];
  while (middle.length > 0 && middle[middle.length - 1].type === 'image') {
    const last = middle.pop();
    if (last && last.type === 'image' && last.imageUrl) trailingImages.unshift(last);
  }

  return (
    <article className="max-w-3xl mx-auto py-8 md:py-10 space-y-8">
      <button type="button" onClick={onBack} className="text-sm font-bold text-gray-500 hover:text-black">
        ← {t('common.backToExplore')}
      </button>
      {firstImage?.imageUrl && (
        <img
          src={firstImage.imageUrl}
          alt={firstImage.caption || version.title}
          className="w-full max-h-[70vh] object-cover rounded-[28px] bg-gray-50"
        />
      )}
      <header className="space-y-3">
        <p className="text-[10px] font-black uppercase tracking-[0.2em] text-gray-400">
          {t('explore.whatsNew')}
        </p>
        <h1 className="text-3xl md:text-5xl font-black tracking-tighter leading-tight">{version.title}</h1>
        {publishedLabel && <p className="text-sm text-gray-400">{publishedLabel}</p>}
      </header>
      {middle.some(
        (block) =>
          (block.type === 'text' && block.content.trim()) ||
          (block.type === 'image' && Boolean(block.imageUrl))
      ) && <TopicContentRenderer blocks={middle} />}
      {trailingImages.length > 0 && (
        <div className={`grid gap-3 ${trailingImages.length === 1 ? 'grid-cols-1' : 'grid-cols-2'}`}>
          {trailingImages.map((block) => (
            <img
              key={block.id}
              src={block.imageUrl}
              alt={block.caption || ''}
              className="w-full aspect-[4/3] object-cover rounded-[24px] bg-gray-50"
            />
          ))}
        </div>
      )}
    </article>
  );
};

export default TopicArticleDetail;

import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { fetchPublishedTopics } from '../../services/topicArticleService';
import { getTopicPath, navigateTo } from '../../router';
import type { TopicArticle } from '../../types/topicArticle';

const coverOf = (article: TopicArticle): string => {
  const version = article.publishedVersion;
  if (!version) return '';
  const byCover = version.coverImageObjectKey
    ? version.content.find(
        (block) => block.type === 'image' && block.ossObjectKey === version.coverImageObjectKey
      )
    : undefined;
  const image =
    byCover && byCover.type === 'image'
      ? byCover
      : version.content.find((block) => block.type === 'image');
  return image && image.type === 'image' ? image.imageUrl || '' : '';
};

const subtitleOf = (article: TopicArticle): string => {
  const version = article.publishedVersion;
  if (!version) return '';
  const dedicated = version.subtitle?.trim();
  if (dedicated) return dedicated;
  const text = version.content.find(
    (block) => block.type === 'text' && block.content.trim()
  );
  if (!text || text.type !== 'text') return '';
  return Array.from(text.content.trim().replace(/\s+/g, ' ')).slice(0, 50).join('');
};

const WhatsNewSection: React.FC = () => {
  const { t } = useTranslation();
  const [topics, setTopics] = useState<TopicArticle[]>([]);

  useEffect(() => {
    let cancelled = false;
    void fetchPublishedTopics().then((rows) => {
      if (!cancelled) setTopics(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const featured = topics[0] ?? null;
  const featuredCover = featured ? coverOf(featured) : '';
  const title = featured?.publishedVersion?.title?.trim() || t('explore.whatsNew');
  const subtitle = featured ? subtitleOf(featured) : t('explore.heroDesc');

  const openFeatured = () => {
    if (!featured) return;
    navigateTo(getTopicPath(featured.id));
  };

  const inner = (
    <>
      {featuredCover && (
        <img
          src={featuredCover}
          alt=""
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      <div
        className={`absolute inset-0 bg-black/55 transition-colors duration-500 ${
          featured ? 'group-hover:bg-transparent' : ''
        }`}
      />
      <div className="relative z-10 w-full">
        <h2
          className={`font-black tracking-tighter mb-3 md:mb-2 leading-tight drop-shadow-[0_2px_8px_rgba(0,0,0,0.65)] ${
            featured ? 'text-2xl md:text-4xl normal-case' : 'text-3xl md:text-5xl uppercase leading-none'
          }`}
        >
          {title}
        </h2>
        {subtitle ? (
          <p className="text-white/90 font-medium text-xs md:text-sm max-w-md leading-relaxed md:leading-tight drop-shadow-[0_1px_6px_rgba(0,0,0,0.65)]">
            {subtitle}
          </p>
        ) : null}
      </div>
    </>
  );

  const shellClass =
    'bg-black text-white p-6 md:p-12 rounded-[30px] md:rounded-[40px] relative overflow-hidden min-h-[14rem] md:h-64 flex items-center w-full text-left';

  return (
    <div className="mb-8 md:mb-10 mt-4 md:mt-6">
      {featured ? (
        <button type="button" onClick={openFeatured} className={`group ${shellClass} cursor-pointer`}>
          {inner}
        </button>
      ) : (
        <div className={shellClass}>{inner}</div>
      )}
    </div>
  );
};

export default WhatsNewSection;

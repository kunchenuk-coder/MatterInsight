import React from 'react';
import type { TopicContentBlock } from '../../types/topicArticle';

interface TopicContentRendererProps {
  blocks: TopicContentBlock[];
}

const TopicContentRenderer: React.FC<TopicContentRendererProps> = ({ blocks }) => {
  if (blocks.length === 0) {
    return <p className="text-gray-400 text-sm">暂无正文</p>;
  }

  return (
    <div className="space-y-8">
      {blocks.map((block) => {
        if (block.type === 'text') {
          if (!block.content.trim()) return null;
          return (
            <p
              key={block.id}
              className="text-gray-700 leading-relaxed text-base md:text-lg whitespace-pre-wrap"
            >
              {block.content}
            </p>
          );
        }
        const src = block.imageUrl || '';
        if (!src) return null;
        return (
          <figure key={block.id} className="space-y-3">
            <img
              src={src}
              alt={block.caption || ''}
              className="w-full h-auto rounded-2xl object-contain bg-gray-50"
            />
            {block.caption?.trim() ? (
              <figcaption className="text-center text-xs text-gray-400">{block.caption}</figcaption>
            ) : null}
          </figure>
        );
      })}
    </div>
  );
};

export default TopicContentRenderer;

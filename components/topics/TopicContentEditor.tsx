import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { uploadImage } from '../../services/uploadService';
import type { TopicContentBlock } from '../../types/topicArticle';
import { createEmptyTextBlock } from '../../services/topicArticleService';
import {
  createImageWrap,
  editorHasVisibleContent,
  ensureEditableSlots,
  insertNodesAtCaret,
  isImageWrap,
  moveImageWrap,
  placeCaretAtPoint,
  serializeTopicEditor,
  topicBlocksToEditorHtml,
} from '../../utils/topicEditorDom';

interface TopicContentEditorProps {
  blocks: TopicContentBlock[];
  onChange: (blocks: TopicContentBlock[]) => void;
  disabled?: boolean;
  hydrateKey?: string;
}

const TopicContentEditor: React.FC<TopicContentEditorProps> = ({
  blocks,
  onChange,
  disabled = false,
  hydrateKey = '',
}) => {
  const { t } = useTranslation();
  const editorRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const draggingWrapRef = useRef<HTMLElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    const el = editorRef.current;
    if (!el) return;
    el.innerHTML = topicBlocksToEditorHtml(blocks);
    ensureEditableSlots(el);
  }, [hydrateKey]);

  const emitChange = () => {
    const el = editorRef.current;
    if (!el) return;
    ensureEditableSlots(el);
    const next = serializeTopicEditor(el);
    if (next.length === 0 && !el.textContent?.trim() && !el.querySelector('img')) {
      el.innerHTML = '<p><br></p>';
    }
    onChange(next.length > 0 ? next : [createEmptyTextBlock()]);
  };

  const insertImageFiles = async (files: File[]) => {
    const images = files.filter((file) => file.type.startsWith('image/'));
    if (images.length === 0 || disabled) return;
    const el = editorRef.current;
    if (!el) return;
    setUploading(true);
    try {
      const nodes: Node[] = [];
      for (const file of images) {
        const result = await uploadImage(file, 'topics');
        const ossObjectKey = result.objectKey;
        if (!ossObjectKey) {
          alert(t('topics.uploadNeedKey'));
          continue;
        }
        nodes.push(createImageWrap(ossObjectKey, result.url));
      }
      if (nodes.length > 0) {
        insertNodesAtCaret(el, nodes);
        emitChange();
      }
    } catch (err) {
      console.error(err);
      alert(t('topics.uploadFail'));
    } finally {
      setUploading(false);
    }
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = '';
    void insertImageFiles(list);
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const files = Array.from(e.clipboardData?.files ?? []);
    if (files.some((file) => file.type.startsWith('image/'))) {
      e.preventDefault();
      void insertImageFiles(files);
      return;
    }
    e.preventDefault();
    const text = e.clipboardData.getData('text/plain');
    document.execCommand('insertText', false, text);
  };

  const onDragStart = (e: React.DragEvent<HTMLDivElement>) => {
    if (disabled) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) {
      e.preventDefault();
      return;
    }
    const wrap = target.closest('.topic-img-wrap');
    if (!wrap || !e.currentTarget.contains(wrap)) return;
    draggingWrapRef.current = wrap as HTMLElement;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', wrap.getAttribute('data-oss-key') || 'image');
  };

  const onDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (disabled) return;
    const el = editorRef.current;
    if (!el) return;

    const moving = draggingWrapRef.current;
    draggingWrapRef.current = null;
    if (moving && el.contains(moving)) {
      const dropEl = e.target as HTMLElement;
      const targetWrap = dropEl.closest('.topic-img-wrap');
      const targetP = dropEl.closest('p');
      if (targetWrap && targetWrap !== moving && el.contains(targetWrap)) {
        const rect = targetWrap.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        el.insertBefore(moving, before ? targetWrap : targetWrap.nextSibling);
      } else if (targetP && !targetP.closest('.topic-img-wrap') && el.contains(targetP)) {
        el.insertBefore(moving, targetP);
      }
      ensureEditableSlots(el);
      emitChange();
      return;
    }

    if (el) placeCaretAtPoint(el, e.clientX, e.clientY);
    void insertImageFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const wrap = target.closest('.topic-img-wrap');
    if (target.closest('[data-remove-image]')) {
      e.preventDefault();
      e.stopPropagation();
      wrap?.remove();
      emitChange();
      return;
    }
    if (wrap && isImageWrap(wrap)) {
      if (target.closest('[data-move-up]')) {
        e.preventDefault();
        e.stopPropagation();
        if (moveImageWrap(wrap, -1)) emitChange();
        return;
      }
      if (target.closest('[data-move-down]')) {
        e.preventDefault();
        e.stopPropagation();
        if (moveImageWrap(wrap, 1)) emitChange();
      }
    }
  };

  const empty = !editorHasVisibleContent(blocks);

  return (
    <div className="space-y-3">
      <style>{`
        .topic-composer-surface p,
        .topic-composer-surface div:not(.topic-img-wrap):not(.topic-img-tools) {
          margin: 0 0 0.75rem;
          min-height: 1.5em;
        }
        .topic-composer-surface:focus { outline: none; }
        .topic-img-wrap {
          display: block;
          position: relative;
          margin: 0.75rem 0;
          cursor: grab;
        }
        .topic-img-wrap img {
          display: block;
          width: 100%;
          max-height: 28rem;
          object-fit: contain;
          border-radius: 1rem;
          background: #f9fafb;
          pointer-events: none;
        }
        .topic-img-tools {
          position: absolute;
          top: 8px;
          right: 8px;
          display: flex;
          gap: 6px;
          z-index: 2;
        }
        .topic-img-tools button {
          width: 28px;
          height: 28px;
          border-radius: 999px;
          background: rgba(0,0,0,0.65);
          color: white;
          font-size: 14px;
          line-height: 1;
        }
      `}</style>
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-gray-400">{t('topics.editorHint')}</p>
        <button
          type="button"
          disabled={disabled || uploading}
          onMouseDown={(e) => {
            e.preventDefault();
            editorRef.current?.focus();
          }}
          onClick={() => fileRef.current?.click()}
          className="text-xs font-bold px-3 py-2 rounded-xl border disabled:opacity-40"
        >
          {t('topics.insertImage')}
        </button>
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={onFile}
      />
      <div
        className={`relative rounded-[28px] border bg-white min-h-[22rem] ${
          dragging ? 'border-black ring-2 ring-black/10' : 'border-gray-200'
        } ${disabled ? 'opacity-60' : ''}`}
      >
        {empty && !uploading && (
          <p className="pointer-events-none absolute left-6 top-6 text-sm text-gray-300">
            {t('topics.editorPlaceholder')}
          </p>
        )}
        <div
          ref={editorRef}
          contentEditable={!disabled}
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          className="topic-composer-surface relative z-10 min-h-[22rem] p-6 text-sm md:text-base leading-relaxed"
          onInput={emitChange}
          onPaste={onPaste}
          onClick={onClick}
          onDragStart={onDragStart}
          onDragEnd={() => {
            draggingWrapRef.current = null;
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            if (!disabled && !draggingWrapRef.current) setDragging(true);
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = draggingWrapRef.current ? 'move' : 'copy';
          }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
          }}
          onDrop={onDrop}
        />
      </div>
      {uploading && <p className="text-xs text-gray-400">{t('topics.uploading')}</p>}
    </div>
  );
};

export default TopicContentEditor;

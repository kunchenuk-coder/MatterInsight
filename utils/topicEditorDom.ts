import type { TopicContentBlock } from '../types/topicArticle';
import { createEmptyTextBlock } from '../services/topicArticleService';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function newBlockId(): string {
  return createEmptyTextBlock().id;
}

function imageWrapHtml(ossObjectKey: string, imageUrl: string): string {
  const src = escapeHtml(imageUrl);
  const key = escapeHtml(ossObjectKey);
  return (
    `<div class="topic-img-wrap" contenteditable="false" draggable="true" data-oss-key="${key}">` +
    `<div class="topic-img-tools">` +
    `<button type="button" data-move-up="1" aria-label="up">↑</button>` +
    `<button type="button" data-move-down="1" aria-label="down">↓</button>` +
    `<button type="button" data-remove-image="1" aria-label="remove">×</button>` +
    `</div>` +
    `<img data-oss-key="${key}" src="${src}" alt="" draggable="false" />` +
    `</div>`
  );
}

function emptyParagraphHtml(): string {
  return '<p><br></p>';
}

export function topicBlocksToEditorHtml(blocks: TopicContentBlock[]): string {
  const visible = blocks.filter((block) => {
    if (block.type === 'text') return Boolean(block.content.trim());
    return Boolean(block.ossObjectKey);
  });
  if (visible.length === 0) return emptyParagraphHtml();

  const parts: string[] = [];
  for (let i = 0; i < visible.length; i += 1) {
    const block = visible[i];
    const prev = i > 0 ? visible[i - 1] : null;
    if (block.type === 'image') {
      if (!prev || prev.type === 'image') parts.push(emptyParagraphHtml());
      parts.push(imageWrapHtml(block.ossObjectKey, block.imageUrl || ''));
      const next = visible[i + 1];
      if (!next || next.type === 'image') parts.push(emptyParagraphHtml());
    } else {
      const paragraphs = block.content.replace(/\r\n/g, '\n').split(/\n+/);
      parts.push(
        paragraphs.map((part) => `<p>${part ? escapeHtml(part) : '<br>'}</p>`).join('')
      );
    }
  }
  return parts.join('');
}

export function serializeTopicEditor(root: HTMLElement): TopicContentBlock[] {
  const blocks: TopicContentBlock[] = [];
  let textBuf = '';

  const flushText = () => {
    const content = textBuf.replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
    textBuf = '';
    if (content) {
      blocks.push({ id: newBlockId(), type: 'text', content });
    }
  };

  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      textBuf += node.textContent || '';
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.closest?.('.topic-img-tools')) return;

    if (node.classList.contains('topic-img-wrap') || node.tagName === 'IMG') {
      const img = node.tagName === 'IMG' ? node : node.querySelector('img');
      const key = (img?.getAttribute('data-oss-key') || node.getAttribute('data-oss-key') || '').trim();
      if (key) {
        flushText();
        blocks.push({
          id: newBlockId(),
          type: 'image',
          ossObjectKey: key,
          imageUrl: img?.getAttribute('src') || undefined,
        });
      }
      return;
    }

    if (node.tagName === 'BR') {
      textBuf += '\n';
      return;
    }

    const isBlock = ['P', 'DIV', 'FIGURE', 'LI', 'H1', 'H2', 'H3', 'H4'].includes(node.tagName);
    if (isBlock && node.classList.contains('topic-img-wrap')) return;
    for (const child of Array.from(node.childNodes)) walk(child);
    if (isBlock) textBuf += '\n';
  };

  for (const child of Array.from(root.childNodes)) walk(child);
  flushText();
  return blocks;
}

export function editorHasVisibleContent(blocks: TopicContentBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'text') return Boolean(block.content.trim());
    return Boolean(block.ossObjectKey);
  });
}

export function isImageWrap(node: Node | null): node is HTMLElement {
  return node instanceof HTMLElement && node.classList.contains('topic-img-wrap');
}

export function createEmptyParagraph(): HTMLParagraphElement {
  const p = document.createElement('p');
  p.appendChild(document.createElement('br'));
  return p;
}

export function ensureEditableSlots(root: HTMLElement): void {
  if (!root.firstChild) {
    root.appendChild(createEmptyParagraph());
    return;
  }
  if (isImageWrap(root.firstChild)) {
    root.insertBefore(createEmptyParagraph(), root.firstChild);
  }
  if (isImageWrap(root.lastChild)) {
    root.appendChild(createEmptyParagraph());
  }

  let node: ChildNode | null = root.firstChild;
  while (node) {
    const next = node.nextSibling;
    if (isImageWrap(node) && isImageWrap(next)) {
      root.insertBefore(createEmptyParagraph(), next);
    }
    node = node.nextSibling;
  }
}

export function createImageWrap(ossObjectKey: string, imageUrl: string): HTMLDivElement {
  const wrap = document.createElement('div');
  wrap.className = 'topic-img-wrap';
  wrap.contentEditable = 'false';
  wrap.draggable = true;
  wrap.dataset.ossKey = ossObjectKey;

  const tools = document.createElement('div');
  tools.className = 'topic-img-tools';

  const up = document.createElement('button');
  up.type = 'button';
  up.dataset.moveUp = '1';
  up.setAttribute('aria-label', 'up');
  up.textContent = '↑';

  const down = document.createElement('button');
  down.type = 'button';
  down.dataset.moveDown = '1';
  down.setAttribute('aria-label', 'down');
  down.textContent = '↓';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.removeImage = '1';
  remove.setAttribute('aria-label', 'remove');
  remove.textContent = '×';

  tools.append(up, down, remove);

  const img = document.createElement('img');
  img.dataset.ossKey = ossObjectKey;
  img.src = imageUrl;
  img.alt = '';
  img.draggable = false;

  wrap.append(tools, img);
  return wrap;
}

export function caretRangeFromPoint(x: number, y: number): Range | null {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
  };
  if (typeof doc.caretRangeFromPoint === 'function') {
    return doc.caretRangeFromPoint(x, y);
  }
  const pos = doc.caretPositionFromPoint?.(x, y);
  if (!pos) return null;
  const range = document.createRange();
  range.setStart(pos.offsetNode, pos.offset);
  range.collapse(true);
  return range;
}

export function insertNodesAtCaret(editor: HTMLElement, nodes: Node[]): void {
  editor.focus();
  const selection = window.getSelection();
  let range: Range | null = null;
  if (selection && selection.rangeCount > 0 && editor.contains(selection.anchorNode)) {
    range = selection.getRangeAt(0);
  }
  if (!range) {
    range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
  }
  range.deleteContents();
  let last: Node | null = null;
  for (const node of nodes) {
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    last = node;
  }
  if (last) {
    const after = createEmptyParagraph();
    last.parentNode?.insertBefore(after, last.nextSibling);
    range.setStart(after, 0);
    range.collapse(true);
  }
  ensureEditableSlots(editor);
  selection?.removeAllRanges();
  if (range) selection?.addRange(range);
}

export function placeCaretAtPoint(editor: HTMLElement, x: number, y: number): void {
  editor.focus();
  const found = caretRangeFromPoint(x, y);
  if (!found || !editor.contains(found.startContainer)) return;
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(found);
}

export function moveImageWrap(wrap: HTMLElement, dir: -1 | 1): boolean {
  const parent = wrap.parentElement;
  if (!parent) return false;
  const wraps = Array.from(parent.querySelectorAll<HTMLElement>(':scope > .topic-img-wrap'));
  const index = wraps.indexOf(wrap);
  const swapWith = wraps[index + dir];
  if (!swapWith) return false;
  if (dir < 0) {
    parent.insertBefore(wrap, swapWith);
  } else {
    parent.insertBefore(wrap, swapWith.nextSibling);
  }
  ensureEditableSlots(parent);
  return true;
}

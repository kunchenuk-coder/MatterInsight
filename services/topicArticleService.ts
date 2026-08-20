import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import {
  collectResolvableOssKeys,
  fetchReadUrlsForObjectKeys,
  resolveUrlFromMap,
} from './assetReadUrlService';
import type {
  TopicArticle,
  TopicArticleVersion,
  TopicContentBlock,
  TopicRpcResult,
  TopicVersionStatus,
} from '../types/topicArticle';

const TITLE_MAX = 150;
export const SUBTITLE_MAX = 50;

type VersionRow = {
  id: string;
  article_id: string;
  title: string;
  subtitle?: string | null;
  content: unknown;
  cover_image_object_key: string | null;
  status: string;
  rejection_reason: string | null;
  submitted_at: string | null;
  reviewed_at: string | null;
  reviewed_by: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
};

type ArticleRow = {
  id: string;
  supplier_id: string;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function newBlockId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function createEmptyTextBlock(content = ''): TopicContentBlock {
  return { id: newBlockId(), type: 'text', content };
}

export function parseTopicContent(raw: unknown): TopicContentBlock[] {
  if (!Array.isArray(raw)) return [];
  const blocks: TopicContentBlock[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' && row.id ? row.id : newBlockId();
    if (row.type === 'image') {
      const ossObjectKey = String(row.ossObjectKey ?? row.oss_object_key ?? '').trim();
      if (!ossObjectKey) continue;
      blocks.push({
        id,
        type: 'image',
        ossObjectKey,
        caption: typeof row.caption === 'string' ? row.caption : undefined,
      });
      continue;
    }
    if (row.type === 'text' || typeof row.content === 'string') {
      blocks.push({
        id,
        type: 'text',
        content: typeof row.content === 'string' ? row.content : '',
      });
    }
  }
  return blocks;
}

export function persistableTopicContent(blocks: TopicContentBlock[]): TopicContentBlock[] {
  return blocks.map((block) => {
    if (block.type === 'image') {
      return {
        id: block.id,
        type: 'image',
        ossObjectKey: block.ossObjectKey,
        ...(block.caption?.trim() ? { caption: block.caption.trim() } : {}),
      };
    }
    return { id: block.id, type: 'text', content: block.content };
  });
}

export function firstCoverObjectKey(blocks: TopicContentBlock[]): string | null {
  const image = blocks.find((b): b is Extract<TopicContentBlock, { type: 'image' }> => b.type === 'image');
  return image?.ossObjectKey ?? null;
}

export function topicContentIsPublishable(blocks: TopicContentBlock[]): boolean {
  return blocks.some((block) => {
    if (block.type === 'text') return block.content.trim().length > 0;
    return Boolean(block.ossObjectKey.trim());
  });
}

export function mapVersionRow(row: VersionRow, versionNumber?: number): TopicArticleVersion {
  return {
    id: row.id,
    articleId: row.article_id,
    title: row.title ?? '',
    subtitle: row.subtitle ?? '',
    content: parseTopicContent(row.content),
    coverImageObjectKey: row.cover_image_object_key,
    status: row.status as TopicVersionStatus,
    rejectionReason: row.rejection_reason,
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    versionNumber,
  };
}

function assignVersionNumbers(rows: VersionRow[]): TopicArticleVersion[] {
  const sorted = [...rows].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  );
  return sorted.map((row, index) => mapVersionRow(row, index + 1));
}

export async function enrichTopicBlocksWithReadUrls(
  blocks: TopicContentBlock[]
): Promise<TopicContentBlock[]> {
  const keys = collectResolvableOssKeys(
    [],
    blocks.filter((b) => b.type === 'image').map((b) => b.ossObjectKey)
  );
  if (keys.length === 0) return blocks;
  const urlMap = await fetchReadUrlsForObjectKeys(keys);
  return blocks.map((block) => {
    if (block.type !== 'image') return block;
    return {
      ...block,
      imageUrl: resolveUrlFromMap(block.imageUrl, block.ossObjectKey, urlMap),
    };
  });
}

export async function enrichVersionImages(
  version: TopicArticleVersion
): Promise<TopicArticleVersion> {
  return { ...version, content: await enrichTopicBlocksWithReadUrls(version.content) };
}

function rpcErrorMessage(error: { message?: string } | null, fallback: string): string {
  return error?.message || fallback;
}

export async function createTopicArticle(supplierId: string): Promise<
  { ok: true; articleId: string; versionId: string } | { ok: false; error: string }
> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 未配置' };
  const sb = getSupabase();

  const { data: article, error: articleError } = await sb
    .from('topic_articles')
    .insert({ supplier_id: supplierId })
    .select('id')
    .single();
  if (articleError || !article?.id) {
    return { ok: false, error: rpcErrorMessage(articleError, '创建专题失败') };
  }

  const { data: version, error: versionError } = await sb
    .from('topic_article_versions')
    .insert({
      article_id: article.id,
      title: '',
      content: [createEmptyTextBlock()],
      status: 'draft',
    })
    .select('id')
    .single();
  if (versionError || !version?.id) {
    return { ok: false, error: rpcErrorMessage(versionError, '创建草稿失败') };
  }
  return { ok: true, articleId: String(article.id), versionId: String(version.id) };
}

export async function fetchSupplierTopicArticles(supplierId: string): Promise<TopicArticle[]> {
  if (!isSupabaseConfigured() || !supplierId) return [];
  const sb = getSupabase();
  const { data: articles, error } = await sb
    .from('topic_articles')
    .select('id, supplier_id, is_archived, created_at, updated_at')
    .eq('supplier_id', supplierId)
    .order('updated_at', { ascending: false });
  if (error || !articles) {
    console.error('[topicArticleService] fetchSupplierTopicArticles:', error?.message);
    return [];
  }

  const ids = (articles as ArticleRow[]).map((a) => a.id);
  if (ids.length === 0) return [];

  const { data: versions, error: vError } = await sb
    .from('topic_article_versions')
    .select('*')
    .in('article_id', ids)
    .order('created_at', { ascending: true });
  if (vError) {
    console.error('[topicArticleService] versions:', vError.message);
  }

  const byArticle = new Map<string, VersionRow[]>();
  for (const row of (versions ?? []) as VersionRow[]) {
    const list = byArticle.get(row.article_id) ?? [];
    list.push(row);
    byArticle.set(row.article_id, list);
  }

  return (articles as ArticleRow[]).map((article) => {
    const mapped = assignVersionNumbers(byArticle.get(article.id) ?? []);
    const publishedVersion = mapped.find((v) => v.status === 'published') ?? null;
    const workingVersion =
      mapped.find((v) => v.status === 'pending_review') ??
      mapped.find((v) => v.status === 'draft') ??
      [...mapped].reverse().find((v) => v.status === 'rejected') ??
      null;
    return {
      id: article.id,
      supplierId: article.supplier_id,
      isArchived: article.is_archived,
      createdAt: article.created_at,
      updatedAt: article.updated_at,
      publishedVersion,
      workingVersion,
      versions: mapped,
    };
  });
}

export async function fetchTopicArticleForSupplier(
  articleId: string
): Promise<TopicArticle | null> {
  if (!isSupabaseConfigured()) return null;
  const sb = getSupabase();
  const { data: article, error } = await sb
    .from('topic_articles')
    .select('id, supplier_id, is_archived, created_at, updated_at')
    .eq('id', articleId)
    .maybeSingle();
  if (error || !article) return null;

  const { data: versions } = await sb
    .from('topic_article_versions')
    .select('*')
    .eq('article_id', articleId)
    .order('created_at', { ascending: true });

  const mapped = assignVersionNumbers((versions ?? []) as VersionRow[]);
  const publishedVersion = mapped.find((v) => v.status === 'published') ?? null;
  const workingVersion =
    mapped.find((v) => v.status === 'pending_review') ??
    mapped.find((v) => v.status === 'draft') ??
    [...mapped].reverse().find((v) => v.status === 'rejected') ??
    null;

  return {
    id: article.id,
    supplierId: article.supplier_id,
    isArchived: article.is_archived,
    createdAt: article.created_at,
    updatedAt: article.updated_at,
    publishedVersion,
    workingVersion,
    versions: mapped,
  };
}

export async function ensureWorkingDraft(
  articleId: string
): Promise<{ ok: true; version: TopicArticleVersion } | { ok: false; error: string; code?: string }> {
  const article = await fetchTopicArticleForSupplier(articleId);
  if (!article) return { ok: false, error: '专题不存在' };
  if (article.isArchived) return { ok: false, error: '已下架专题不能编辑' };

  const pending = article.versions?.find((v) => v.status === 'pending_review');
  if (pending) {
    return { ok: false, error: '正在审核中，请先撤回后再修改', code: 'PENDING' };
  }

  const draft = article.versions?.find((v) => v.status === 'draft');
  if (draft) {
    const enriched = await enrichVersionImages(draft);
    return { ok: true, version: enriched };
  }

  const source =
    [...(article.versions ?? [])].reverse().find((v) => v.status === 'rejected') ??
    article.publishedVersion;
  if (!source) return { ok: false, error: '没有可编辑的版本' };

  const sb = getSupabase();
  const { data, error } = await sb
    .from('topic_article_versions')
    .insert({
      article_id: articleId,
      title: source.title,
      subtitle: source.subtitle ?? '',
      content: persistableTopicContent(source.content),
      cover_image_object_key: firstCoverObjectKey(source.content) ?? source.coverImageObjectKey,
      status: 'draft',
    })
    .select('*')
    .single();
  if (error || !data) {
    return { ok: false, error: rpcErrorMessage(error, '创建新版本失败') };
  }
  const created = mapVersionRow(data as VersionRow);
  return { ok: true, version: await enrichVersionImages(created) };
}

export function clipTopicChars(value: string, max: number): string {
  return Array.from(value).slice(0, max).join('');
}

export async function saveTopicVersionDraft(
  versionId: string,
  input: { title: string; subtitle: string; content: TopicContentBlock[] }
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 未配置' };
  const title = clipTopicChars(input.title.trim(), TITLE_MAX);
  const subtitle = clipTopicChars(input.subtitle.trim(), SUBTITLE_MAX);
  const content = persistableTopicContent(input.content);
  const { error } = await getSupabase()
    .from('topic_article_versions')
    .update({
      title,
      subtitle,
      content,
      cover_image_object_key: firstCoverObjectKey(content),
      updated_at: new Date().toISOString(),
    })
    .eq('id', versionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

async function callTopicRpc(
  fn: string,
  args: Record<string, unknown>
): Promise<TopicRpcResult> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 未配置' };
  const { data, error } = await getSupabase().rpc(fn, args);
  if (error) return { ok: false, error: error.message };
  const payload = (data ?? {}) as TopicRpcResult;
  return { ok: payload.ok !== false, ...payload };
}

export async function submitTopicVersion(versionId: string): Promise<TopicRpcResult> {
  return callTopicRpc('submit_topic_article_version', { p_version_id: versionId });
}

export async function withdrawTopicVersion(versionId: string): Promise<TopicRpcResult> {
  return callTopicRpc('withdraw_topic_article_version', { p_version_id: versionId });
}

export async function archiveTopicArticle(articleId: string): Promise<TopicRpcResult> {
  return callTopicRpc('archive_topic_article', { p_article_id: articleId });
}

export async function deleteTopicVersion(versionId: string): Promise<{ ok: boolean; error?: string }> {
  if (!isSupabaseConfigured()) return { ok: false, error: 'Supabase 未配置' };
  const { error } = await getSupabase().from('topic_article_versions').delete().eq('id', versionId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

export async function fetchPublishedTopics(): Promise<TopicArticle[]> {
  if (!isSupabaseConfigured()) return [];
  const sb = getSupabase();
  const { data, error } = await sb
    .from('topic_article_versions')
    .select(
      `
      *,
      topic_articles:article_id (
        id,
        supplier_id,
        is_archived,
        created_at,
        updated_at
      )
    `
    )
    .eq('status', 'published')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[topicArticleService] fetchPublishedTopics:', error.message);
    return [];
  }

  const out: TopicArticle[] = [];
  for (const raw of data ?? []) {
    const row = raw as VersionRow & { topic_articles?: ArticleRow | ArticleRow[] | null };
    const article = embedOne(row.topic_articles);
    if (!article || article.is_archived) continue;
    const version = mapVersionRow(row);
    const enriched = await enrichVersionImages(version);
    out.push({
      id: article.id,
      supplierId: article.supplier_id,
      isArchived: article.is_archived,
      createdAt: article.created_at,
      updatedAt: article.updated_at,
      publishedVersion: enriched,
    });
  }
  return out;
}

export async function fetchPublishedTopicById(articleId: string): Promise<TopicArticle | null> {
  if (!isSupabaseConfigured() || !articleId) return null;
  const sb = getSupabase();
  const { data, error } = await sb
    .from('topic_article_versions')
    .select(
      `
      *,
      topic_articles:article_id (
        id,
        supplier_id,
        is_archived,
        created_at,
        updated_at
      )
    `
    )
    .eq('status', 'published')
    .eq('article_id', articleId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.error('[topicArticleService] fetchPublishedTopicById:', error.message);
    return null;
  }
  const row = data as VersionRow & { topic_articles?: ArticleRow | ArticleRow[] | null };
  const article = embedOne(row.topic_articles);
  if (!article || article.is_archived) return null;
  const version = await enrichVersionImages(mapVersionRow(row));
  return {
    id: article.id,
    supplierId: article.supplier_id,
    isArchived: article.is_archived,
    createdAt: article.created_at,
    updatedAt: article.updated_at,
    publishedVersion: version,
  };
}

export { getSupabaseForPortal };

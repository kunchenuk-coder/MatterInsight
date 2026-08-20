import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import {
  enrichVersionImages,
  mapVersionRow,
  parseTopicContent,
} from './topicArticleService';
import type { TopicArticle, TopicArticleVersion, TopicRpcResult } from '../types/topicArticle';

type AdminVersionRow = {
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
  topic_articles?: {
    id: string;
    supplier_id: string;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
    profiles?:
      | { company?: string | null; email?: string | null; username?: string | null }
      | Array<{ company?: string | null; email?: string | null; username?: string | null }>
      | null;
  } | Array<{
    id: string;
    supplier_id: string;
    is_archived: boolean;
    created_at: string;
    updated_at: string;
    profiles?:
      | { company?: string | null; email?: string | null; username?: string | null }
      | Array<{ company?: string | null; email?: string | null; username?: string | null }>
      | null;
  }> | null;
};

const VERSION_SELECT = `
  id,
  article_id,
  title,
  subtitle,
  content,
  cover_image_object_key,
  status,
  rejection_reason,
  submitted_at,
  reviewed_at,
  reviewed_by,
  published_at,
  created_at,
  updated_at,
  topic_articles:article_id (
    id,
    supplier_id,
    is_archived,
    created_at,
    updated_at,
    profiles:supplier_id ( company, email, username )
  )
`;

function adminClient() {
  return getSupabaseForPortal('admin');
}

function embedOne<T>(value: T | T[] | null | undefined): T | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toAdminArticle(row: AdminVersionRow, versionNumber?: number): TopicArticle {
  const article = embedOne(row.topic_articles);
  const version = mapVersionRow(
    {
      id: row.id,
      article_id: row.article_id,
      title: row.title,
      subtitle: row.subtitle,
      content: row.content,
      cover_image_object_key: row.cover_image_object_key,
      status: row.status,
      rejection_reason: row.rejection_reason,
      submitted_at: row.submitted_at,
      reviewed_at: row.reviewed_at,
      reviewed_by: row.reviewed_by,
      published_at: row.published_at,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    versionNumber
  );
  const profile = embedOne(article?.profiles);
  return {
    id: article?.id ?? row.article_id,
    supplierId: article?.supplier_id ?? '',
    isArchived: article?.is_archived ?? false,
    createdAt: article?.created_at ?? row.created_at,
    updatedAt: article?.updated_at ?? row.updated_at,
    supplierName: profile?.company || profile?.username || null,
    supplierEmail: profile?.email ?? null,
    workingVersion: version.status === 'pending_review' || version.status === 'rejected' || version.status === 'draft'
      ? version
      : null,
    publishedVersion: version.status === 'published' ? version : null,
    versions: [version],
  };
}

export async function fetchPendingTopicReviews(): Promise<TopicArticle[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await adminClient()
    .from('topic_article_versions')
    .select(VERSION_SELECT)
    .eq('status', 'pending_review')
    .order('submitted_at', { ascending: true });
  if (error) {
    console.error('[topicArticleAdminService] fetchPending:', error.message);
    return [];
  }
  const rows = (data ?? []) as unknown as AdminVersionRow[];
  const articles: TopicArticle[] = [];
  for (const row of rows) {
    const item = toAdminArticle(row);
    if (item.isArchived) continue;
    if (item.workingVersion) {
      item.workingVersion = await enrichVersionImages(item.workingVersion);
    }
    articles.push(item);
  }
  return articles;
}

export async function fetchTopicReviewHistory(): Promise<TopicArticle[]> {
  if (!isSupabaseConfigured()) return [];
  const { data, error } = await adminClient()
    .from('topic_article_versions')
    .select(VERSION_SELECT)
    .in('status', ['published', 'rejected', 'superseded'])
    .order('updated_at', { ascending: false })
    .limit(80);
  if (error) {
    console.error('[topicArticleAdminService] history:', error.message);
    return [];
  }
  return ((data ?? []) as unknown as AdminVersionRow[]).map((row) => toAdminArticle(row));
}

export async function fetchAdminTopicVersion(versionId: string): Promise<TopicArticleVersion | null> {
  if (!isSupabaseConfigured()) return null;
  const { data, error } = await adminClient()
    .from('topic_article_versions')
    .select('*')
    .eq('id', versionId)
    .maybeSingle();
  if (error || !data) return null;
  const mapped = mapVersionRow(data as AdminVersionRow);
  mapped.content = parseTopicContent(data.content);
  return enrichVersionImages(mapped);
}

export async function approveTopicVersion(versionId: string): Promise<TopicRpcResult> {
  const { data, error } = await adminClient().rpc('approve_topic_article_version', {
    p_version_id: versionId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as TopicRpcResult) };
}

export async function rejectTopicVersion(versionId: string, reason: string): Promise<TopicRpcResult> {
  const { data, error } = await adminClient().rpc('reject_topic_article_version', {
    p_version_id: versionId,
    p_reason: reason,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as TopicRpcResult) };
}

export async function adminArchiveTopic(articleId: string): Promise<TopicRpcResult> {
  const { data, error } = await adminClient().rpc('archive_topic_article', {
    p_article_id: articleId,
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, ...(data as TopicRpcResult) };
}

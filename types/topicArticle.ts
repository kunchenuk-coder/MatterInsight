export type TopicVersionStatus =
  | 'draft'
  | 'pending_review'
  | 'rejected'
  | 'published'
  | 'superseded';

export type TopicTextBlock = {
  id: string;
  type: 'text';
  content: string;
};

export type TopicImageBlock = {
  id: string;
  type: 'image';
  ossObjectKey: string;
  caption?: string;
  /** Ephemeral display URL; never persist as source of truth. */
  imageUrl?: string;
};

export type TopicContentBlock = TopicTextBlock | TopicImageBlock;

export type TopicArticleVersion = {
  id: string;
  articleId: string;
  title: string;
  subtitle: string;
  content: TopicContentBlock[];
  coverImageObjectKey: string | null;
  status: TopicVersionStatus;
  rejectionReason: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  versionNumber?: number;
};

export type TopicArticle = {
  id: string;
  supplierId: string;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
  supplierName?: string | null;
  supplierEmail?: string | null;
  publishedVersion?: TopicArticleVersion | null;
  workingVersion?: TopicArticleVersion | null;
  versions?: TopicArticleVersion[];
};

export type TopicRpcResult = {
  ok: boolean;
  version_id?: string;
  article_id?: string;
  status?: string;
  is_archived?: boolean;
  error?: string;
};

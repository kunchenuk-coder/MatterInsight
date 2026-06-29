
export type UserRole = 'DESIGNER' | 'SUPPLIER' | 'ADMIN';

/** profiles.role 小写值，与 Supabase 一致，用于路由跳转 */
export type DbRole = 'designer' | 'supplier' | 'admin';

export interface PointTransaction {
  id: string;
  amount: number;
  date: string;
  description: string;
}

export interface User {
  id: string;
  email: string;
  role: UserRole;
  /** 数据库 profiles.role（designer / supplier / admin），登录跳转以此为准 */
  dbRole: DbRole;
  points: number;
  name: string;
  company?: string;
  transactions?: PointTransaction[];
  comments?: DesignerComment[];
  isVerified: boolean;
  /** 材料商账号审核状态（仅 SUPPLIER 有效） */
  accountStatus?: 'pending' | 'approved' | 'rejected';
  registeredPhone?: string;
  verificationDoc?: string;
  /** 我的收藏（材料 ID），与本地 saved_ids 同步 */
  collections?: string[];
  /** profiles.avatar，设计师自定义头像 URL */
  avatar?: string | null;
}

export interface DesignerComment {
  id: string;
  materialId: string;
  content: string;
  date: string;
  isMuted: boolean;
}

export enum Category {
  ST = 'ST石材',
  CT = 'CT瓷砖',
  CO = 'CO水泥',
  SF = 'SF饰面',
  WD = 'WD木材',
  GL = 'GL玻璃',
  MT = 'MT金属',
  PVC = 'PVC塑料',
  FB = 'FB面料',
  CP = 'CP地毯',
  L = 'L灯光',
  Other = '其他'
}

export enum MaterialStatus {
  PENDING = '待审核',
  PUBLISHED = '已发布',
  REJECTED = '已拒绝'
}

export interface AuditLog {
  date: string;
  action: 'SUBMIT' | 'APPROVE' | 'REJECT';
  comment: string;
  operatorId: string;
}

export interface MaterialVariant {
  id: string;
  colorCode: string;
  imageUrl: string;
  name: string;
}

export interface Material {
  id: string;
  name: string;
  description?: string;
  category: Category;
  brand: string;
  specifications: string;
  priceRange: string;
  stock: boolean;
  leadTime: string;
  fireRating: string;
  image: string; // Default image
  variants: MaterialVariant[];
  projectPhotos: string[];
  supplierId: string;
  supplierNotes?: string;
  status: MaterialStatus;
  auditLog: AuditLog[];
  ratings: {
    aesthetic: number;
    durable: number;
    service: number;
    cleanliness: number;
    recommendation: number;
  };
  pointsNeeded: {
    sample: number;
    board: number;
    export: number;
  };
  // Analytics
  clicks: number;
  saves: number;
  savedBy: string[]; // List of user IDs
  isAcknowledged?: boolean; // For supplier notification badge
  /** OSS 对象键；展示时用于刷新过期预签名 URL */
  ossObjectKey?: string;
  /** 设计师本地上传、非官方系统库材料 */
  isCustom?: boolean;
}

// Added PendingMaterial interface for supplier submission workflow
export interface PendingMaterial {
  id: string;
  name: string;
  description?: string;
  category: Category;
  brand: string;
  specifications: string;
  priceRange: string;
  stock: boolean;
  leadTime: string;
  fireRating: string;
  image: string;
  variants: MaterialVariant[];
  projectPhotos: string[];
  supplierId: string;
  supplierNotes?: string;
  submitterId: string;
  submitDate: string;
  status: MaterialStatus;
  auditLog: AuditLog[];
  isAcknowledged?: boolean; // For supplier notification badge
  /** OSS 对象键；展示时用于刷新过期预签名 URL */
  ossObjectKey?: string;
}

export interface Notification {
  id: string;
  userId: string;
  title: string;
  content: string;
  date: string;
  isRead: boolean;
  type: 'SYSTEM' | 'AUDIT' | 'INQUIRY';
}

/**
 * 设计师私有「本地临时材料」（仅存 localStorage，不入探索库 / ST·MT 分类）
 * 右键上传与左侧「本地材料」列表、拖入画布共用此结构。
 */
export interface LocalTemporaryMaterial {
  id: string;
  designerId: string;
  name: string;
  spec: string;
  imageUrl: string;
  createdAt: number;
  isLocalStorageMaterial: true;
  isEditedByUser: true;
  /** OSS 对象键 users/{userId}/assets/... */
  ossObjectKey?: string;
  /** 可选稳定资源 URL（无 ossObjectKey / assetUrl 时仍用 imageUrl / image_url） */
  assetUrl?: string;
  /** AI/人工审核状态，默认 pending_review */
  reviewStatus?: AssetReviewStatus;
  /** 预留：VR 场景 3D 模型路径 */
  model3dUrl?: string;
  /** 设计师本地上传，非官方系统库 */
  isCustom?: boolean;
}

/** @deprecated 使用 LocalTemporaryMaterial */
export type LocalDesignerMaterial = LocalTemporaryMaterial;

export interface MoodBoardItem {
  id: string;
  materialId?: string;
  /** 关联左侧「本地材料」目录条目 */
  localMaterialId?: string;
  imageUrl?: string;
  type?: 'material' | 'drawing' | 'marker' | 'sample';
  parentId?: string;
  targetId?: string; // For lines: marker -> sample
  x: number;
  y: number;
  relX?: number; // Relative X percentage (0-100) inside parent
  relY?: number; // Relative Y percentage (0-100) inside parent
  width: number;
  height: number;
  zIndex: number;
  remark?: string;
  /** 情绪板内展示名（用户编辑后与全局库解耦） */
  displayName?: string;
  /** 情绪板内规格文案（用户编辑后与全局库解耦） */
  displaySpec?: string;
  /** 锁定展示图：本地临时材料或用户编辑后快照 */
  snapshotImageUrl?: string;
  /** 用户已改过名称或规格，不再随材料库自动更新 */
  isEditedByUser?: boolean;
  /** 关联材料库时的内容指纹，用于「库内已更新」红点 */
  libraryRevisionHash?: string;
  /** 仅存在于当前情绪板的本地图片（右键上传），不入全局收藏库 */
  isLocalOnly?: boolean;
  /** 与 isLocalOnly 同义；右键「上传本地材料」写入为 true */
  isLocalStorageMaterial?: boolean;
  /** 用户已确认「改规格后与库断开」提示（每卡一次） */
  specEditWarningAcked?: boolean;
}

export interface MoodBoard {
  id: string;
  name: string;
  items: MoodBoardItem[];
  isPaid: boolean; // Free tier vs Paid tier
  maxMaterials: number;
  /** @default 'private' — omitted on legacy local boards */
  visibility?: MoodBoardVisibility;
  /** visibility=public 仅表示允许发布；首页展示需 isPublished=true */
  isPublished?: boolean;
  publishedAt?: string;
  /** 主效果图 URL（导出/成品图） */
  mainRenderImage?: string;
  /** 空间效果图 URL */
  spaceImage?: string;
  /** Populated on public listings only */
  ownerId?: string;
  /** Populated on public listings only */
  ownerName?: string;
  /** Populated on public listings only */
  ownerAvatar?: string | null;
}

export type MoodBoardVisibility = 'private' | 'team' | 'public';

export type InquiryStatus = 'PENDING' | 'QUOTED' | 'REJECTED' | 'COMPLETED';

export interface Inquiry {
  id: string;
  materialId: string;
  designerId: string;
  supplierId: string;
  moodBoardId: string;
  status: InquiryStatus;
  submitDate: string;
  quotePrice?: string;
  totalPrice?: string;
  notes?: string;
  designerNotes?: string;
  history?: { price: string; date: string; notes: string }[]; // Added quote history
  /** 设计师已读报价时间；未设置且 status=QUOTED 时计入未读 */
  quoteReadAt?: string;
}

export interface SampleRequest {
  id: string;
  materialId: string;
  designerId: string;
  supplierId: string;
  address: string;
  contactName: string;
  phone: string;
  status: 'PENDING' | 'SHIPPED_BY_SUPPLIER' | 'SHIPPED_BY_ADMIN' | 'COMPLETED';
  submitDate: string;
  shipDate?: string;
}

/** 上传目录分类（OSS 路径 users/{id}/assets/{category}/...） */
export type UploadFolder =
  | 'materials'
  | 'variants'
  | 'project-photos'
  | 'verification'
  | 'local-materials'
  | 'avatars';

/** 资产 AI 审核状态 */
export type AssetReviewStatus = 'pending_review' | 'approved' | 'rejected';

/** 资产类型：图片 / 3D 模型 */
export type AssetType = 'image' | 'model_3d';
export interface UserAsset {
  id: string;
  userId: string;
  assetType: AssetType;
  ossObjectKey: string;
  contentType?: string;
  fileName?: string;
  category?: string;
  reviewStatus: AssetReviewStatus;
  model3dUrl?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

/** 设计师公开主页 */
export interface DesignerSocialStats {
  /** 关注我的用户数 */
  followersCount: number;
  /** 我关注的用户数 */
  followingCount: number;
  /** 他人收藏该设计师公开情绪板的总次数 */
  moodboardFavoritesCount: number;
}

export interface DesignerProfile {
  id: string;
  avatar: string | null;
  username: string;
  company: string | null;
  bio: string | null;
  stats: DesignerSocialStats;
  publicMoodboards: DesignerMoodboardSummary[];
  /** 完整情绪板数据（用于详情跳转） */
  boards: MoodBoard[];
  projectThumbnails: string[];
}

export interface DesignerMoodboardSummary {
  id: string;
  name: string;
  coverImage: string | null;
  materialCount: number;
  publishedAt?: string;
}

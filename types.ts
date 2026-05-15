
export type UserRole = 'DESIGNER' | 'SUPPLIER' | 'ADMIN';

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
  points: number;
  name: string;
  company?: string;
  transactions?: PointTransaction[];
  comments?: DesignerComment[];
  isVerified: boolean;
  registeredPhone?: string;
  verificationDoc?: string;
  /** 我的收藏（材料 ID），与本地 saved_ids 同步 */
  collections?: string[];
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

export interface MoodBoardItem {
  id: string;
  materialId?: string;
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
}

export interface MoodBoard {
  id: string;
  name: string;
  items: MoodBoardItem[];
  isPaid: boolean; // Free tier vs Paid tier
  maxMaterials: number;
}

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

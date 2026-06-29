import type { Inquiry, User } from '../types';

/** 材料商不参与探索库询价/小样流程（冷启动期仅负责上架材料） */
export function isSupplierUser(
  user: Pick<User, 'role' | 'dbRole'> | null | undefined
): boolean {
  if (!user) return false;
  return user.role === 'SUPPLIER' || user.dbRole === 'supplier';
}

/** 仅设计师可发起询价或小样申请；材料商会话会被拒绝 */
export function assertDesignerCanRequestQuoteOrSample(
  user: Pick<User, 'role' | 'dbRole'> | null | undefined
): user is User {
  if (!user || isSupplierUser(user)) return false;
  return user.role === 'DESIGNER' && user.dbRole === 'designer';
}

export type DesignerRequestRejectionReason = 'unauthenticated' | 'supplier' | 'wrong_role';

export function getDesignerRequestRejectionReason(
  user: Pick<User, 'role' | 'dbRole'> | null | undefined
): DesignerRequestRejectionReason | null {
  if (!user) return 'unauthenticated';
  if (isSupplierUser(user)) return 'supplier';
  if (user.role !== 'DESIGNER' || user.dbRole !== 'designer') return 'wrong_role';
  return null;
}

/** 设计师未读报价数（已 QUOTED 且未读） */
export function countUnreadDesignerQuotes(
  userId: string,
  inquiries: Inquiry[]
): number {
  return inquiries.filter(
    (inq) =>
      inq.designerId === userId &&
      inq.status === 'QUOTED' &&
      !inq.quoteReadAt
  ).length;
}

/** 将当前设计师的全部已报价询价标记为已读 */
export function markDesignerQuotesAsRead(
  userId: string,
  inquiries: Inquiry[]
): Inquiry[] {
  const now = new Date().toISOString();
  return inquiries.map((inq) =>
    inq.designerId === userId && inq.status === 'QUOTED' && !inq.quoteReadAt
      ? { ...inq, quoteReadAt: now }
      : inq
  );
}

/** 查找设计师在某情绪板下对某材料的询价（仅返回该设计师自己的记录） */
export function findDesignerMoodboardInquiry(
  inquiries: Inquiry[],
  designerId: string,
  materialId: string,
  moodBoardId: string
): Inquiry | undefined {
  return inquiries.find(
    (inq) =>
      inq.designerId === designerId &&
      inq.materialId === materialId &&
      inq.moodBoardId === moodBoardId
  );
}

/** 供应商报价格式化，如 ¥200/㎡ */
export function formatSupplierQuotePrice(quotePrice?: string | null): string | null {
  if (!quotePrice?.trim()) return null;
  const raw = quotePrice.trim().replace(/^¥\s*/, '');
  if (raw.includes('/')) return raw.startsWith('¥') ? raw : `¥${raw}`;
  return `¥${raw}/㎡`;
}

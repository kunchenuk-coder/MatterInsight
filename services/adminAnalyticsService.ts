import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';

export type AdminSupplierEvaluation = {
  id: string;
  name: string;
  email: string;
  phone: string;
  verificationDocUrl: string;
  publishedCount: number;
  hasCatalogPdf: boolean;
  likeCount: number;
  viewCount: number;
  ratingAverage: number | null;
  ratingMaterialCount: number;
  pointsConsumed: number;
  gmvCny: number;
  risk: 'Low' | 'Suspicious';
  riskReason: string;
};

/** 报价备注里是否出现手机号 / 微信号（与报价金额无关的私联信息） */
export function quoteNoteHasPrivateContact(note: string): boolean {
  const text = note.trim();
  if (!text) return false;
  const digits = text.replace(/\D/g, '');
  if (/1[3-9]\d{9}/.test(digits)) return true;
  if (/(微信|微信号|wechat|weixin|wxid)/i.test(text)) return true;
  if (/(^|[^a-z0-9])(wx|vx)[:：\s]/i.test(text)) return true;
  return false;
}

/** Admin「供应商评估」：RPC 积分/流水 + profiles 资料 + 询价备注风控 */
export async function fetchSupplierEvaluations(): Promise<AdminSupplierEvaluation[]> {
  if (!isSupabaseConfigured()) return [];

  const client = getSupabaseForPortal('admin');
  const [rpcRes, profileRes, inquiryRes] = await Promise.all([
    client.rpc('admin_supplier_evaluations'),
    client
      .from('profiles')
      .select('id, email, company, username, registered_phone, verification_doc_url')
      .eq('role', 'supplier'),
    client
      .from('inquiries')
      .select('supplier_id, supplier_quote_note, quoted_at')
      .not('supplier_quote_note', 'is', null),
  ]);

  if (rpcRes.error) {
    console.error('[adminAnalyticsService] fetchSupplierEvaluations:', rpcRes.error.message);
  }
  if (profileRes.error) {
    console.error('[adminAnalyticsService] supplier profiles:', profileRes.error.message);
  }
  if (inquiryRes.error) {
    console.error('[adminAnalyticsService] supplier inquiries:', inquiryRes.error.message);
  }

  const riskBySupplier = new Map<string, string[]>();
  for (const row of inquiryRes.data ?? []) {
    const sid = String((row as { supplier_id?: string }).supplier_id ?? '');
    const note = String((row as { supplier_quote_note?: string | null }).supplier_quote_note ?? '');
    if (!sid || !quoteNoteHasPrivateContact(note)) continue;
    const list = riskBySupplier.get(sid) ?? [];
    list.push(note.trim().slice(0, 180));
    riskBySupplier.set(sid, list);
  }

  const profileById = new Map(
    (profileRes.data ?? []).map((row) => [String((row as { id?: string }).id ?? ''), row as Record<string, unknown>])
  );

  const rpcRows = (rpcRes.data ?? []) as Record<string, unknown>[];
  const ids = new Set<string>();
  const merged: AdminSupplierEvaluation[] = [];

  const toRow = (
    id: string,
    rpc: Record<string, unknown> | undefined,
    profile: Record<string, unknown> | undefined
  ): AdminSupplierEvaluation => {
    const reasons = riskBySupplier.get(id) ?? [];
    const name =
      String(rpc?.supplier_name ?? '') ||
      String(profile?.company ?? '') ||
      String(profile?.username ?? '') ||
      String(profile?.email ?? '').split('@')[0] ||
      '（未命名材料商）';
    return {
      id,
      name,
      email: String(rpc?.supplier_email ?? profile?.email ?? ''),
      phone: String(profile?.registered_phone ?? rpc?.registered_phone ?? '').trim(),
      verificationDocUrl: String(
        profile?.verification_doc_url ?? rpc?.verification_doc_url ?? ''
      ).trim(),
      publishedCount: Number(rpc?.published_count ?? 0),
      hasCatalogPdf: false,
      likeCount: 0,
      viewCount: 0,
      ratingAverage: null,
      ratingMaterialCount: 0,
      pointsConsumed: Number(rpc?.points_consumed ?? 0),
      gmvCny: Number(rpc?.gmv_cny ?? 0),
      risk: reasons.length > 0 ? 'Suspicious' : 'Low',
      riskReason: reasons.join(' | '),
    };
  };

  for (const rpc of rpcRows) {
    const id = String(rpc.supplier_id ?? '');
    if (!id) continue;
    ids.add(id);
    merged.push(toRow(id, rpc, profileById.get(id)));
  }

  for (const [id, profile] of profileById) {
    if (ids.has(id)) continue;
    merged.push(toRow(id, undefined, profile));
  }

  return merged;
}

/** 消费积分并（可选）记一笔供应商订单；portal 需与当前登录端一致 */
export async function recordPointsConsume(options: {
  amount: number;
  description?: string;
  supplierId?: string | null;
  materialId?: string | null;
  orderType?: 'sample' | 'quote' | 'purchase' | 'recharge' | 'other' | null;
  amountCny?: number;
  portal?: AppPortal;
}): Promise<{ ok: true; balanceAfter: number } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const { data, error } = await getSupabaseForPortal(options.portal ?? 'designer').rpc(
    'record_points_consume',
    {
      p_amount: options.amount,
      p_description: options.description ?? null,
      p_related_supplier_id: options.supplierId ?? null,
      p_related_material_id: options.materialId ?? null,
      p_order_type: options.orderType ?? null,
      p_amount_cny: options.amountCny ?? 0,
    }
  );

  if (error) {
    console.error('[adminAnalyticsService] recordPointsConsume:', error.message);
    return { ok: false, error: error.message };
  }

  const payload = data as { balance_after?: number } | null;
  const balanceAfter = Number(payload?.balance_after);
  if (!Number.isFinite(balanceAfter)) {
    return { ok: false, error: 'invalid balance_after' };
  }
  return { ok: true, balanceAfter };
}

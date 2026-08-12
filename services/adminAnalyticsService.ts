import { getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';

export type AdminSupplierEvaluation = {
  id: string;
  name: string;
  email: string;
  publishedCount: number;
  pointsConsumed: number;
  gmvCny: number;
  risk: 'Low' | 'Suspicious';
};

/** Admin「供应商评估」：一次 RPC 拉上架数 / 积分消费 / GMV */
export async function fetchSupplierEvaluations(): Promise<AdminSupplierEvaluation[]> {
  if (!isSupabaseConfigured()) return [];

  const { data, error } = await getSupabaseForPortal('admin').rpc(
    'admin_supplier_evaluations'
  );

  if (error) {
    console.error('[adminAnalyticsService] fetchSupplierEvaluations:', error.message);
    return [];
  }

  return (data ?? []).map((row: Record<string, unknown>) => ({
    id: String(row.supplier_id ?? ''),
    name: String(row.supplier_name ?? '（未命名材料商）'),
    email: String(row.supplier_email ?? ''),
    publishedCount: Number(row.published_count ?? 0),
    pointsConsumed: Number(row.points_consumed ?? 0),
    gmvCny: Number(row.gmv_cny ?? 0),
    risk: String(row.risk_level ?? 'Low') === 'Suspicious' ? 'Suspicious' : 'Low',
  }));
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

  const balanceAfter = Number(
    (data as { balance_after?: number } | null)?.balance_after ?? 0
  );
  return { ok: true, balanceAfter };
}

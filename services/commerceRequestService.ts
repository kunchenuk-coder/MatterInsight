import type { Inquiry, SampleRequest } from '../types';
import { getSupabase, getSupabaseForPortal, isSupabaseConfigured } from './supabaseClient';
import type { AppPortal } from '../utils/appPortal';
import { createNotification } from './notificationService';
import { incrementMaterialQuoteCount } from './materialService';

export type InquirySubmitInput = {
  materialId: string;
  supplierId: string;
  designerId: string;
  moodBoardId?: string;
  projectName?: string;
  projectLocation?: string;
  estimatedArea?: number | null;
  deliveryDate?: string | null;
  remarks?: string;
};

export type SampleSubmitInput = {
  materialId: string;
  supplierId: string;
  designerId: string;
  receiverName: string;
  phone: string;
  address: string;
};

function client(portal?: AppPortal) {
  return portal ? getSupabaseForPortal(portal) : getSupabase();
}

function mapInquiryStatus(db: string | null | undefined): Inquiry['status'] {
  const s = (db || '').toLowerCase();
  if (s === 'quoted') return 'QUOTED';
  if (s === 'closed') return 'COMPLETED';
  return 'PENDING';
}

function mapSampleStatus(
  db: string | null | undefined,
  shippedBy?: 'supplier' | 'admin'
): SampleRequest['status'] {
  const s = (db || '').toLowerCase();
  if (s === 'shipped') {
    return shippedBy === 'admin' ? 'SHIPPED_BY_ADMIN' : 'SHIPPED_BY_SUPPLIER';
  }
  if (s === 'completed') return 'COMPLETED';
  return 'PENDING';
}

function rowToInquiry(row: Record<string, unknown>): Inquiry {
  const price = row.supplier_quote_price;
  const quotePrice =
    price === null || price === undefined || price === ''
      ? undefined
      : String(price);
  const area = row.estimated_area != null ? Number(row.estimated_area) : undefined;
  const totalPrice =
    quotePrice && area && !Number.isNaN(area)
      ? String(Number(quotePrice) * area)
      : undefined;

  return {
    id: String(row.id),
    materialId: String(row.material_id),
    designerId: String(row.designer_id),
    supplierId: String(row.supplier_id),
    moodBoardId: row.moodboard_id ? String(row.moodboard_id) : 'STANDALONE',
    status: mapInquiryStatus(row.status as string),
    submitDate: String(row.created_at ?? new Date().toISOString()),
    quotePrice,
    totalPrice,
    notes: row.supplier_quote_note ? String(row.supplier_quote_note) : undefined,
    designerNotes: row.remarks ? String(row.remarks) : undefined,
    projectName: row.project_name ? String(row.project_name) : undefined,
    projectLocation: row.project_location ? String(row.project_location) : undefined,
    estimatedArea: area,
    deliveryDate: row.delivery_date ? String(row.delivery_date) : undefined,
    quoteReadAt: row.quote_read_at ? String(row.quote_read_at) : undefined,
    isReadByDesigner: row.is_read_by_designer === false ? false : true,
    history:
      quotePrice && row.quoted_at
        ? [
            {
              price: quotePrice,
              date: String(row.quoted_at),
              notes: row.supplier_quote_note ? String(row.supplier_quote_note) : '',
            },
          ]
        : undefined,
  };
}

function rowToSample(
  row: Record<string, unknown>,
  shippedBy?: 'supplier' | 'admin'
): SampleRequest {
  return {
    id: String(row.id),
    materialId: String(row.material_id),
    designerId: String(row.designer_id),
    supplierId: String(row.supplier_id),
    address: String(row.address ?? ''),
    contactName: String(row.receiver_name ?? ''),
    phone: String(row.phone ?? ''),
    status: mapSampleStatus(row.status as string, shippedBy),
    submitDate: String(row.created_at ?? new Date().toISOString()),
    shipDate: row.shipped_at ? String(row.shipped_at) : undefined,
    trackingNumber: row.tracking_number ? String(row.tracking_number) : undefined,
    isReadByDesigner: row.is_read_by_designer === false ? false : true,
  };
}

/** 设计师提交询价 */
export async function createInquiry(
  input: InquirySubmitInput,
  portal: AppPortal = 'designer'
): Promise<{ ok: true; inquiry: Inquiry } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const payload = {
    designer_id: input.designerId,
    supplier_id: input.supplierId,
    material_id: input.materialId,
    moodboard_id: input.moodBoardId || 'STANDALONE',
    project_name: input.projectName?.trim() || null,
    project_location: input.projectLocation?.trim() || null,
    estimated_area:
      input.estimatedArea === null || input.estimatedArea === undefined
        ? null
        : Number(input.estimatedArea),
    delivery_date: input.deliveryDate || null,
    remarks: input.remarks?.trim() || null,
    status: 'pending',
  };

  const { data, error } = await client(portal)
    .from('inquiries')
    .insert(payload)
    .select('*')
    .single();

  if (error || !data) {
    console.error('[commerceRequestService] createInquiry:', error?.message);
    return { ok: false, error: error?.message || 'insert failed' };
  }

  void incrementMaterialQuoteCount(input.materialId);
  void createNotification({
    receiverId: input.supplierId,
    type: 'inquiry',
    targetId: input.materialId,
    senderId: input.designerId,
    portal,
  });

  return { ok: true, inquiry: rowToInquiry(data as Record<string, unknown>) };
}

/** 设计师提交小样申请 */
export async function createSampleRequest(
  input: SampleSubmitInput,
  portal: AppPortal = 'designer'
): Promise<{ ok: true; request: SampleRequest } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const { data, error } = await client(portal)
    .from('sample_requests')
    .insert({
      designer_id: input.designerId,
      supplier_id: input.supplierId,
      material_id: input.materialId,
      receiver_name: input.receiverName.trim(),
      phone: input.phone.trim(),
      address: input.address.trim(),
      status: 'pending',
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[commerceRequestService] createSampleRequest:', error?.message);
    return { ok: false, error: error?.message || 'insert failed' };
  }

  void createNotification({
    receiverId: input.supplierId,
    type: 'sample_request',
    targetId: input.materialId,
    senderId: input.designerId,
    portal,
  });

  return { ok: true, request: rowToSample(data as Record<string, unknown>) };
}

/** 材料商提交/重新报价 */
export async function submitInquiryQuote(options: {
  inquiryId: string;
  price: number | string;
  note?: string;
  designerId: string;
  materialId?: string;
  portal?: AppPortal;
}): Promise<{ ok: true; inquiry: Inquiry } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const priceNum = typeof options.price === 'number' ? options.price : parseFloat(options.price);
  if (Number.isNaN(priceNum) || priceNum < 0) {
    return { ok: false, error: '报价金额无效' };
  }

  const portal = options.portal ?? 'supplier';
  const quotedAt = new Date().toISOString();

  const { data, error } = await client(portal)
    .from('inquiries')
    .update({
      status: 'quoted',
      supplier_quote_price: priceNum,
      supplier_quote_note: options.note?.trim() || null,
      quoted_at: quotedAt,
      quote_read_at: null,
      is_read_by_designer: false,
    })
    .eq('id', options.inquiryId)
    .select('*')
    .single();

  if (error || !data) {
    console.error('[commerceRequestService] submitInquiryQuote:', error?.message);
    return { ok: false, error: error?.message || 'update failed' };
  }

  void createNotification({
    receiverId: options.designerId,
    type: 'quote_received',
    targetId: options.materialId || (data.material_id as string),
    portal,
  });

  return { ok: true, inquiry: rowToInquiry(data as Record<string, unknown>) };
}

/** 材料商/管理员确认寄出小样（走 security definer RPC，避免 RLS 静默失败） */
export async function shipSampleRequest(options: {
  requestId: string;
  trackingNumber?: string;
  portal?: AppPortal;
}): Promise<{ ok: true; request: SampleRequest } | { ok: false; error: string }> {
  if (!isSupabaseConfigured()) {
    return { ok: false, error: 'Supabase not configured' };
  }

  const portal = options.portal ?? 'supplier';
  const sb = client(portal);
  const {
    data: { session },
  } = await sb.auth.getSession();

  console.info('[commerceRequestService] shipSampleRequest', {
    portal,
    requestId: options.requestId,
    hasSession: Boolean(session?.user?.id),
    sessionUserId: session?.user?.id ?? null,
  });

  const { data, error } = await sb.rpc('ship_sample_request', {
    p_request_id: options.requestId,
    p_tracking_number: options.trackingNumber?.trim() || null,
  });

  if (error || !data) {
    console.error('[commerceRequestService] ship_sample_request RPC failed:', error?.message);
    // 回退：直接 update（兼容旧库未部署 RPC）
    const fallback = await sb
      .from('sample_requests')
      .update({
        status: 'shipped',
        tracking_number: options.trackingNumber?.trim() || null,
        shipped_at: new Date().toISOString(),
        is_read_by_designer: false,
      })
      .eq('id', options.requestId)
      .select('*')
      .maybeSingle();

    if (fallback.error || !fallback.data) {
      console.error(
        '[commerceRequestService] shipSampleRequest fallback failed:',
        fallback.error?.message,
        { rows: fallback.data }
      );
      return {
        ok: false,
        error: error?.message || fallback.error?.message || '更新失败：未写入任何行',
      };
    }
    return {
      ok: true,
      request: rowToSample(
        fallback.data as Record<string, unknown>,
        portal === 'admin' ? 'admin' : 'supplier'
      ),
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown>;
  console.info('[commerceRequestService] shipSampleRequest OK', {
    id: row.id,
    status: row.status,
    shipped_at: row.shipped_at,
  });

  return {
    ok: true,
    request: rowToSample(row, portal === 'admin' ? 'admin' : 'supplier'),
  };
}

/** 按角色拉取询价单（优先 RPC，失败回退 table select） */
export async function fetchInquiriesForUser(options: {
  userId: string;
  role: 'designer' | 'supplier' | 'admin';
  portal?: AppPortal;
}): Promise<Inquiry[]> {
  if (!isSupabaseConfigured() || !options.userId) return [];

  const portal =
    options.portal ??
    (options.role === 'admin' ? 'admin' : options.role === 'supplier' ? 'supplier' : 'designer');

  const sb = client(portal);
  const {
    data: { session },
  } = await sb.auth.getSession();
  console.info('[commerceRequestService] fetchInquiriesForUser', {
    portal,
    role: options.role,
    userId: options.userId,
    hasSession: Boolean(session?.user?.id),
    sessionUserId: session?.user?.id ?? null,
  });

  const rpc = await sb.rpc('list_my_inquiries');
  if (!rpc.error && rpc.data) {
    return (rpc.data as Record<string, unknown>[]).map(rowToInquiry);
  }
  if (rpc.error) {
    console.warn('[commerceRequestService] list_my_inquiries RPC failed, fallback select:', rpc.error.message);
  }

  let query = sb.from('inquiries').select('*').order('created_at', { ascending: false });
  if (options.role === 'designer') query = query.eq('designer_id', options.userId);
  else if (options.role === 'supplier') query = query.eq('supplier_id', options.userId);

  const { data, error } = await query;
  if (error) {
    console.error('[commerceRequestService] fetchInquiriesForUser:', error.message);
    return [];
  }
  return (data ?? []).map((row) => rowToInquiry(row as Record<string, unknown>));
}

/** 按角色拉取小样申请（优先 RPC，失败回退 table select） */
export async function fetchSampleRequestsForUser(options: {
  userId: string;
  role: 'designer' | 'supplier' | 'admin';
  portal?: AppPortal;
}): Promise<SampleRequest[]> {
  if (!isSupabaseConfigured() || !options.userId) return [];

  const portal =
    options.portal ??
    (options.role === 'admin' ? 'admin' : options.role === 'supplier' ? 'supplier' : 'designer');

  const sb = client(portal);
  const {
    data: { session },
  } = await sb.auth.getSession();
  console.info('[commerceRequestService] fetchSampleRequestsForUser', {
    portal,
    role: options.role,
    userId: options.userId,
    hasSession: Boolean(session?.user?.id),
    sessionUserId: session?.user?.id ?? null,
  });

  const rpc = await sb.rpc('list_my_sample_requests');
  if (!rpc.error && Array.isArray(rpc.data)) {
    console.info('[commerceRequestService] list_my_sample_requests rows:', rpc.data.length);
    return (rpc.data as Record<string, unknown>[]).map(rowToSample);
  }
  if (rpc.error) {
    console.warn(
      '[commerceRequestService] list_my_sample_requests RPC failed, fallback select:',
      rpc.error.message
    );
  }

  let query = sb.from('sample_requests').select('*').order('created_at', { ascending: false });
  if (options.role === 'designer') query = query.eq('designer_id', options.userId);
  else if (options.role === 'supplier') query = query.eq('supplier_id', options.userId);

  const { data, error } = await query;
  if (error) {
    console.error('[commerceRequestService] fetchSampleRequestsForUser:', error.message, {
      code: error.code,
      details: error.details,
      hint: error.hint,
    });
    return [];
  }
  console.info('[commerceRequestService] sample_requests select rows:', (data ?? []).length);
  return (data ?? []).map((row) => rowToSample(row as Record<string, unknown>));
}

/** 材料商/管理员：pending 小样数量（红点） */
export async function countPendingSampleRequests(portal?: AppPortal): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { data, error } = await client(portal).rpc('count_my_pending_sample_requests');
  if (error) {
    console.error('[commerceRequestService] countPendingSampleRequests:', error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** 设计师标记报价已读 */
export async function markInquiryQuotesRead(
  designerId: string,
  portal: AppPortal = 'designer'
): Promise<void> {
  if (!isSupabaseConfigured() || !designerId) return;
  const { error } = await client(portal)
    .from('inquiries')
    .update({
      quote_read_at: new Date().toISOString(),
      is_read_by_designer: true,
    })
    .eq('designer_id', designerId)
    .eq('status', 'quoted')
    .is('quote_read_at', null);
  if (error) {
    console.error('[commerceRequestService] markInquiryQuotesRead:', error.message);
  }
}

/** 设计师角标：未读小样 + 未读询价 */
export async function countDesignerUnreadRequests(
  portal: AppPortal = 'designer'
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { data, error } = await client(portal).rpc('count_designer_unread_requests');
  if (error) {
    console.error('[commerceRequestService] countDesignerUnreadRequests:', error.message);
    return 0;
  }
  return Number(data) || 0;
}

/** 进入申请记录：将当前设计师全部未读小样/询价标为已读 */
export async function markDesignerRequestsRead(
  portal: AppPortal = 'designer'
): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  const { data, error } = await client(portal).rpc('mark_designer_requests_read');
  if (error) {
    console.error('[commerceRequestService] markDesignerRequestsRead:', error.message);
    // 回退：直接 update
    const sb = client(portal);
    const now = new Date().toISOString();
    const [samples, inquiries] = await Promise.all([
      sb
        .from('sample_requests')
        .update({ is_read_by_designer: true })
        .eq('is_read_by_designer', false)
        .select('id'),
      sb
        .from('inquiries')
        .update({ is_read_by_designer: true, quote_read_at: now })
        .eq('is_read_by_designer', false)
        .select('id'),
    ]);
    return (samples.data?.length ?? 0) + (inquiries.data?.length ?? 0);
  }
  return Number(data) || 0;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** 构建时注入；缺失则禁止一切鉴权与数据访问 */
export const VITE_SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
export const VITE_SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export function isSupabaseConfigured(): boolean {
  return VITE_SUPABASE_URL.length > 0 && VITE_SUPABASE_ANON_KEY.length > 0;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  if (!client) {
    client = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        storage: typeof window !== 'undefined' ? window.localStorage : undefined,
      },
    });
  }
  return client;
}

/** 获取当前登录用户的 auth UUID */
export async function getCurrentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// 这里的 import.meta.env.VITE_... 必须能在控制台打印出来才有效
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

console.log('Supabase URL:', supabaseUrl);
console.log('Supabase Key:', supabaseAnonKey ? '已加载' : '未加载');

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ 致命错误：缺少 Supabase 环境变量！请检查 .env.local 文件');
}

export const VITE_SUPABASE_URL = (supabaseUrl ?? '').trim();
export const VITE_SUPABASE_ANON_KEY = (supabaseAnonKey ?? '').trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(supabaseUrl && supabaseAnonKey);
}

const authOptions = {
  persistSession: true,
  autoRefreshToken: true,
  detectSessionInUrl: true,
  storage: typeof window !== 'undefined' ? window.localStorage : undefined,
};

/** 全局 Supabase 客户端（环境变量缺失时仍实例化，但 isSupabaseConfigured 为 false，鉴权层会阻断） */
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? '',
  supabaseAnonKey ?? '',
  { auth: authOptions }
);

export function getSupabase(): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }
  return supabase;
}

/** 获取当前登录用户的 auth UUID */
export async function getCurrentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  AUTH_STORAGE_KEYS,
  getAppPortal,
  type AppPortal,
} from '../utils/appPortal';

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

/**
 * 三端各自独立 Auth storageKey，共享同一 URL + anon key（同一数据源）。
 * 禁止使用无 portal 区分的单一 auth client 作为登录态来源。
 */
const clientByPortal: Partial<Record<AppPortal, SupabaseClient>> = {};

function buildAuthOptions(portal: AppPortal) {
  return {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: AUTH_STORAGE_KEYS[portal],
  };
}

export function getSupabaseForPortal(portal: AppPortal): SupabaseClient {
  if (!isSupabaseConfigured()) {
    throw new Error('SUPABASE_NOT_CONFIGURED');
  }

  let client = clientByPortal[portal];
  if (!client) {
    client = createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: buildAuthOptions(portal),
    });
    clientByPortal[portal] = client;
  }
  return client;
}

/**
 * 业务查询与 Auth：使用当前入口 portal 对应的 client（JWT 来自该 portal 的 session）。
 * 仍指向同一 Supabase 项目，不改变 materials / events / profiles 数据源。
 */
export function getSupabase(portal: AppPortal = getAppPortal()): SupabaseClient {
  return getSupabaseForPortal(portal);
}

/**
 * @deprecated 请使用 getSupabase() / getSupabaseForPortal()。
 * 保留为兼容旧 import；解析为当前 portal 的 client（非固定单例 auth）。
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop, receiver) {
    const client = getSupabase();
    const value = Reflect.get(client as object, prop, receiver);
    return typeof value === 'function' ? value.bind(client) : value;
  },
});

/** 获取当前 portal 登录用户的 auth UUID */
export async function getCurrentUserId(): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  const { data } = await getSupabase().auth.getUser();
  return data.user?.id ?? null;
}

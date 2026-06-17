import { createClient } from '@supabase/supabase-js';

/**
 * 校验前端传来的 Supabase access_token，返回用户 id（失败返回 null）。
 *
 * 验证用户身份只需一个合法的项目 key：优先 service role / secret key，
 * 缺失时回退 anon / publishable key（本地开发常见只配了 anon key）。
 */
export async function verifySupabaseToken(
  authHeader: string | undefined
): Promise<string | null> {
  if (!authHeader?.startsWith('Bearer ')) return null;

  const token = authHeader.slice(7);
  const url = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const verifyKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY ??
    process.env.SUPABASE_SECRET_KEY ??
    process.env.VITE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_ANON_KEY;

  if (!url || !verifyKey) {
    console.error('[auth] 缺少 Supabase URL 或可用的 API key，无法校验 token');
    return null;
  }

  const client = createClient(url, verifyKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return null;
  return data.user.id;
}

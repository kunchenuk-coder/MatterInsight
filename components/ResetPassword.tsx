import React, { useEffect, useState } from 'react';
import { isSupabaseConfigured } from '../services/supabaseClient';
import {
  signOut,
  updatePassword,
  waitForRecoverySession,
} from '../services/authService';
import {
  cancelPasswordRecovery,
  ensureRecoveryRoute,
  lockPasswordRecoveryMode,
} from '../utils/authRoutes';
import AuthShell from './AuthShell';

const MIN_PASSWORD_LEN = 6;

const ResetPassword: React.FC = () => {
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionError, setSessionError] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    ensureRecoveryRoute();
    lockPasswordRecoveryMode(true);

    if (!isSupabaseConfigured()) return;

    let cancelled = false;
    (async () => {
      const ready = await waitForRecoverySession();
      if (cancelled) return;
      if (ready) {
        setSessionReady(true);
      } else {
        setSessionError('重置链接无效或已过期，请重新申请找回密码。');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const handleCancel = async () => {
    lockPasswordRecoveryMode(false);
    await signOut();
    cancelPasswordRecovery();
  };

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <p className="text-red-500 text-center text-2xl font-black">生产环境配置缺失，禁止访问</p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < MIN_PASSWORD_LEN) {
      setError(`密码至少需要 ${MIN_PASSWORD_LEN} 位字符`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的密码不一致');
      return;
    }

    setLoading(true);
    try {
      const result = await updatePassword(newPassword);
      if (result.ok === false) {
        setError(result.error);
        return;
      }

      await signOut();
      lockPasswordRecoveryMode(false);
      setSuccess(true);
      window.setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch {
      setError('密码修改失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  if (sessionError) {
    return (
      <AuthShell subtitle="设置新密码">
        <div className="space-y-6 text-center">
          <p className="text-red-400 text-sm font-bold leading-relaxed">{sessionError}</p>
          <button
            type="button"
            onClick={() => void handleCancel()}
            className="text-sm font-bold text-blue-400 hover:text-blue-300 transition-colors"
          >
            返回登录页
          </button>
        </div>
      </AuthShell>
    );
  }

  if (!sessionReady) {
    return (
      <AuthShell subtitle="设置新密码">
        <div className="flex flex-col items-center gap-4 py-6">
          <div className="w-8 h-8 border-2 border-white/20 border-t-white rounded-full animate-spin" />
          <p className="text-gray-300 text-sm font-bold">正在验证重置链接…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle="设置新密码">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
            输入新密码
          </label>
          <input
            required
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="至少 6 位字符"
            className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
          />
        </div>
        <div>
          <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
            确认新密码
          </label>
          <input
            required
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="再次输入新密码"
            className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
          />
        </div>

        {error && (
          <div role="alert" className="rounded-2xl bg-red-600/20 border border-red-500 px-4 py-3">
            <p className="text-red-400 text-sm font-bold text-center">{error}</p>
          </div>
        )}

        {success && (
          <div role="status" className="rounded-2xl bg-green-600/20 border border-green-500 px-4 py-3">
            <p className="text-green-400 text-sm font-bold text-center">密码重置成功，请重新登录！</p>
            <p className="text-green-400/80 text-xs text-center mt-1">即将跳转到登录页…</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading || success}
          className="w-full bg-black text-white py-4 rounded-2xl font-bold mt-2 shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {loading ? '提交中…' : '确认修改'}
        </button>

        <div className="text-center pt-2">
          <button
            type="button"
            onClick={() => void handleCancel()}
            disabled={loading || success}
            className="text-xs font-bold text-gray-400 hover:text-white transition-colors disabled:opacity-50"
          >
            取消并返回登录
          </button>
        </div>
      </form>
    </AuthShell>
  );
};

export default ResetPassword;

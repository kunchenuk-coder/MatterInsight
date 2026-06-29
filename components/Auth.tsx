
import React, { useState } from 'react';
import { UserRole } from '../types';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { requestPasswordReset, signIn, signUp, isRegisteredRoleError } from '../services/authService';
import AuthShell from './AuthShell';

interface AuthProps {
  onAuthSuccess: (user: import('../types').User) => void;
  /** 管理员入口：隐藏角色选项卡，强制 ADMIN 身份，且不可自助注册 */
  adminPortal?: boolean;
}

type AuthMode = 'login' | 'register' | 'forgot';

const LOGIN_FAILED_MSG = '邮箱或密码错误';

const AuthSpinner: React.FC<{ label: string }> = ({ label }) => (
  <div className="absolute inset-0 z-20 bg-black/45 backdrop-blur-[2px] flex flex-col items-center justify-center gap-3 rounded-[40px]">
    <div className="w-9 h-9 border-2 border-white/25 border-t-white rounded-full animate-spin" />
    <p className="text-white/90 text-xs font-bold tracking-wide">{label}</p>
  </div>
);

const AuthSubmitButton: React.FC<{
  loading: boolean;
  loadingLabel: string;
  idleLabel: string;
  className?: string;
}> = ({ loading, loadingLabel, idleLabel, className = 'mt-2' }) => (
  <button
    type="submit"
    disabled={loading}
    className={`w-full bg-black text-white py-4 rounded-2xl font-bold shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-80 disabled:hover:scale-100 flex items-center justify-center gap-2.5 ${className}`}
  >
    {loading && (
      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin shrink-0" />
    )}
    {loading ? loadingLabel : idleLabel}
  </button>
);

const Auth: React.FC<AuthProps> = ({ onAuthSuccess, adminPortal = false }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [role, setRole] = useState<UserRole>(adminPortal ? 'ADMIN' : 'DESIGNER');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <p className="text-red-500 text-center text-2xl sm:text-4xl font-black leading-tight tracking-tight select-none">
          生产环境配置缺失，禁止访问
        </p>
      </div>
    );
  }

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setInfo('');
  };

  const showForgotLink = mode === 'login';

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setError('请输入邮箱地址');
        return;
      }

      const result = await requestPasswordReset(trimmedEmail);
      if (result.ok === false) {
        setError(result.error);
        return;
      }

      setInfo('重置邮件已发送，请查收邮箱（含垃圾箱），点击链接完成密码修改。');
    } catch {
      setError('发送失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      const trimmedPassword = password;

      if (!trimmedEmail || !trimmedPassword) {
        setError(LOGIN_FAILED_MSG);
        return;
      }

      if (mode === 'login') {
        const result = await signIn(trimmedEmail, trimmedPassword, role);
        if (result.ok === false) {
          setError(result.error);
          return;
        }
        onAuthSuccess(result.user);
        return;
      }

      if (role === 'ADMIN') {
        setError('管理员账号请联系平台开通，无法自助注册');
        return;
      }

      const result = await signUp(trimmedEmail, trimmedPassword, role);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onAuthSuccess(result.user);
    } catch {
      setError(mode === 'login' ? LOGIN_FAILED_MSG : '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  const isRegisteredRole = isRegisteredRoleError(error);

  const loadingLabel =
    mode === 'forgot' ? '正在发送…' : mode === 'login' ? '正在验证身份…' : '正在创建账号…';

  if (mode === 'forgot') {
    return (
      <AuthShell subtitle="找回密码">
        {loading && <AuthSpinner label={loadingLabel} />}
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <p className="text-gray-300 text-sm text-center leading-relaxed mb-2">
            输入注册邮箱，我们将发送官方重置密码链接至您的邮箱。
          </p>
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
              邮箱地址
            </label>
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
              autoComplete="email"
              className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-2xl bg-red-600/20 border border-red-500 px-4 py-3">
              <p className="text-red-400 text-sm font-bold text-center">{error}</p>
            </div>
          )}

          {info && (
            <div role="status" className="rounded-2xl bg-green-600/20 border border-green-500 px-4 py-3">
              <p className="text-green-400 text-sm font-bold text-center leading-snug">{info}</p>
            </div>
          )}

          <AuthSubmitButton
            loading={loading}
            loadingLabel="发送中…"
            idleLabel="发送重置邮件"
          />

          <div className="text-center pt-2">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-xs font-bold text-gray-400 hover:text-white transition-colors"
            >
              返回登录
            </button>
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={adminPortal ? '管理控制台 · 仅限平台管理员' : undefined}>
      {loading && <AuthSpinner label={loadingLabel} />}
      {adminPortal ? (
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-100 px-6 py-3 rounded-2xl">
            <span className="text-lg">🛡️</span>
            <span className="text-sm font-black text-black tracking-wide">管理控制台登录</span>
          </div>
        </div>
      ) : (
        <div className="flex bg-gray-100 p-1 rounded-2xl mb-8">
          <button
            type="button"
            onClick={() => {
              setRole('DESIGNER');
              setError('');
            }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'DESIGNER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            设计师
          </button>
          <button
            type="button"
            onClick={() => {
              setRole('SUPPLIER');
              setError('');
            }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'SUPPLIER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            材料商
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
            邮箱地址
          </label>
          <input
            required
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="hello@example.com"
            autoComplete="email"
            className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
          />
        </div>
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest">
              访问密码
            </label>
            {showForgotLink && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors"
              >
                忘记密码？
              </button>
            )}
          </div>
          <input
            required
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
          />
        </div>

        {error && (
          <div
            role="alert"
            className={`rounded-2xl px-4 py-3 border ${
              isRegisteredRole
                ? 'bg-red-600/25 border-red-500'
                : 'bg-red-600/20 border-red-500'
            }`}
          >
            <p className="text-red-400 text-sm font-bold text-center leading-snug">{error}</p>
            {isRegisteredRole && mode === 'login' && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                同一邮箱只能拥有一个身份；如需使用{role === 'DESIGNER' ? '设计师' : role === 'SUPPLIER' ? '材料商' : '管理端'}身份，请更换邮箱重新注册。
              </p>
            )}
            {isRegisteredRole && mode === 'register' && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                请更换其他邮箱后再创建{role === 'DESIGNER' ? '设计师' : role === 'SUPPLIER' ? '材料商' : '管理端'}账号。
              </p>
            )}
            {!isRegisteredRole && mode === 'register' && error.includes('该邮箱已被注册') && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                请更换其他邮箱后再试。
              </p>
            )}
          </div>
        )}

        {info && (
          <div role="status" className="rounded-2xl bg-green-600/20 border border-green-500 px-4 py-3">
            <p className="text-green-400 text-sm font-bold text-center">{info}</p>
          </div>
        )}

        <AuthSubmitButton
          loading={loading}
          loadingLabel="验证中…"
          idleLabel={mode === 'login' ? '立即进入' : '创建账号'}
          className="mt-4"
        />
      </form>

      {!adminPortal && (
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            className="text-xs font-bold text-gray-400 hover:text-black transition-colors"
          >
            {mode === 'login' ? '还没有账号? 立即注册' : '已有账号? 返回登录'}
          </button>
        </div>
      )}
    </AuthShell>
  );
};

export default Auth;


import React, { useState } from 'react';
import { UserRole } from '../types';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { requestPasswordReset, signIn, signUp, isRoleMismatchError } from '../services/authService';
import AuthShell from './AuthShell';

interface AuthProps {
  onAuthSuccess: (user: import('../types').User) => void;
}

type AuthMode = 'login' | 'register' | 'forgot';

const LOGIN_FAILED_MSG = '邮箱或密码错误';
const EMAIL_ALREADY_REGISTERED = '该邮箱已被注册';

const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<AuthMode>('login');
  const [role, setRole] = useState<UserRole>('DESIGNER');
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

  const showForgotLink =
    mode === 'login' || (mode === 'register' && error === EMAIL_ALREADY_REGISTERED);

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

  const isRoleMismatch = isRoleMismatchError(error);

  if (mode === 'forgot') {
    return (
      <AuthShell subtitle="找回密码">
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

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-4 rounded-2xl font-bold mt-2 shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {loading ? '发送中…' : '发送重置邮件'}
          </button>

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
    <AuthShell>
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
        <button
          type="button"
          onClick={() => {
            setRole('ADMIN');
            setError('');
          }}
          className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'ADMIN' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
        >
          管理端
        </button>
      </div>

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
              isRoleMismatch
                ? 'bg-red-600/25 border-red-500'
                : 'bg-red-600/20 border-red-500'
            }`}
          >
            <p className="text-red-400 text-sm font-bold text-center leading-snug">{error}</p>
            {isRoleMismatch && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                请点选上方正确的身份入口后，再使用邮箱密码登录。
              </p>
            )}
            {error === EMAIL_ALREADY_REGISTERED && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="block w-full mt-2 text-xs font-bold text-blue-400 hover:text-blue-300 transition-colors"
              >
                忘记密码？
              </button>
            )}
          </div>
        )}

        {info && (
          <div role="status" className="rounded-2xl bg-green-600/20 border border-green-500 px-4 py-3">
            <p className="text-green-400 text-sm font-bold text-center">{info}</p>
          </div>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-black text-white py-4 rounded-2xl font-bold mt-4 shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60"
        >
          {loading ? '验证中…' : mode === 'login' ? '立即进入' : '创建账号'}
        </button>
      </form>

      <div className="mt-8 text-center">
        <button
          type="button"
          onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
          className="text-xs font-bold text-gray-400 hover:text-black transition-colors"
        >
          {mode === 'login' ? '还没有账号? 立即注册' : '已有账号? 返回登录'}
        </button>
      </div>
    </AuthShell>
  );
};

export default Auth;

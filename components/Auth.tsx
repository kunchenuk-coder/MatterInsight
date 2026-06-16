
import React, { useState } from 'react';
import { UserRole } from '../types';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { signIn, signUp } from '../services/authService';

interface AuthProps {
  onAuthSuccess: (user: import('../types').User) => void;
}

const LOGIN_FAILED_MSG = '邮箱或密码错误';

const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [role, setRole] = useState<UserRole>('DESIGNER');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <p className="text-red-500 text-center text-2xl sm:text-4xl font-black leading-tight tracking-tight select-none">
          生产环境配置缺失，禁止访问
        </p>
      </div>
    );
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      const trimmedPassword = password;

      if (!trimmedEmail || !trimmedPassword) {
        setError(LOGIN_FAILED_MSG);
        return;
      }

      if (isLogin) {
        const result = await signIn(trimmedEmail, trimmedPassword);
        if (!result.ok) {
          setError(LOGIN_FAILED_MSG);
          return;
        }
        onAuthSuccess(result.user);
        return;
      }

      const result = await signUp(trimmedEmail, trimmedPassword, role);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      onAuthSuccess(result.user);
    } catch {
      setError(isLogin ? LOGIN_FAILED_MSG : '注册失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#111] flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

      <div className="w-full max-w-md bg-[#393939] p-10 rounded-[40px] shadow-2xl relative z-10">
        <div className="text-center mb-10">
          <div className="text-2xl font-black bg-black text-white inline-block px-5 py-2 mb-4 tracking-tighter">
            物见 <span className="text-gray-400 font-light">|</span> MATTER INSIGHT
          </div>
          <div className="space-y-1.5 md:space-y-1 px-4">
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">
              material matters / 以材质之名赋予生命
            </p>
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">
              material matters not / 以设计之名定义重生
            </p>
          </div>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-8">
          <button
            type="button"
            onClick={() => setRole('DESIGNER')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'DESIGNER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            设计师
          </button>
          <button
            type="button"
            onClick={() => setRole('SUPPLIER')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'SUPPLIER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            材料商
          </button>
          <button
            type="button"
            onClick={() => setRole('ADMIN')}
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
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
              访问密码
            </label>
            <input
              required
              type="password"
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
            />
          </div>

          {error && (
            <div role="alert" className="rounded-2xl bg-red-600/20 border border-red-500 px-4 py-3">
              <p className="text-red-400 text-sm font-bold text-center leading-snug">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black text-white py-4 rounded-2xl font-bold mt-4 shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all disabled:opacity-60"
          >
            {loading ? '验证中…' : isLogin ? '立即进入' : '创建账号'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={() => {
              setIsLogin(!isLogin);
              setError('');
            }}
            className="text-xs font-bold text-gray-400 hover:text-black transition-colors"
          >
            {isLogin ? '还没有账号? 立即注册' : '已有账号? 返回登录'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default Auth;

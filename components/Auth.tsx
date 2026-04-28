
import React, { useState } from 'react';
import { User, UserRole } from '../types';

interface AuthProps {
  onAuthSuccess: (user: User) => void;
}

const Auth: React.FC<AuthProps> = ({ onAuthSuccess }) => {
  const [role, setRole] = useState<UserRole>('DESIGNER');
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    // Simulate registration counter
    const countKey = 'matter_insight_reg_count';
    const currentCount = parseInt(localStorage.getItem(countKey) || '0');
    const isFirst500 = currentCount < 500;
    
    if (!isLogin) {
      localStorage.setItem(countKey, (currentCount + 1).toString());
    }

    const mockUser: User = {
      id: Math.random().toString(36).substr(2, 9),
      email: email || 'demo@user.com',
      name: email.split('@')[0] || (role === 'DESIGNER' ? '设计师陈某' : role === 'ADMIN' ? '平台运营' : '建材供应商'),
      role: role,
      points: role === 'DESIGNER' && isFirst500 ? 1000 : (role === 'ADMIN' ? 999999 : 0),
      company: role === 'SUPPLIER' ? 'Premium Materials Co.' : role === 'ADMIN' ? '物见 | Matter Insight Official' : 'Creative Design Studio',
      isVerified: role === 'ADMIN' || role === 'DESIGNER', // Designers verified by default for demo, Suppliers need manual verification
      registeredPhone: ''
    };

    if (role === 'DESIGNER' && isFirst500 && !isLogin) {
      (mockUser as any).showWelcomeBonus = true;
    }

    onAuthSuccess(mockUser);
  };

  return (
    <div className="min-h-screen bg-[#111] flex items-center justify-center p-6 overflow-hidden relative">
      <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2"></div>
      <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2"></div>

      <div className="w-full max-w-md bg-[#393939] p-10 rounded-[40px] shadow-2xl relative z-10">
        <div className="text-center mb-10">
          <div className="text-2xl font-black bg-black text-white inline-block px-5 py-2 mb-4 tracking-tighter">
            物见 <span className="text-gray-400 font-light">|</span> MATTER INSIGHT
          </div>
          <div className="space-y-1.5 md:space-y-1 px-4">
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">material matters / 以材质之名赋予生命</p>
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">material matters not / 以设计之名定义重生</p>
          </div>
        </div>

        <div className="flex bg-gray-100 p-1 rounded-2xl mb-8">
          <button 
            onClick={() => setRole('DESIGNER')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'DESIGNER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            设计师
          </button>
          <button 
            onClick={() => setRole('SUPPLIER')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'SUPPLIER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            材料商
          </button>
          <button 
            onClick={() => setRole('ADMIN')}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'ADMIN' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            管理端
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">邮箱地址</label>
            <input 
              required
              type="email" 
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="hello@example.com"
              className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
            />
          </div>
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">访问密码</label>
            <input 
              required
              type="password" 
              autoComplete="new-password"
              placeholder="••••••••"
              className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
            />
          </div>
          
          <button 
            type="submit"
            className="w-full bg-black text-white py-4 rounded-2xl font-bold mt-4 shadow-xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all"
          >
            {isLogin ? '立即进入' : '创建账号'}
          </button>
        </form>

        <div className="mt-8 text-center">
          <button 
            onClick={() => setIsLogin(!isLogin)}
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


import React, { useState } from 'react';
import { User } from '../types';

interface NavbarProps {
  user: User;
  points: number;
  onLogoClick: () => void;
  onProfileClick: () => void;
  onMoodboardClick: () => void;
  onLogout: () => void;
  onRechargeClick: () => void;
  notifications?: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

const Navbar: React.FC<NavbarProps> = ({ 
  user, points, onLogoClick, onProfileClick, onMoodboardClick, onLogout, onRechargeClick, 
  notifications = 0, searchTerm, onSearchChange 
}) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b z-50 h-16 flex items-center px-6 justify-between">
        <div className="flex items-center gap-8">
          <div 
            onClick={onLogoClick}
            className="flex flex-col cursor-pointer group flex-1 md:flex-none items-center md:items-start"
          >
            <div className="text-[12px] md:text-xl font-black bg-black text-white px-2.5 md:px-4 py-1.5 md:py-1 tracking-tighter flex items-center gap-1.5 md:gap-2 w-fit whitespace-nowrap">
              物见 <span className="text-gray-400 font-light text-[10px] md:text-base">|</span> MATTER INSIGHT
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <button onClick={onLogoClick} className="hover:text-black transition-colors">探索库</button>
            {user.role === 'DESIGNER' && (
              <button onClick={onMoodboardClick} className="hover:text-black transition-colors">情绪板</button>
            )}
            <button onClick={onProfileClick} className="hover:text-black transition-colors">控制台</button>
          </div>
        </div>

        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <input 
              type="text" 
              placeholder="搜索材料、品牌、项目..." 
              className="w-full bg-gray-100 border-none rounded-full px-5 py-2 text-sm focus:ring-2 focus:ring-black outline-none transition-all"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
            />
            <span className="absolute right-4 top-2 text-gray-400">🔍</span>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-6">
          <button 
            onClick={onRechargeClick}
            className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full text-[10px] md:text-xs font-bold border border-yellow-200 hover:bg-yellow-100 transition-colors"
          >
            <span className="text-sm">🪙</span> {points} 点
          </button>
          
          <div className="hidden md:flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold">{user.name}</div>
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                {user.role === 'DESIGNER' ? '设计师' : user.role === 'ADMIN' ? '运营' : '材料商'}
              </div>
            </div>
            <div 
              onClick={onProfileClick}
              className="relative w-10 h-10 rounded-full bg-gray-200 cursor-pointer overflow-visible border-2 border-white shadow-sm"
            >
              <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${user.id}`} alt="profile" className="w-full h-full rounded-full" />
              {notifications > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center border-2 border-white">
                  {notifications}
                </span>
              )}
            </div>
            <button 
              onClick={onLogout}
              className="text-gray-400 hover:text-red-500 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

          {/* Mobile Menu Toggle */}
          <button 
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden text-black p-2"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isMobileMenuOpen ? "M6 18L18 6M6 6l12 12" : "M4 6h16M4 12h16M4 18h16"} />
            </svg>
          </button>
        </div>
      </nav>

      {/* Mobile Menu Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 bg-white z-[60] pt-20 px-6 md:hidden flex flex-col items-center">
          <div className="w-full max-w-sm space-y-4 flex flex-col items-center pt-8">
            <button 
              onClick={() => { onLogoClick(); setIsMobileMenuOpen(false); }} 
              className="w-full py-5 rounded-2xl bg-gray-50 text-xl font-black uppercase tracking-tighter text-center hover:bg-black hover:text-white transition-all shadow-sm flex items-center justify-center gap-3"
            >
              <span>🔍</span> 探索材料库
            </button>
            {user.role === 'DESIGNER' && (
              <button 
                onClick={() => { onMoodboardClick(); setIsMobileMenuOpen(false); }} 
                className="w-full py-5 rounded-2xl bg-gray-50 text-xl font-black uppercase tracking-tighter text-center hover:bg-black hover:text-white transition-all shadow-sm flex items-center justify-center gap-3"
              >
                <span>🎨</span> 情绪板设计
              </button>
            )}
            <button 
              onClick={() => { onProfileClick(); setIsMobileMenuOpen(false); }} 
              className="w-full py-5 rounded-2xl bg-gray-50 text-xl font-black uppercase tracking-tighter text-center hover:bg-black hover:text-white transition-all shadow-sm flex items-center justify-center gap-3"
            >
              <span>📊</span> 个人控制台
            </button>
            <button 
              onClick={() => { onLogout(); setIsMobileMenuOpen(false); }} 
              className="w-full py-5 rounded-2xl bg-red-50 text-xl font-black uppercase tracking-tighter text-center text-red-500 hover:bg-red-500 hover:text-white transition-all shadow-sm flex items-center justify-center gap-3"
            >
              <span>🚪</span> 退出登录
            </button>
          </div>
          
          <div className="mt-12 w-full max-w-sm">
             <div className="relative w-full">
              <input 
                type="text" 
                placeholder="搜索感兴趣的材质..." 
                className="w-full bg-gray-100 border-none rounded-2xl px-6 py-4 text-sm font-bold focus:ring-2 focus:ring-black outline-none transition-all text-center"
                value={searchTerm}
                onChange={(e) => onSearchChange(e.target.value)}
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;

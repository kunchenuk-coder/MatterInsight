
import React from 'react';
import { User } from '../types';
import { resolveUserDisplayName } from '../utils/profileDisplayName';

interface NavbarProps {
  user: User;
  points: number;
  onLogoClick: () => void;
  onProfileClick: () => void;
  onAvatarClick?: () => void;
  onMyPageClick?: () => void;
  onMoodboardClick: () => void;
  onLogout: () => void;
  onRechargeClick: () => void;
  notifications?: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

const defaultAvatarUrl = (userId: string) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;

const Navbar: React.FC<NavbarProps> = ({ 
  user, points, onLogoClick, onProfileClick, onAvatarClick, onMyPageClick, onMoodboardClick, onLogout, onRechargeClick, 
  notifications = 0, searchTerm, onSearchChange 
}) => {
  const avatarSrc = user.avatar?.trim() ? user.avatar.trim() : defaultAvatarUrl(user.id);
  const handleAvatarClick = onAvatarClick ?? onProfileClick;
  const displayName = resolveUserDisplayName({ company: user.company, email: user.email });
  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b z-50 h-16 flex items-center px-3 md:px-6 justify-between gap-2">
        <div className="flex items-center gap-8 min-w-0">
          <div 
            onClick={onLogoClick}
            className="flex flex-col cursor-pointer group items-start shrink-0"
          >
            <div className="text-[12px] md:text-xl font-black bg-black text-white px-2.5 md:px-4 py-1.5 md:py-1 tracking-tighter flex items-center gap-1.5 md:gap-2 w-fit whitespace-nowrap">
              物见 <span className="hidden md:inline text-gray-400 font-light text-[10px] md:text-base">|</span> <span className="hidden md:inline">MATTER INSIGHT</span>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <button onClick={onLogoClick} className="hover:text-black transition-colors">探索库</button>
            {user.role === 'DESIGNER' && (
              <button onClick={onMoodboardClick} className="hover:text-black transition-colors">情绪板</button>
            )}
            {user.role === 'DESIGNER' && onMyPageClick && (
              <button onClick={onMyPageClick} className="hover:text-black transition-colors">我的主页</button>
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
              <div className="text-sm font-semibold truncate max-w-[140px]">{displayName}</div>
              <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                {user.role === 'DESIGNER' ? '设计师' : user.role === 'ADMIN' ? '运营' : '材料商'}
              </div>
            </div>
            <div 
              onClick={handleAvatarClick}
              className="relative w-10 h-10 rounded-full bg-gray-200 cursor-pointer overflow-visible border-2 border-white shadow-sm"
            >
              <img src={avatarSrc} alt="profile" className="w-full h-full rounded-full object-cover" />
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

          {/* 移动端常驻导航：4 个图标固定在顶部，随时跳转（替代汉堡菜单） */}
          <div className="md:hidden flex items-center gap-0.5">
            <button
              type="button"
              onClick={onLogoClick}
              title="探索材料库"
              aria-label="探索材料库"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-gray-100 active:scale-90 transition-all"
            >
              🔍
            </button>
            {user.role === 'DESIGNER' && (
              <button
                type="button"
                onClick={onMoodboardClick}
                title="情绪板设计"
                aria-label="情绪板设计"
                className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-gray-100 active:scale-90 transition-all"
              >
                🎨
              </button>
            )}
            <button
              type="button"
              onClick={handleAvatarClick}
              title={user.role === 'DESIGNER' ? '我的主页' : '个人控制台'}
              aria-label={user.role === 'DESIGNER' ? '我的主页' : '个人控制台'}
              className="relative w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden hover:bg-gray-100 active:scale-90 transition-all"
            >
              {user.avatar?.trim() ? (
                <img src={avatarSrc} alt="" className="w-full h-full object-cover rounded-xl" />
              ) : (
                <span className="text-lg leading-none">👤</span>
              )}
              {notifications > 0 && (
                <span className="absolute -top-0.5 -right-0.5 bg-red-500 text-white text-[9px] font-black min-w-[16px] h-4 px-1 rounded-full flex items-center justify-center border border-white">
                  {notifications}
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={onLogout}
              title="退出登录"
              aria-label="退出登录"
              className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-red-50 active:scale-90 transition-all"
            >
              🚪
            </button>
          </div>
        </div>
      </nav>
    </>
  );
};

export default Navbar;

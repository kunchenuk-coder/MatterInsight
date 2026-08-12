
import React from 'react';
import { useTranslation } from 'react-i18next';
import { User } from '../types';
import { resolveUserDisplayName } from '../utils/profileDisplayName';
import LanguageSwitcher from './LanguageSwitcher';

interface NavbarProps {
  user: User | null;
  points: number;
  onLogoClick: () => void;
  onProfileClick: () => void;
  onAvatarClick?: () => void;
  onMyPageClick?: () => void;
  onMoodboardClick: () => void;
  onLogout: () => void;
  onRechargeClick: () => void;
  /** 访客：打开登录/注册 */
  onAuthClick?: () => void;
  notifications?: number;
  searchTerm: string;
  onSearchChange: (value: string) => void;
  onSearchSubmit?: () => void;
  onSearchExit?: () => void;
}

const defaultAvatarUrl = (userId: string) =>
  `https://api.dicebear.com/7.x/avataaars/svg?seed=${userId}`;

const Navbar: React.FC<NavbarProps> = ({ 
  user, points, onLogoClick, onProfileClick, onAvatarClick, onMyPageClick, onMoodboardClick, onLogout, onRechargeClick,
  onAuthClick,
  notifications = 0, searchTerm, onSearchChange, onSearchSubmit, onSearchExit
}) => {
  const { t } = useTranslation();
  const isGuest = !user;
  const avatarSrc = user
    ? user.avatar?.trim()
      ? user.avatar.trim()
      : defaultAvatarUrl(user.id)
    : '';
  const handleAvatarClick = onAvatarClick ?? onProfileClick;
  const displayName = user
    ? resolveUserDisplayName({ company: user.company, email: user.email })
    : '';

  const roleLabel =
    user?.role === 'DESIGNER'
      ? t('common.designer')
      : user?.role === 'ADMIN'
        ? t('common.admin')
        : t('common.supplier');

  return (
    <>
      <nav className="fixed top-0 left-0 right-0 bg-white/80 backdrop-blur-md border-b z-50 h-16 flex items-center px-3 md:px-6 justify-between gap-2">
        <div className="flex items-center gap-8 min-w-0">
          <div 
            onClick={onLogoClick}
            className="flex flex-col cursor-pointer group items-start shrink-0"
          >
            <div className="text-[12px] md:text-xl font-black bg-black text-white px-2.5 md:px-4 py-1.5 md:py-1 tracking-tighter flex items-center gap-1.5 md:gap-2 w-fit whitespace-nowrap">
              {t('common.brand')} <span className="hidden md:inline text-gray-400 font-light text-[10px] md:text-base">|</span> <span className="hidden md:inline">MATTER INSIGHT</span>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-6 text-sm font-medium text-gray-600">
            <button type="button" onClick={onLogoClick} className="hover:text-black transition-colors">{t('common.exploreLibrary')}</button>
            {!isGuest && user.role === 'DESIGNER' && (
              <button type="button" onClick={onMoodboardClick} className="hover:text-black transition-colors">{t('common.moodboard')}</button>
            )}
            {!isGuest && user.role === 'DESIGNER' && onMyPageClick && (
              <button type="button" onClick={onMyPageClick} className="hover:text-black transition-colors">{t('common.myPage')}</button>
            )}
            {!isGuest && (
              <button type="button" onClick={onProfileClick} className="hover:text-black transition-colors">{t('common.dashboard')}</button>
            )}
          </div>
        </div>

        <div className="hidden md:flex flex-1 max-w-md mx-8">
          <div className="relative w-full">
            <input 
              type="text" 
              placeholder={t('nav.searchPlaceholder')}
              className="w-full bg-gray-100 border-none rounded-full px-5 py-2 pr-16 text-sm focus:ring-2 focus:ring-black outline-none transition-all"
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onSearchSubmit?.();
                }
              }}
            />
            <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
              {searchTerm.trim() !== '' && onSearchExit && (
                <button
                  type="button"
                  onClick={onSearchExit}
                  title={t('nav.searchExit')}
                  aria-label={t('nav.searchExit')}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200/80 transition-colors text-lg leading-none"
                >
                  ×
                </button>
              )}
              <button
                type="button"
                onClick={() => onSearchSubmit?.()}
                title={t('nav.searchSubmit')}
                aria-label={t('nav.searchSubmit')}
                className="w-8 h-8 rounded-full flex items-center justify-center text-gray-400 hover:text-black hover:bg-gray-200/80 transition-colors text-sm leading-none"
              >
                🔍
              </button>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3 md:gap-6">
          {isGuest ? (
            <>
              <button
                type="button"
                onClick={onAuthClick}
                className="hidden md:inline-flex items-center bg-black text-white px-5 py-2 rounded-full text-xs font-bold hover:scale-[1.02] active:scale-[0.98] transition-transform"
              >
                {t('common.loginRegister')}
              </button>
              <div className="md:hidden flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={onLogoClick}
                  title={t('nav.exploreMaterials')}
                  aria-label={t('nav.exploreMaterials')}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-gray-100 active:scale-90 transition-all"
                >
                  🔍
                </button>
                <button
                  type="button"
                  onClick={onAuthClick}
                  title={t('common.loginRegister')}
                  aria-label={t('common.loginRegister')}
                  className="px-3 h-9 rounded-xl bg-black text-white text-[11px] font-bold hover:opacity-90 active:scale-95 transition-all"
                >
                  {t('common.login')}
                </button>
              </div>
            </>
          ) : (
            <>
              <LanguageSwitcher />
              <button 
                type="button"
                onClick={onRechargeClick}
                className="flex items-center gap-2 bg-yellow-50 text-yellow-700 px-3 py-1 rounded-full text-[10px] md:text-xs font-bold border border-yellow-200 hover:bg-yellow-100 transition-colors"
              >
                <span className="text-sm">🪙</span> {t('common.points', { count: points })}
              </button>
              
              <div className="hidden md:flex items-center gap-3">
                <div className="text-right hidden sm:block">
                  <div className="text-sm font-semibold truncate max-w-[140px]">{displayName}</div>
                  <div className="text-[10px] uppercase text-gray-400 font-bold tracking-wider">
                    {roleLabel}
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
                  type="button"
                  onClick={onLogout}
                  title={t('common.logout')}
                  aria-label={t('common.logout')}
                  className="text-gray-400 hover:text-red-500 transition-colors"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              </div>

              <div className="md:hidden flex items-center gap-0.5">
                <button
                  type="button"
                  onClick={onLogoClick}
                  title={t('nav.exploreMaterials')}
                  aria-label={t('nav.exploreMaterials')}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-gray-100 active:scale-90 transition-all"
                >
                  🔍
                </button>
                {user.role === 'DESIGNER' && (
                  <button
                    type="button"
                    onClick={onMoodboardClick}
                    title={t('nav.moodboardDesign')}
                    aria-label={t('nav.moodboardDesign')}
                    className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-gray-100 active:scale-90 transition-all"
                  >
                    🎨
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleAvatarClick}
                  title={user.role === 'DESIGNER' ? t('common.myPage') : t('nav.profileConsole')}
                  aria-label={user.role === 'DESIGNER' ? t('common.myPage') : t('nav.profileConsole')}
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
                  title={t('common.logout')}
                  aria-label={t('common.logout')}
                  className="w-9 h-9 rounded-xl flex items-center justify-center text-lg leading-none hover:bg-red-50 active:scale-90 transition-all"
                >
                  🚪
                </button>
              </div>
            </>
          )}
        </div>
      </nav>
    </>
  );
};

export default Navbar;

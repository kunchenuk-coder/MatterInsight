import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { UserRole } from '../types';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { requestPasswordReset, signIn, signUp, isRegisteredRoleError } from '../services/authService';
import { updateVerificationRequest } from '../services/profileService';
import { uploadImage } from '../services/uploadService';
import { portalFromUserRole, setPortalOverride } from '../utils/appPortal';
import AuthShell from './AuthShell';

interface AuthProps {
  onAuthSuccess: (user: import('../types').User) => void;
  /** 管理员入口：隐藏角色选项卡，强制 ADMIN 身份，且不可自助注册 */
  adminPortal?: boolean;
  /** 首屏模式：访客点材料默认 register，顶栏入口默认 login */
  initialMode?: 'login' | 'register';
  /** 返回探索库（访客 Auth gate） */
  onBack?: () => void;
}

type AuthMode = 'login' | 'register' | 'forgot';

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

const Auth: React.FC<AuthProps> = ({
  onAuthSuccess,
  adminPortal = false,
  initialMode = 'login',
  onBack,
}) => {
  const { t } = useTranslation();
  const [mode, setMode] = useState<AuthMode>(adminPortal ? 'login' : initialMode);
  const [role, setRole] = useState<UserRole>(adminPortal ? 'ADMIN' : 'DESIGNER');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [licenseFile, setLicenseFile] = useState<File | null>(null);
  const [licensePreview, setLicensePreview] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  useEffect(() => {
    if (adminPortal) return;
    setMode(initialMode);
  }, [initialMode, adminPortal]);

  // 登录 Tab / Admin 入口 → 绑定对应 Auth storageKey（不改数据源）
  // Do NOT clear override on unmount: leaving Auth after login would reset portal to
  // path-default (designer) and break supplier RPCs on /material/:id?mode=edit.
  useEffect(() => {
    const portal = portalFromUserRole(adminPortal ? 'ADMIN' : role);
    setPortalOverride(portal === 'admin' ? null : portal);
  }, [role, adminPortal]);

  if (!isSupabaseConfigured()) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center p-6">
        <p className="text-red-500 text-center text-2xl sm:text-4xl font-black leading-tight tracking-tight select-none">
          {t('auth.configMissing')}
        </p>
      </div>
    );
  }

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError('');
    setInfo('');
    setLicenseFile(null);
    setLicensePreview('');
  };

  const showForgotLink = mode === 'login';

  const roleLabel =
    role === 'DESIGNER'
      ? t('common.designer')
      : role === 'SUPPLIER'
        ? t('common.supplier')
        : t('common.admin');

  const handleForgotSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setInfo('');
    setLoading(true);

    try {
      const trimmedEmail = email.trim();
      if (!trimmedEmail) {
        setError(t('auth.emailRequired'));
        return;
      }

      const result = await requestPasswordReset(trimmedEmail);
      if (result.ok === false) {
        setError(result.error);
        return;
      }

      setInfo(t('auth.resetSent'));
    } catch {
      setError(t('auth.sendFailed'));
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
        setError(t('auth.loginFailed'));
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
        setError(t('auth.adminNoSelfRegister'));
        return;
      }

      if (role === 'SUPPLIER') {
        const company = companyName.trim();
        if (!company) {
          setError(t('auth.companyRequired'));
          return;
        }
        if (!licenseFile) {
          setError(t('auth.licenseRequired'));
          return;
        }
        const result = await signUp(trimmedEmail, trimmedPassword, role, { company });
        if (result.ok === false) {
          setError(result.error);
          return;
        }
        try {
          const uploaded = await uploadImage(licenseFile, 'verification');
          const doc = uploaded.objectKey || uploaded.url;
          const saved = await updateVerificationRequest(result.user.id, {
            company,
            docUrl: doc,
          });
          onAuthSuccess({
            ...result.user,
            company,
            verificationDoc: saved ? doc : result.user.verificationDoc,
            isVerified: false,
            accountStatus: 'pending',
          });
        } catch {
          onAuthSuccess({
            ...result.user,
            company,
            isVerified: false,
            accountStatus: 'pending',
          });
        }
        return;
      }

      const result = await signUp(trimmedEmail, trimmedPassword, role);
      if (result.ok === false) {
        setError(result.error);
        return;
      }
      onAuthSuccess(result.user);
    } catch {
      setError(mode === 'login' ? t('auth.loginFailed') : t('auth.registerFailed'));
    } finally {
      setLoading(false);
    }
  };

  const isRegisteredRole = isRegisteredRoleError(error);

  const loadingLabel =
    mode === 'forgot'
      ? t('auth.sending')
      : mode === 'login'
        ? t('auth.verifying')
        : t('auth.creating');

  if (mode === 'forgot') {
    return (
      <AuthShell subtitle={t('auth.forgotSubtitle')}>
        {loading && <AuthSpinner label={loadingLabel} />}
        <form onSubmit={handleForgotSubmit} className="space-y-4">
          <p className="text-gray-300 text-sm text-center leading-relaxed mb-2">
            {t('auth.forgotHint')}
          </p>
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
              {t('auth.email')}
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
            loadingLabel={t('auth.sending')}
            idleLabel={t('auth.sendReset')}
          />

          <div className="text-center pt-2 space-y-3">
            <button
              type="button"
              onClick={() => switchMode('login')}
              className="text-xs font-bold text-gray-400 hover:text-white transition-colors"
            >
              {t('auth.backToLogin')}
            </button>
            {onBack && (
              <div>
                <button
                  type="button"
                  onClick={onBack}
                  className="text-xs font-bold text-gray-500 hover:text-white transition-colors"
                >
                  {t('common.backToExplore')}
                </button>
              </div>
            )}
          </div>
        </form>
      </AuthShell>
    );
  }

  return (
    <AuthShell subtitle={adminPortal ? t('auth.adminSubtitle') : undefined}>
      {loading && <AuthSpinner label={loadingLabel} />}
      {adminPortal ? (
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 bg-gray-100 px-6 py-3 rounded-2xl">
            <span className="text-lg">🛡️</span>
            <span className="text-sm font-black text-black tracking-wide">{t('auth.adminLoginBadge')}</span>
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
            {t('common.designer')}
          </button>
          <button
            type="button"
            onClick={() => {
              setRole('SUPPLIER');
              setError('');
            }}
            className={`flex-1 py-3 rounded-xl text-sm font-bold transition-all ${role === 'SUPPLIER' ? 'bg-white shadow-md text-black' : 'text-gray-400'}`}
          >
            {t('common.supplier')}
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        {mode === 'register' && role === 'SUPPLIER' && (
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
              {t('auth.companyName')}
            </label>
            <input
              required
              type="text"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder={t('auth.companyNamePlaceholder')}
              autoComplete="organization"
              className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
            />
          </div>
        )}
        <div>
          <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
            {t('auth.email')}
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
              {t('auth.password')}
            </label>
            {showForgotLink && (
              <button
                type="button"
                onClick={() => switchMode('forgot')}
                className="text-[10px] font-bold text-blue-400 hover:text-blue-300 transition-colors"
              >
                {t('auth.forgotPassword')}
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

        {mode === 'register' && role === 'SUPPLIER' && (
          <div>
            <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">
              {t('auth.businessLicense')}
            </label>
            <div className="relative aspect-video bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center overflow-hidden">
              {licensePreview ? (
                <img src={licensePreview} className="w-full h-full object-cover" alt="" />
              ) : (
                <>
                  <span className="text-3xl mb-2">📄</span>
                  <span className="text-xs text-gray-400 font-bold">{t('auth.licenseHint')}</span>
                </>
              )}
              <input
                required
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0] ?? null;
                  if (licensePreview) URL.revokeObjectURL(licensePreview);
                  setLicenseFile(file);
                  setLicensePreview(file ? URL.createObjectURL(file) : '');
                }}
                className="absolute inset-0 opacity-0 cursor-pointer"
              />
            </div>
          </div>
        )}

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
                {t('auth.roleHintLogin', { role: roleLabel })}
              </p>
            )}
            {isRegisteredRole && mode === 'register' && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                {t('auth.roleHintRegister', { role: roleLabel })}
              </p>
            )}
            {!isRegisteredRole && mode === 'register' && error.includes('该邮箱已被注册') && (
              <p className="text-red-300/90 text-xs text-center mt-2 leading-relaxed">
                {t('auth.emailTaken')}
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
          loadingLabel={mode === 'login' ? t('auth.verifying') : t('auth.creating')}
          idleLabel={mode === 'login' ? t('auth.enterNow') : t('auth.createAccount')}
          className="mt-4"
        />
      </form>

      {!adminPortal && (
        <div className="mt-8 text-center space-y-3">
          <button
            type="button"
            onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}
            className="text-xs font-bold text-gray-400 hover:text-black transition-colors"
          >
            {mode === 'login' ? t('auth.noAccount') : t('auth.hasAccount')}
          </button>
          {onBack && (
            <div>
              <button
                type="button"
                onClick={onBack}
                className="text-xs font-bold text-gray-500 hover:text-black transition-colors"
              >
                {t('common.backToExplore')}
              </button>
            </div>
          )}
        </div>
      )}
    </AuthShell>
  );
};

export default Auth;

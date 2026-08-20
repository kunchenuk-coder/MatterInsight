import React, { useState, useEffect, useRef, Component } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { User, UserRole, Material, Category, MoodBoard, PointTransaction, PendingMaterial, Inquiry, SampleRequest, MaterialStatus, AuditLog, Notification, InquiryFormPayload } from './types';
import { MOCK_MATERIALS } from './constants';
import Navbar from './components/Navbar';
import Auth from './components/Auth';
import ResetPassword from './components/ResetPassword';
import PinterestFeed from './components/PinterestFeed';
import CategoryBar from './components/CategoryBar';
import MaterialDetail from './components/MaterialDetail';
import MoodBoardDesigner from './components/MoodBoardDesigner';
import MoodBoardViewer from './components/MoodBoardViewer';
import DesignerPage from './components/DesignerPage';
import SupplierDashboard from './components/SupplierDashboard';
import DesignerDashboard from './components/DesignerDashboard';
import AdminDashboard from './components/AdminDashboard';
import RechargeModal from './components/RechargeModal';
import WhatsNewSection from './components/topics/WhatsNewSection';
import TopicArticleDetail from './components/topics/TopicArticleDetail';
import TopicArticleEditor from './components/topics/TopicArticleEditor';
import {
  clearMoodboardDraftCaches,
  estimateJsonBytes,
  isQuotaExceededError,
  LOCALSTORAGE_PAYLOAD_MAX_BYTES,
  pruneMoodboardsForQuota,
  stripLargestDrawingImages,
  toMoodboardMetaOnly,
} from './utils/moodboardStorage';
import { isSupabaseConfigured } from './services/supabaseClient';
import { restoreSession, signOut, onAuthStateChange } from './services/authService';
import { useDeviceSessionGuard } from './hooks/useDeviceSessionGuard';
import useUnreadNotifications from './hooks/useUnreadNotifications';
import { portalFromUserRole, setPortalOverride } from './utils/appPortal';
import { syncMoodboards, subscribeMoodboardChanges, fetchPublicMoodboards, withDefaultVisibility } from './services/moodboardService';
import { syncSavedMaterialIds } from './services/savedMaterialService';
import {
  submitPendingMaterial,
  approveMaterial as cloudApproveMaterial,
  rejectMaterial as cloudRejectMaterial,
  fetchSupplierMaterials,
} from './services/materialService';
import { recordPointsConsume } from './services/adminAnalyticsService';
import { pickLocale } from './utils/localizedText';
import { materialMatchesSearchQuery } from './utils/materialSearch';
import {
  createInquiry,
  createSampleRequest,
  countDesignerUnreadRequests,
  fetchInquiriesForUser,
  fetchSampleRequestsForUser,
  shipSampleRequest,
  submitInquiryQuote,
} from './services/commerceRequestService';
import { resolveProfileAvatarUrl } from './services/assetReadUrlService';
import { loadDesignerCloudData, loadGlobalCloudData } from './services/dataSyncService';
import {
  approveSupplier,
  fetchProfile,
  fetchVerificationRequestsForAdmin,
  updateVerificationRequest,
} from './services/profileService';
import {
  assertDesignerCanRequestQuoteOrSample,
  getDesignerRequestRejectionReason,
} from './services/inquiryService';
import {
  isAdminPortal,
  isAuthRoute,
  isPasswordRecoveryMode,
  lockPasswordRecoveryMode,
} from './utils/authRoutes';
import {
  guardDashboardRoute,
  redirectToRoleDashboard,
  redirectAfterAuth,
  parseAppPageRoute,
  navigateTo,
  LOGIN_PATH,
  MY_PAGE_PATH,
  DESIGNER_DASHBOARD_PATH,
  SUPPLIER_DASHBOARD_PATH,
  getDesignerPublicPath,
  getMaterialPath,
  parseMaterialId,
  parseMaterialEditMode,
  isDashboardPath,
} from './router';
import { toggleCollectMoodboard, getCollectedMoodboards } from './services/collectedMoodboardService';
import { resolveUserDisplayName } from './utils/profileDisplayName';

/** 启动诊断：确认 Vite 是否注入环境变量（构建时打入，非运行时读取 .env.local） */
console.log('[MatterInsight boot] VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL);
console.log(
  '[MatterInsight boot] VITE_SUPABASE_ANON_KEY:',
  import.meta.env.VITE_SUPABASE_ANON_KEY ? '已加载' : '未加载'
);
console.log('[MatterInsight boot] MODE:', import.meta.env.MODE, 'PROD:', import.meta.env.PROD);

// Error Boundary Component
interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white p-10 rounded-[40px] shadow-2xl text-center">
            <div className="text-4xl mb-6">⚠️</div>
            <h2 className="text-2xl font-black mb-4">{i18n.t('error.title')}</h2>
            <p className="text-gray-500 mb-8 text-sm leading-relaxed">
              {i18n.t('error.body')}
            </p>
            <button 
              onClick={() => {
                // 禁止 localStorage.clear()：会抹掉三端隔离的 auth session
                try {
                  const keys: string[] = [];
                  for (let i = 0; i < localStorage.length; i++) {
                    const k = localStorage.key(i);
                    if (!k) continue;
                    if (k.startsWith('matter_insight_') && !k.includes('_device_session_') && !k.includes('_device_type_')) {
                      keys.push(k);
                    }
                  }
                  keys.forEach((k) => localStorage.removeItem(k));
                } catch {
                  /* ignore */
                }
                window.location.reload();
              }}
              className="w-full bg-black text-white py-4 rounded-2xl font-bold shadow-xl hover:scale-[1.02] transition-all"
            >
              {i18n.t('error.clearCache')}
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="w-full mt-4 py-4 text-gray-400 font-bold hover:text-black transition-colors"
            >
              {i18n.t('error.reload')}
            </button>
            {this.state.error && (
              <details className="mt-8 text-left">
                <summary className="text-[10px] font-black uppercase text-gray-300 cursor-pointer">错误详情</summary>
                <pre className="mt-2 p-4 bg-gray-50 rounded-xl text-[10px] text-red-500 overflow-x-auto">
                  {this.state.error.message}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const App: React.FC = () => {
  const { t } = useTranslation();
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [recoveryMode, setRecoveryMode] = useState(() => isPasswordRecoveryMode());
  const [pathname, setPathname] = useState(() => window.location.pathname);
  const [locationSearch, setLocationSearch] = useState(() => window.location.search);
  const skipCloudSyncRef = useRef(true);
  const [currentView, setCurrentView] = useState<'HOME' | 'DETAILS' | 'MOODBOARD' | 'MOODBOARD_VIEW' | 'DASHBOARD'>('HOME');
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [materialDetailReturnTo, setMaterialDetailReturnTo] = useState<'home' | 'dashboard' | 'moodboard' | 'supplier'>('home');
  const [materialDetailReturnPath, setMaterialDetailReturnPath] = useState<string | null>(null);
  const materialReturnToRef = useRef<'home' | 'dashboard' | 'moodboard' | 'supplier'>('home');
  const [selectedMoodboard, setSelectedMoodboard] = useState<MoodBoard | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [sharedMaterialId, setSharedMaterialId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [points, setPoints] = useState(1000); 
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPass, setAdminPass] = useState('');
  /** 访客 Auth gate：点材料 / 顶栏登录时展示 */
  const [showAuthGate, setShowAuthGate] = useState(false);
  const [authInitialMode, setAuthInitialMode] = useState<'login' | 'register'>('login');
  const pendingMaterialIdRef = useRef<string | null>(null);
  /** 登录后库尚未就绪时，等 hydrate 再打开材料 */
  const [postAuthMaterialId, setPostAuthMaterialId] = useState<string | null>(null);
  /**
   * 探索库云端水合完成标记。
   * Supabase 模式下初始 false：禁止在材料列表到达前渲染空 Feed（防闪回旧壳）。
   */
  const [libraryHydrated, setLibraryHydrated] = useState(() => !isSupabaseConfigured());

  const {
    total: dbUnreadTotal,
    counts: dbUnreadCounts,
    refresh: refreshUnreadNotifications,
  } = useUnreadNotifications({
    userId: user?.id,
    portal: user ? portalFromUserRole(user.role) : undefined,
    enabled: Boolean(user) && isSupabaseConfigured(),
  });

  /** 设计师：小样已寄出 / 询价已报价 的未读数（is_read_by_designer=false） */
  const [designerUnreadRequests, setDesignerUnreadRequests] = useState(0);

  const refreshDesignerUnreadRequests = async () => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') {
      setDesignerUnreadRequests(0);
      return;
    }
    const n = await countDesignerUnreadRequests('designer');
    setDesignerUnreadRequests(n);
  };

  // Persistence Helpers（配额告警全局仅一次，避免 useEffect 死循环弹窗）
  const quotaAlertShownRef = useRef(false);

  const designerStorageKey = (userId: string, key: string) => `matter_insight_designer_${userId}_${key}`;

  const saveToLocal = (key: string, data: unknown, designerUserId?: string) => {
    // 材料库 / 待审：永久禁止写入 LocalStorage（防配额爆红 + 双状态幽灵）
    if (key === 'library' || key === 'pending') {
      return;
    }
    const storageKey = designerUserId ? designerStorageKey(designerUserId, key) : `matter_insight_${key}`;
    const write = (payload: unknown) => {
      const size = estimateJsonBytes(payload);
      if (size > LOCALSTORAGE_PAYLOAD_MAX_BYTES) {
        console.warn(
          "Skipped localStorage save because payload too large",
          { key: storageKey, size, max: LOCALSTORAGE_PAYLOAD_MAX_BYTES }
        );
        return;
      }
      localStorage.setItem(storageKey, JSON.stringify(payload));
    };

    try {
      write(data);
      return;
    } catch (e) {
      console.error(`Failed to save ${key} to local storage:`, e);
      if (!isQuotaExceededError(e)) return;

      try {
        localStorage.removeItem("matter_insight_notifications");
        clearMoodboardDraftCaches();
      } catch {
        /* ignore */
      }

      let payload = data;
      if (key === "moodboards" && Array.isArray(data)) {
        let boards = pruneMoodboardsForQuota(data as MoodBoard[]);
        try {
          write(boards);
          return;
        } catch {
          boards = stripLargestDrawingImages(boards, 3);
          payload = boards;
        }
      }

      try {
        write(payload);
        return;
      } catch (retryErr) {
        if (!isQuotaExceededError(retryErr)) return;
        console.warn(
          `[MatterInsight] 本地存储已满，已跳过写入 ${key}（不影响云端数据）`
        );
        if (key === 'moodboards' && designerUserId) {
          try {
            write(toMoodboardMetaOnly(payload as MoodBoard[]));
          } catch {
            /* 完全跳过，不阻断渲染 */
          }
        }
      }
    }
  };

  const getFromLocal = (key: string, designerUserId?: string) => {
    try {
      const saved = localStorage.getItem(
        designerUserId ? designerStorageKey(designerUserId, key) : `matter_insight_${key}`
      );
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error(`Failed to load ${key} from local storage:`, e);
      return null;
    }
  };

  // States with Persistence
  // Supabase 模式：材料库/待审禁止 LocalStorage 水合（防待审+已通过双状态）
  const [library, setLibrary] = useState<Material[]>(() => {
    if (isSupabaseConfigured()) return [];
    const saved = getFromLocal('library');
    if (!saved) return MOCK_MATERIALS;
    return saved.map((m: any) => ({
      ...m,
      variants: m.variants || [],
      clicks: m.clicks || 0,
      saves: m.saves || 0
    }));
  });
  const [pendingMaterials, setPendingMaterials] = useState<PendingMaterial[]>(() => {
    if (isSupabaseConfigured()) return [];
    const saved = getFromLocal('pending');
    if (!saved) return [];
    return saved.map((m: any) => ({
      ...m,
      variants: m.variants || [],
      clicks: m.clicks || 0,
      saves: m.saves || 0
    }));
  });
  // Supabase 模式下禁止用 LocalStorage 初始化业务单，避免空数组/脏数据盖住云端结果
  const [inquiries, setInquiries] = useState<Inquiry[]>(() =>
    isSupabaseConfigured() ? [] : getFromLocal('inquiries') || []
  );
  const [sampleRequests, setSampleRequests] = useState<SampleRequest[]>(() =>
    isSupabaseConfigured() ? [] : getFromLocal('samples') || []
  );
  const [moodboards, setMoodboards] = useState<MoodBoard[]>([]);
  const [publicMoodboards, setPublicMoodboards] = useState<MoodBoard[]>([]);
  const [collectedMoodboardIds, setCollectedMoodboardIds] = useState<string[]>([]);
  const [notifications, setNotifications] = useState<Notification[]>(() => getFromLocal('notifications') || []);
  const [activeMoodboardId, setActiveMoodboardId] = useState<string>('');
  const [savedMaterialIds, setSavedMaterialIds] = useState<string[]>([]);
  const [verificationRequests, setVerificationRequests] = useState<User[]>(() =>
    isSupabaseConfigured() ? [] : getFromLocal('verifications') || []
  );
  const [verifiedUserIds, setVerifiedUserIds] = useState<string[]>(() => getFromLocal('verified_ids') || []);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [showWelcomeBonus, setShowWelcomeBonus] = useState(false);
  const savedIdsRef = useRef<string[]>([]);
  const prevPathnameRef = useRef(pathname);
  const pageRoute = parseAppPageRoute(pathname);
  const onProfilePage = pageRoute.type === 'my-page' || pageRoute.type === 'designer';

  const goToExploreLibrary = () => {
    // 探索库首页是 `/`，不是 /login（保护先逛后登录）
    if (
      onProfilePage ||
      isDashboardPath(pathname) ||
      isAuthRoute(pathname) ||
      pageRoute.type === 'topic' ||
      pageRoute.type === 'supplier-topic-editor'
    ) {
      navigateTo('/', true);
    }
    setSelectedMaterial(null);
    setSelectedMoodboard(null);
    setCurrentView('HOME');
  };

  const leaveProfilePages = () => {
    goToExploreLibrary();
  };

  const openAuthGate = (mode: 'login' | 'register', materialId: string | null = null) => {
    pendingMaterialIdRef.current = materialId;
    setAuthInitialMode(mode);
    setShowAuthGate(true);
  };

  const closeAuthGate = () => {
    pendingMaterialIdRef.current = null;
    setShowAuthGate(false);
  };

  const openMoodboardFromFeed = (board: MoodBoard) => {
    if (pageRoute.type !== 'designer' && pageRoute.type !== 'my-page') {
      navigateTo(DESIGNER_DASHBOARD_PATH, true);
    }
    setSelectedMoodboard(board);
    setCurrentView('MOODBOARD_VIEW');
  };

  const handleFindSimilar = (name: string) => {
    setSearchTerm(name);
    leaveProfilePages();
    setSelectedMoodboard(null);
    setCurrentView('HOME');
  };

  const openMaterialDetail = (
    material: Material,
    returnTo: 'home' | 'dashboard' | 'moodboard' | 'supplier' = 'home',
    options?: { mode?: 'edit' }
  ) => {
    materialReturnToRef.current = returnTo;
    setMaterialDetailReturnTo(returnTo);
    setMaterialDetailReturnPath(returnTo === 'moodboard' ? pathname : null);
    setSelectedMaterial(material);
    navigateTo(getMaterialPath(material.id, options));
    setCurrentView('DETAILS');
    // 浏览次数由 MaterialDetail → increment_material_view_count RPC 真实写入
  };

  const closeMaterialDetail = () => {
    const returnTo = materialReturnToRef.current;
    setSelectedMaterial(null);

    if (returnTo === 'moodboard') {
      setCurrentView('MOODBOARD_VIEW');
      if (materialDetailReturnPath) {
        navigateTo(materialDetailReturnPath);
      } else {
        navigateTo('/');
      }
      return;
    }

    if (returnTo === 'dashboard') {
      navigateTo(DESIGNER_DASHBOARD_PATH);
      setCurrentView('DASHBOARD');
      return;
    }

    if (returnTo === 'supplier') {
      navigateTo(SUPPLIER_DASHBOARD_PATH);
      setCurrentView('DASHBOARD');
      return;
    }

    navigateTo('/');
    setCurrentView('HOME');
  };

  const handleToggleCollectMoodboard = async (moodboardId: string) => {
    if (!user || user.role !== 'DESIGNER') return;
    const result = await toggleCollectMoodboard(user.id, moodboardId);
    if (!result.ok) {
      window.alert(result.error);
      return;
    }
    setCollectedMoodboardIds((prev) =>
      result.collected
        ? [...new Set([...prev, moodboardId])]
        : prev.filter((id) => id !== moodboardId)
    );
  };
  const moodboardsRef = useRef<MoodBoard[]>([]);
  const libraryRef = useRef<Material[]>([]);

  savedIdsRef.current = savedMaterialIds;
  moodboardsRef.current = moodboards;
  libraryRef.current = library;

  const resumeMaterialAfterAuth = (materialId: string) => {
    materialReturnToRef.current = 'home';
    setMaterialDetailReturnTo('home');
    setMaterialDetailReturnPath(null);
    navigateTo(getMaterialPath(materialId), true);
    setCurrentView('DETAILS');
    const mat = libraryRef.current.find((m) => m.id === materialId);
    if (mat) {
      setSelectedMaterial(mat);
      setPostAuthMaterialId(null);
    } else {
      setPostAuthMaterialId(materialId);
    }
  };

  /** 单设备顶号守卫：互踢「全退」后由 hook 硬跳 /login；此处只清 React 状态 */
  useDeviceSessionGuard(user?.id, () => {
    setUser(null);
    setSavedMaterialIds([]);
    setMoodboards([]);
    setActiveMoodboardId('');
    setPendingMaterials([]);
    setSelectedMaterial(null);
    setSelectedMoodboard(null);
  });

  /**
   * Keep Auth portal aligned with the logged-in role.
   * Material edit URLs (`/material/:id?mode=edit`) are not supplier-dashboard paths;
   * without this override getAppPortal() defaults to designer and RPCs use the wrong JWT.
   */
  useEffect(() => {
    if (!user) {
      setPortalOverride(null);
      return;
    }
    const portal = portalFromUserRole(user.role);
    setPortalOverride(portal === 'admin' ? null : portal);
    console.info('[MatterInsight] portal bound to session', {
      userId: user.id,
      role: user.role,
      dbRole: user.dbRole,
      portal: portal === 'admin' ? 'admin(host/path)' : portal,
    });
  }, [user?.id, user?.role, user?.dbRole]);

  /** 运营后台：从 Supabase 拉取待认证供应商（跨设备同步，不依赖 localStorage） */
  const refreshVerificationRequestsFromCloud = async () => {
    if (!isSupabaseConfigured()) return;
    const rows = await fetchVerificationRequestsForAdmin();
    setVerificationRequests(rows);
  };

  const defaultMoodboardsFor = (userId: string): MoodBoard[] => [
    { id: `mb_${userId}_default`, name: t('moodboard.defaultName'), items: [], isPaid: false, maxMaterials: 10, visibility: 'private' },
  ];

  /** 先用本地缓存进入主页，不等待云端同步 */
  const enterAuthenticatedSession = (userData: User): boolean => {
    // Admin 入口：非 admin → 只拒绝挂载，禁止 signOut（保护其他 portal session）
    if (isAdminPortal() && userData.dbRole !== 'admin') {
      console.info('[MatterInsight] 非 admin 账号不能进入管理入口（未清除 session）');
      return false;
    }
    // 普通入口：拒绝挂载 admin 身份 UI，不 signOut
    if (!isAdminPortal() && userData.dbRole === 'admin') {
      console.info(
        '[MatterInsight] admin 会话请使用 /admin；当前为 Designer/Supplier 入口（未清除 session）'
      );
      return false;
    }

    const resumeMaterialId = pendingMaterialIdRef.current;
    pendingMaterialIdRef.current = null;
    setShowAuthGate(false);

    skipCloudSyncRef.current = true;
    setPoints(userData.points);
    setCurrentView(resumeMaterialId ? 'DETAILS' : 'DASHBOARD');

    if (userData.dbRole === 'designer') {
      const boards =
        (getFromLocal('moodboards', userData.id) || defaultMoodboardsFor(userData.id)).map(
          withDefaultVisibility
        );
      const collections = getFromLocal('saved_ids', userData.id) || [];
      setUser({ ...userData, collections, transactions: userData.transactions || [] });
      setSavedMaterialIds(collections);
      setMoodboards(boards);
      setActiveMoodboardId(boards[0]?.id ?? '');
    } else {
      setUser({ ...userData, collections: [], transactions: userData.transactions || [] });
      setSavedMaterialIds([]);
      setMoodboards([]);
      setActiveMoodboardId('');
    }

    if (resumeMaterialId) {
      resumeMaterialAfterAuth(resumeMaterialId);
      return true;
    }

    const landingRoute = parseAppPageRoute(window.location.pathname);
    if (landingRoute.type === 'topic') {
      setCurrentView('HOME');
      return true;
    }
    if (landingRoute.type === 'supplier-topic-editor') {
      if (userData.dbRole !== 'supplier') {
        if (!redirectAfterAuth(userData.dbRole, true)) {
          setUser(null);
          return false;
        }
        return true;
      }
      setCurrentView('DASHBOARD');
      return true;
    }

    if (!redirectAfterAuth(userData.dbRole, true)) {
      // 权限/入口不符：卸下 UI，禁止 signOut
      setUser(null);
      return false;
    }
    return true;
  };

  /** 从 Supabase 拉取询价/小样（设计师 / 材料商 / 管理员） */
  const hydrateCommerceRequests = async (userData: User) => {
    if (!isSupabaseConfigured()) return;
    const role =
      userData.dbRole === 'supplier'
        ? 'supplier'
        : userData.dbRole === 'admin'
          ? 'admin'
          : 'designer';
    // 必须用角色对应 portal 的 JWT；勿用 getAppPortal()（刷新路径可能落到 designer）
    const portal = portalFromUserRole(userData.role);
    console.info('[MatterInsight] hydrateCommerceRequests start', {
      userId: userData.id,
      role,
      portal,
      uiRole: userData.role,
      dbRole: userData.dbRole,
    });

    try {
      localStorage.removeItem('matter_insight_samples');
      localStorage.removeItem('matter_insight_inquiries');
    } catch {
      /* ignore */
    }

    const [cloudInquiries, cloudSamples] = await Promise.all([
      fetchInquiriesForUser({ userId: userData.id, role, portal }),
      fetchSampleRequestsForUser({ userId: userData.id, role, portal }),
    ]);

    console.info('[MatterInsight] hydrateCommerceRequests done', {
      inquiries: cloudInquiries.length,
      samples: cloudSamples.length,
      sampleIds: cloudSamples.map((s) => s.id),
      sampleSupplierIds: cloudSamples.map((s) => s.supplierId),
    });

    setInquiries(cloudInquiries);
    setSampleRequests(cloudSamples);
  };

  /** 后台拉取云端数据并合并（登录 / 刷新恢复共用） */
  const hydrateCloudDataInBackground = async (userData: User) => {
    try {
      if (userData.dbRole === 'designer') {
        const [cloud, cloudGlobal] = await Promise.all([
          loadDesignerCloudData(userData.id),
          loadGlobalCloudData(),
        ]);
        // 云端为准：空数组也必须覆盖本地，禁止残留待审幽灵
        setLibrary(cloudGlobal.library);
        setPendingMaterials(cloudGlobal.pendingMaterials);
        setLibraryHydrated(true);

        const boards = (
          cloud.moodboards.length > 0
            ? cloud.moodboards
            : getFromLocal('moodboards', userData.id) || defaultMoodboardsFor(userData.id)
        ).map(withDefaultVisibility);
        const collections =
          cloud.savedMaterialIds.length > 0
            ? cloud.savedMaterialIds
            : getFromLocal('saved_ids', userData.id) || [];
        setUser((prev) =>
          prev?.id === userData.id ? { ...prev, collections } : prev
        );
        setSavedMaterialIds(collections);
        setMoodboards(boards);
        setActiveMoodboardId(boards[0]?.id ?? '');
        await hydrateCommerceRequests(userData);
      } else if (userData.dbRole === 'admin') {
        const cloudGlobal = await loadGlobalCloudData();
        setLibrary(cloudGlobal.library);
        setPendingMaterials(cloudGlobal.pendingMaterials);
        setLibraryHydrated(true);
        await refreshVerificationRequestsFromCloud();
        await hydrateCommerceRequests(userData);
      } else {
        // 材料商：显式按 supplier_id 拉自己的待审；探索库仍用已发布全局列表
        const [supplierMats, cloudGlobal] = await Promise.all([
          fetchSupplierMaterials(userData.id),
          loadGlobalCloudData(),
        ]);
        setLibrary(cloudGlobal.library);
        setPendingMaterials(supplierMats.pending);
        setLibraryHydrated(true);
        await hydrateCommerceRequests(userData);
      }
    } catch (err) {
      console.error('[MatterInsight] 云端数据同步失败:', err);
      setLibraryHydrated(true);
    } finally {
      setTimeout(() => {
        skipCloudSyncRef.current = false;
      }, 500);
    }
  };

  useEffect(() => {
    setUser((u) => (u ? { ...u, collections: savedMaterialIds } : u));
  }, [savedMaterialIds]);

  /** 管理员登录后及页面重新可见时刷新认证列表 */
  useEffect(() => {
    if (!isSupabaseConfigured() || user?.role !== 'ADMIN') return;

    void refreshVerificationRequestsFromCloud();

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void refreshVerificationRequestsFromCloud();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user?.role, user?.id]);

  /** 监听浏览器路径（角色仪表板路由） */
  useEffect(() => {
    const onPathChange = () => {
      setPathname(window.location.pathname);
      setLocationSearch(window.location.search);
    };
    window.addEventListener('popstate', onPathChange);
    return () => window.removeEventListener('popstate', onPathChange);
  }, []);

  /** 材料详情页 URL 同步 */
  useEffect(() => {
    if (!user) return;

    const materialId = parseMaterialId(pathname);
    const wasMaterial = parseMaterialId(prevPathnameRef.current);

    if (materialId) {
      const material = library.find((m) => m.id === materialId);
      if (material) {
        setSelectedMaterial(material);
        setCurrentView('DETAILS');
      }
    } else if (wasMaterial) {
      setSelectedMaterial(null);
      const returnTo = materialReturnToRef.current;
      if (returnTo === 'moodboard') {
        setCurrentView('MOODBOARD_VIEW');
      } else if (returnTo === 'dashboard' || isDashboardPath(pathname)) {
        setCurrentView('DASHBOARD');
      } else {
        setCurrentView('HOME');
      }
    }

    prevPathnameRef.current = pathname;
  }, [pathname, library, user?.id]);

  /** 已登录用户的路由守卫：role/path 不匹配只 redirect，禁止 signOut */
  useEffect(() => {
    if (!user || recoveryMode || isPasswordRecoveryMode()) return;
    guardDashboardRoute(user.dbRole);
  }, [user, pathname, recoveryMode]);

  /** 管理员入口：非 admin 只卸 UI；admin 登录后进入 /admin-dashboard */
  useEffect(() => {
    if (!user || recoveryMode || isPasswordRecoveryMode()) return;
    if (!isAdminPortal()) return;

    if (user.dbRole !== 'admin') {
      setUser(null);
      return;
    }

    if (!isDashboardPath(pathname)) {
      redirectAfterAuth('admin', true);
      setCurrentView('DASHBOARD');
    }
  }, [user, pathname, recoveryMode]);

  /** recovery 模式：最高优先级，禁止 session 恢复进主页 */
  useEffect(() => {
    const syncRecovery = () => {
      const active = isPasswordRecoveryMode();
      setRecoveryMode(active);
      if (active) {
        setUser(null);
        setSavedMaterialIds([]);
        setMoodboards([]);
        setActiveMoodboardId('');
      }
    };

    syncRecovery();
    window.addEventListener('hashchange', syncRecovery);
    window.addEventListener('popstate', syncRecovery);
    return () => {
      window.removeEventListener('hashchange', syncRecovery);
      window.removeEventListener('popstate', syncRecovery);
    };
  }, []);

  /** Supabase Session 恢复与监听 */
  useEffect(() => {
    console.log('App rendered');

    if (!isSupabaseConfigured()) {
      console.warn('[MatterInsight] Supabase 未配置，跳过 session 恢复');
      setAuthReady(true);
      return;
    }

    if (isPasswordRecoveryMode()) {
      lockPasswordRecoveryMode(true);
      setRecoveryMode(true);
      setUser(null);
      setAuthReady(true);
      return;
    }

    let cancelled = false;
    const AUTH_BOOT_TIMEOUT_MS = 10_000;
    const bootTimeout = window.setTimeout(() => {
      if (!cancelled) {
        console.warn('[MatterInsight] session 恢复超时，强制展示登录页');
        setAuthReady(true);
      }
    }, AUTH_BOOT_TIMEOUT_MS);

    (async () => {
      try {
        const restored = await restoreSession();
        if (!cancelled && restored) {
          if (enterAuthenticatedSession(restored)) {
            void hydrateCloudDataInBackground(restored);
          }
        }
      } catch (err) {
        console.error('[MatterInsight] session 恢复失败，回退到登录页:', err);
      } finally {
        if (!cancelled) setAuthReady(true);
        window.clearTimeout(bootTimeout);
      }
    })();

    let unsub = () => {};
    try {
      unsub = onAuthStateChange((nextUser) => {
        if (isPasswordRecoveryMode()) {
          setUser(null);
          return;
        }
        if (!nextUser) {
          setUser(null);
          setSavedMaterialIds([]);
          setMoodboards([]);
          setActiveMoodboardId('');
          setPendingMaterials([]);
          // Session 失效且仍在受保护路径：硬跳独立登录页，禁止静默留在后台
          const path = window.location.pathname;
          if (
            isDashboardPath(path) ||
            parseAppPageRoute(path).type === 'my-page' ||
            parseAppPageRoute(path).type === 'supplier-topic-editor'
          ) {
            window.location.replace(LOGIN_PATH);
          }
        }
      });
    } catch (err) {
      console.error('[MatterInsight] onAuthStateChange 注册失败:', err);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(bootTimeout);
      unsub();
    };
  }, []);

  /** 设计师数据同步到 Supabase（防抖，避免与主页加载争抢连接） */
  useEffect(() => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') return;
    if (skipCloudSyncRef.current) return;

    const timer = window.setTimeout(() => {
      if (skipCloudSyncRef.current) return;
      void syncMoodboards(
        user.id,
        moodboards.filter((b) => !b.ownerId || b.ownerId === user.id)
      );
    }, 2000);

    return () => window.clearTimeout(timer);
  }, [moodboards, user?.id, user?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') return;
    void syncSavedMaterialIds(user.id, savedMaterialIds);
  }, [savedMaterialIds, user?.id, user?.role]);

  /** 多端 Realtime：情绪板名字 / 新建 / 删除免刷新同步 */
  useEffect(() => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') return;

    const unsubscribe = subscribeMoodboardChanges(user.id, ({ event, board }) => {
      skipCloudSyncRef.current = true;

      setMoodboards((prev) => {
        if (event === 'DELETE') {
          if (prev.length <= 1) return prev;
          const next = prev.filter((b) => b.id !== board.id);
          setActiveMoodboardId((current) =>
            current === board.id ? (next[0]?.id ?? '') : current
          );
          return next;
        }

        const existing = prev.find((b) => b.id === board.id);

        if (event === 'INSERT') {
          if (existing) return prev;
          return [...prev, board];
        }

        // UPDATE：合并名字与可见性，避免覆盖本端未同步的画布 items
        if (!existing) return [...prev, board];
        if (
          existing.name === board.name &&
          (existing.visibility ?? 'private') === (board.visibility ?? 'private') &&
          (existing.isPublished ?? false) === (board.isPublished ?? false) &&
          existing.publishedAt === board.publishedAt
        ) {
          return prev;
        }
        return prev.map((b) =>
          b.id === board.id
            ? {
                ...b,
                name: board.name,
                visibility: board.visibility ?? b.visibility,
                isPublished: board.isPublished ?? b.isPublished,
                publishedAt: board.publishedAt ?? b.publishedAt,
              }
            : b
        );
      });

      window.setTimeout(() => {
        skipCloudSyncRef.current = false;
      }, 500);
    });

    return unsubscribe;
  }, [user?.id, user?.role]);

  /** 探索页：已发布公开情绪板（混入瀑布流） */
  const refreshPublicMoodboards = () => {
    if (!isSupabaseConfigured()) return;
    void fetchPublicMoodboards().then(setPublicMoodboards);
  };

  useEffect(() => {
    if (!isSupabaseConfigured() || currentView !== 'HOME') return;

    let cancelled = false;
    void fetchPublicMoodboards()
      .then((boards) => {
        if (!cancelled) setPublicMoodboards(boards);
      });

    return () => {
      cancelled = true;
    };
  }, [currentView, user?.id]);

  /** 访客 / 已登录共用：拉取已发布材料库；完成前不渲染探索 Feed */
  useEffect(() => {
    if (!authReady || isAdminPortal() || !isSupabaseConfigured()) return;
    // 已登录走 hydrateCloudDataInBackground，避免重复拉取闪烁
    if (user) return;

    let cancelled = false;
    void loadGlobalCloudData()
      .then((cloudGlobal) => {
        if (cancelled) return;
        setLibrary(cloudGlobal.library);
        setLibraryHydrated(true);
      })
      .catch((err) => {
        console.error('[MatterInsight] 访客材料库加载失败:', err);
        if (!cancelled) setLibraryHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [authReady, user]);

  /** 访客：工作台强制 /login；公开材料/设计师页回探索库（先逛后登录） */
  useEffect(() => {
    if (!authReady || user || isAdminPortal() || showAuthGate) return;
    if (isAuthRoute(pathname)) return;
    const route = parseAppPageRoute(pathname);
    if (route.type === 'dashboard' || route.type === 'my-page' || route.type === 'supplier-topic-editor') {
      window.location.replace(LOGIN_PATH);
      return;
    }
    if (route.type === 'designer' || route.type === 'material') {
      navigateTo('/', true);
      setCurrentView('HOME');
      setSelectedMaterial(null);
      setSelectedMoodboard(null);
    }
  }, [authReady, user, pathname, showAuthGate]);

  /** 登录后来自材料点击：库 hydrate 后打开详情 */
  useEffect(() => {
    if (!user || !postAuthMaterialId) return;
    const mat = library.find((m) => m.id === postAuthMaterialId);
    if (!mat) return;
    setSelectedMaterial(mat);
    setCurrentView('DETAILS');
    navigateTo(getMaterialPath(mat.id), true);
    setPostAuthMaterialId(null);
  }, [user, postAuthMaterialId, library]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') {
      setCollectedMoodboardIds([]);
      return;
    }
    void getCollectedMoodboards(user.id).then((boards) => {
      setCollectedMoodboardIds(boards.map((b) => b.id));
    });
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !user || user.role !== 'DESIGNER') return;

    let cancelled = false;
    void (async () => {
      const profile = await fetchProfile(user.id);
      if (cancelled || !profile) return;
      const avatar = await resolveProfileAvatarUrl(profile.avatar);
      const company = profile.company?.trim() || undefined;
      const name = resolveUserDisplayName({ company: profile.company, email: profile.email });
      setUser((prev) => {
        if (!prev) return prev;
        if (prev.avatar === avatar && prev.company === company && prev.name === name) return prev;
        return { ...prev, avatar, company, name };
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role]);

  useEffect(() => {
    if (!user || user.role !== 'DESIGNER' || !isSupabaseConfigured()) {
      setDesignerUnreadRequests(0);
      return;
    }
    void refreshDesignerUnreadRequests();
  }, [user?.id, user?.role, sampleRequests, inquiries]);

  useEffect(() => {
    if (user && currentView === 'MOODBOARD' && user.role !== 'DESIGNER') {
      setCurrentView('HOME');
    }
  }, [user, currentView]);

  useEffect(() => {
    // Check for shared material in hash
    const hash = window.location.hash;
    if (hash.startsWith('#/share/')) {
      const id = hash.replace('#/share/', '');
      setSharedMaterialId(id);
    }
  }, []);

  // Persistence Effect：材料库/待审永不回写；Supabase 下其它业务单也不回写
  useEffect(() => {
    if (!isSupabaseConfigured()) {
      saveToLocal('inquiries', inquiries);
      saveToLocal('samples', sampleRequests);
      saveToLocal('verifications', verificationRequests);
    }
    saveToLocal('notifications', notifications);
    if (user?.role === 'DESIGNER') {
      saveToLocal('moodboards', pruneMoodboardsForQuota(moodboards), user.id);
      saveToLocal('saved_ids', savedMaterialIds, user.id);
    }
    saveToLocal('verified_ids', verifiedUserIds);
  }, [inquiries, sampleRequests, moodboards, notifications, savedMaterialIds, verificationRequests, verifiedUserIds, user]);

  /** 启动时物理清除历史材料缓存（无论是否已禁用写入） */
  useEffect(() => {
    try {
      localStorage.removeItem('matter_insight_library');
      localStorage.removeItem('matter_insight_pending');
    } catch {
      /* ignore */
    }
  }, []);

  /** 进入材料商/运营工作台时强制重拉云端小样与询价 */
  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;
    if (currentView !== 'DASHBOARD') return;
    if (user.dbRole !== 'supplier' && user.dbRole !== 'admin' && user.role !== 'DESIGNER') return;
    void hydrateCommerceRequests(user);
  }, [user?.id, user?.dbRole, currentView]);

  const addNotification = (userId: string, title: string, content: string, type: Notification['type'] = 'SYSTEM') => {
    const newNotif: Notification = {
      id: `notif_${Date.now()}`,
      userId,
      title,
      content,
      date: new Date().toISOString(),
      isRead: false,
      type
    };
    setNotifications(prev => [newNotif, ...prev]);
  };

  const handleApproveMaterial = async (id: string, comment: string = '审核通过') => {
    const pending = pendingMaterials.find(p => p.id === id);
    if (pending) {
      const auditEntry: AuditLog = {
        date: new Date().toISOString(),
        action: 'APPROVE',
        comment,
        operatorId: user?.id || 'admin'
      };

      const newMat: Material = {
        ...pending,
        status: MaterialStatus.PUBLISHED,
        auditLog: [...pending.auditLog, auditEntry],
        clicks: 0,
        saves: 0,
        savedBy: [],
        ratings: { aesthetic: 0, durable: 0, service: 0, cleanliness: 0, recommendation: 0 },
        pointsNeeded: { sample: 10, board: 20, export: 20 },
        isAcknowledged: false
      };
      setLibrary(prev => [...prev, newMat]);
      setPendingMaterials(prev => prev.filter(p => p.id !== id));
      addNotification(pending.submitterId, '材料审核通过', `您的材料 "${pickLocale(pending.name, 'zh')}" 已审核通过并发布。`, 'AUDIT');
      if (isSupabaseConfigured()) {
        await cloudApproveMaterial(id, newMat);
      }
      alert(`材料 "${newMat.name}" 已通过审核并上架！`);
    }
  };

  const handleRejectMaterial = async (id: string, comment: string = '不符合上架标准') => {
    const pending = pendingMaterials.find(p => p.id === id);
    if (pending) {
      const auditEntry: AuditLog = {
        date: new Date().toISOString(),
        action: 'REJECT',
        comment,
        operatorId: user?.id || 'admin'
      };
      const rejected: PendingMaterial = {
        ...pending,
        status: MaterialStatus.REJECTED,
        auditLog: [...pending.auditLog, auditEntry],
        isAcknowledged: false,
      };
      setPendingMaterials(prev => prev.map(p => 
        p.id === id ? rejected : p
      ));
      addNotification(pending.submitterId, '材料审核驳回', `您的材料 "${pickLocale(pending.name, 'zh')}" 审核未通过。原因：${comment}`, 'AUDIT');
      if (isSupabaseConfigured()) {
        await cloudRejectMaterial(id, rejected);
      }
      alert('申请已驳回');
    }
  };

  const handleAuthSuccess = (userData: User) => {
    if (isPasswordRecoveryMode()) return;
    if (!isSupabaseConfigured()) return;
    if (!enterAuthenticatedSession(userData)) return;

    void hydrateCloudDataInBackground(userData);

    if ((userData as User & { showWelcomeBonus?: boolean }).showWelcomeBonus) {
      setShowWelcomeBonus(true);
    }
  };

  const handleSubmitMaterialForReview = async (mat: PendingMaterial) => {
    setPendingMaterials(prev => [...prev, mat]);
    if (isSupabaseConfigured() && user) {
      await submitPendingMaterial(user.id, mat);
    }
  };

  const handleAdminAuth = () => {
    alert('请使用登录页的邮箱与密码登录管理员账号（已接入 Supabase 鉴权，不再支持本地口令 bypass）。');
    setShowAdminLogin(false);
    setAdminPass('');
  };

  /** 仅写入「我的收藏」与 user.collections，不创建或修改情绪板 */
  const handleToggleCollect = (matId: string) => {
    if (user?.role !== 'DESIGNER') return;
    const prev = savedIdsRef.current;
    const removing = prev.includes(matId);
    const next = removing ? prev.filter((id) => id !== matId) : [...prev, matId];
    setSavedMaterialIds(next);
    savedIdsRef.current = next;
    setLibrary((prevLib) =>
      prevLib.map((m) =>
        m.id === matId ? { ...m, saves: Math.max(0, removing ? m.saves - 1 : m.saves + 1) } : m
      )
    );
  };

  const handleRemoveFromCollect = (matId: string) => {
    const prev = savedIdsRef.current;
    if (!prev.includes(matId)) return;
    const next = prev.filter((id) => id !== matId);
    setSavedMaterialIds(next);
    savedIdsRef.current = next;
    setLibrary((prevLib) =>
      prevLib.map((m) => (m.id === matId ? { ...m, saves: Math.max(0, m.saves - 1) } : m))
    );
  };

  /** 仅将材料加入指定情绪板（或用户显式命名的新板），不写入收藏库 */
  const handleAddToMoodboard = (matId: string, moodboardId?: string, newMoodboardName?: string) => {
    if (!moodboardId && !newMoodboardName?.trim()) return;

    let boards = [...moodboardsRef.current];
    let targetMbId = moodboardId;
    const trimmedNewName = newMoodboardName?.trim();

    if (!targetMbId && trimmedNewName) {
      const newMb: MoodBoard = {
        id: `mb_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name: trimmedNewName,
        items: [],
        maxMaterials: 10,
        isPaid: false,
        visibility: 'private',
      };
      boards = [...boards, newMb];
      targetMbId = newMb.id;
    }

    const mat = libraryRef.current.find((m) => m.id === matId);
    let duplicate = false;
    let applied = false;

    boards = boards.map((mb) => {
      if (mb.id !== targetMbId) return mb;
      if (mb.items.some((item) => item.materialId === matId)) {
        duplicate = true;
        return mb;
      }
      applied = true;
      const newItem = {
        id: `item_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        materialId: matId,
        type: 'material' as const,
        x: 50 + mb.items.length * 10,
        y: 50 + mb.items.length * 10,
        width: 200,
        height: 200,
        zIndex: mb.items.length + 1,
        remark: mat ? pickLocale(mat.name) : '',
      };
      return { ...mb, items: [...mb.items, newItem] };
    });

    if (duplicate) {
      return;
    }
    if (!applied) {
      return;
    }
    setMoodboards(boards);
    moodboardsRef.current = boards;
  };

  /** 仅 id：切换收藏；带情绪板参数：仅加入情绪板 */
  const handleSaveMaterial = (matId: string, moodboardId?: string, newMoodboardName?: string) => {
    if (user?.role !== 'DESIGNER') return;
    if (!moodboardId && !newMoodboardName) {
      handleToggleCollect(matId);
      return;
    }
    handleAddToMoodboard(matId, moodboardId, newMoodboardName);
  };

  const handlePointChange = (amount: number, desc: string) => {
    setPoints(p => p + amount);
    if (user) {
      const newTransaction: PointTransaction = {
        id: Math.random().toString(),
        amount,
        date: new Date().toISOString(),
        description: desc
      };
      setUser({ ...user, transactions: [...(user.transactions || []), newTransaction] });
    }
  };

  const handleRecharge = (amount: number) => {
    handlePointChange(amount, '积分充值');
    setIsRechargeModalOpen(false);
    alert(t('recharge.success', { amount }));
  };

  const handleInquiry = async (
    materialId: string,
    payloadOrMoodBoardId: string | InquiryFormPayload,
    notes?: string
  ): Promise<boolean> => {
    const material = library.find((m) => m.id === materialId);
    if (!material || !user) return false;
    if (!assertDesignerCanRequestQuoteOrSample(user)) {
      const reason = getDesignerRequestRejectionReason(user);
      if (reason === 'supplier') {
        console.warn('[MatterInsight] 材料商账户不可发起询价申请');
      }
      return false;
    }
    if (!material.supplierId) {
      alert('该材料缺少供应商信息，无法询价');
      return false;
    }

    const structured: InquiryFormPayload =
      typeof payloadOrMoodBoardId === 'string'
        ? {
            moodBoardId: payloadOrMoodBoardId,
            remarks: notes,
            projectName:
              payloadOrMoodBoardId === 'STANDALONE' ? undefined : '情绪板询价',
          }
        : payloadOrMoodBoardId;

    if (!isSupabaseConfigured()) {
      const newInquiry: Inquiry = {
        id: `inq_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
        materialId,
        designerId: user.id,
        supplierId: material.supplierId,
        moodBoardId: structured.moodBoardId || 'STANDALONE',
        status: 'PENDING',
        submitDate: new Date().toISOString(),
        designerNotes: structured.remarks || notes,
        projectName: structured.projectName,
        projectLocation: structured.projectLocation,
        estimatedArea: structured.estimatedArea ?? undefined,
        deliveryDate: structured.deliveryDate ?? undefined,
      };
      setInquiries((prev) => [newInquiry, ...prev]);
      return true;
    }

    const result = await createInquiry({
      materialId,
      supplierId: material.supplierId,
      designerId: user.id,
      moodBoardId: structured.moodBoardId,
      projectName: structured.projectName,
      projectLocation: structured.projectLocation,
      estimatedArea: structured.estimatedArea,
      deliveryDate: structured.deliveryDate,
      remarks: structured.remarks || notes,
    });

    if (!result.ok) {
      console.error('[MatterInsight] createInquiry failed:', result.error);
      return false;
    }

    setInquiries((prev) => [result.inquiry, ...prev.filter((i) => i.id !== result.inquiry.id)]);
    void refreshUnreadNotifications();
    return true;
  };

  const handleQuote = async (inquiryId: string, price: string, notes: string) => {
    const existing = inquiries.find((i) => i.id === inquiryId);
    if (!existing) return;

    if (!isSupabaseConfigured()) {
      setInquiries((prev) =>
        prev.map((inq) => {
          if (inq.id !== inquiryId) return inq;
          const historyEntry = { price, date: new Date().toISOString(), notes };
          return {
            ...inq,
            status: 'QUOTED' as const,
            quotePrice: price,
            notes,
            totalPrice: (parseFloat(price) * (inq.estimatedArea || 150)).toString(),
            history: [...(inq.history || []), historyEntry],
          };
        })
      );
      return;
    }

    const result = await submitInquiryQuote({
      inquiryId,
      price,
      note: notes,
      designerId: existing.designerId,
      materialId: existing.materialId,
      portal: 'supplier',
    });

    if (!result.ok) {
      alert(`报价提交失败：${result.error}`);
      return;
    }

    setInquiries((prev) =>
      prev.map((inq) => (inq.id === inquiryId ? result.inquiry : inq))
    );
    void refreshUnreadNotifications();
  };

  const handleSampleRequest = async (
    materialId: string,
    address: string,
    contactName: string,
    phone: string
  ): Promise<boolean> => {
    const material = library.find((m) => m.id === materialId);
    if (!user || !material) return false;
    if (!assertDesignerCanRequestQuoteOrSample(user)) {
      const reason = getDesignerRequestRejectionReason(user);
      if (reason === 'supplier') {
        console.warn('[MatterInsight] 材料商账户不可发起小样申请');
      }
      return false;
    }
    if (!material.supplierId) {
      alert('该材料缺少供应商信息，无法申领小样');
      return false;
    }

    if (!isSupabaseConfigured()) {
      const newRequest: SampleRequest = {
        id: `samp_${Date.now()}`,
        materialId,
        designerId: user.id,
        supplierId: material.supplierId,
        address,
        contactName,
        phone,
        status: 'PENDING',
        submitDate: new Date().toISOString(),
      };
      setSampleRequests((prev) => [newRequest, ...prev]);
      return true;
    }

    const result = await createSampleRequest({
      materialId,
      supplierId: material.supplierId,
      designerId: user.id,
      receiverName: contactName,
      phone,
      address,
    });

    if (!result.ok) {
      console.error('[MatterInsight] createSampleRequest failed:', result.error);
      return false;
    }

    setSampleRequests((prev) => [
      result.request,
      ...prev.filter((r) => r.id !== result.request.id),
    ]);
    void refreshUnreadNotifications();
    return true;
  };

  const handleShipSample = async (requestId: string, role: 'SUPPLIER' | 'ADMIN') => {
    if (!isSupabaseConfigured()) {
      setSampleRequests((prev) =>
        prev.map((req) =>
          req.id === requestId
            ? {
                ...req,
                status: role === 'SUPPLIER' ? 'SHIPPED_BY_SUPPLIER' : 'SHIPPED_BY_ADMIN',
                shipDate: new Date().toISOString(),
              }
            : req
        )
      );
      alert('已标记为已寄出');
      return;
    }

    const result = await shipSampleRequest({
      requestId,
      portal: role === 'ADMIN' ? 'admin' : 'supplier',
    });
    if (!result.ok) {
      alert(`更新寄送状态失败：${result.error}`);
      return;
    }
    setSampleRequests((prev) =>
      prev.map((req) => (req.id === requestId ? result.request : req))
    );
    // 再拉一次云端，确保材料商/设计师刷新后一致
    if (user) {
      void hydrateCommerceRequests(user);
    }
    alert(role === 'ADMIN' ? '已代寄并标记为已寄出' : '已确认寄出');
  };

  const handleVerifySupplier = async (userId: string) => {
    if (isSupabaseConfigured()) {
      const ok = await approveSupplier(userId);
      if (!ok) {
        alert('认证状态写入失败，请重试');
        void refreshVerificationRequestsFromCloud();
        return;
      }
    } else {
      setVerifiedUserIds((prev) => [...prev, userId]);
    }

    setVerificationRequests((prev) => prev.filter((u) => u.id !== userId));

    addNotification(userId, '认证通过', '恭喜！您的供应商认证申请已通过，现在可以发布材料并接收询价了。', 'AUDIT');

    if (user && user.id === userId) {
      setUser({ ...user, isVerified: true, accountStatus: 'approved' });
    }

    alert('供应商认证已通过！');
  };

  const handleRequestVerification = async (phone: string, doc: string) => {
    if (!user) return;
    const updatedUser = { ...user, registeredPhone: phone, verificationDoc: doc };

    if (isSupabaseConfigured()) {
      const ok = await updateVerificationRequest(user.id, phone, doc);
      if (!ok) {
        alert('认证信息提交失败，请检查网络后重试。');
        return;
      }
    } else {
      setVerificationRequests((prev) => {
        const exists = prev.some((u) => u.id === user.id);
        if (exists) return prev.map((u) => (u.id === user.id ? updatedUser : u));
        return [...prev, updatedUser];
      });
    }

    setUser(updatedUser);
    alert('感谢申请，请等待认证。');
  };

  if (sharedMaterialId) {
    const material = library.find(m => m.id === sharedMaterialId);
    if (material) {
      return (
        <div className="min-h-screen bg-white">
          <div className="p-6 border-b flex justify-between items-center bg-black text-white">
            <h1 className="text-xl font-black uppercase tracking-tighter">{t('common.brand')} | MATTER INSIGHT <span className="text-gray-400 font-light ml-2 text-sm italic">{t('materialDetail.sharing')}</span></h1>
            <button onClick={() => setSharedMaterialId(null)} className="text-sm font-bold opacity-70 hover:opacity-100">{t('materialDetail.backLoginRegister')}</button>
          </div>
          <div className="p-4 md:p-10">
             <MaterialDetail 
              material={material} 
              user={user} // This might be null, MaterialDetail should handle it
              isPublicView={true}
              onBack={() => setSharedMaterialId(null)}
              onDeductPoints={() => alert(t('materialDetail.loginForPoints'))}
              onSampleRequest={() => alert(t('materialDetail.loginForSample'))}
              onInquiry={() => alert(t('materialDetail.loginForQuote'))}
              inquiries={[]}
              sampleRequests={[]}
            />
          </div>
          <div className="p-10 bg-gray-50 text-center">
            <p className="text-gray-400 text-xs mb-4 uppercase tracking-widest font-black">{t('materialDetail.discoverMore')}</p>
            <button 
              onClick={() => { setSharedMaterialId(null); setUser(null); }}
              className="bg-black text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-xs hover:scale-105 transition-transform shadow-xl"
            >
              {t('materialDetail.registerFull')}
            </button>
          </div>
        </div>
      );
    }
  }

  if (!authReady) {
    return (
      <div className="min-h-screen bg-[#111] flex flex-col items-center justify-center gap-4 p-6">
        <div className="w-10 h-10 border-2 border-white/20 border-t-white rounded-full animate-spin" />
        <p className="text-white/70 text-sm font-bold tracking-wide">{t('common.loading')}</p>
      </div>
    );
  }

  // 最高优先级：recovery 模式绝对禁止进入 Dashboard
  if (recoveryMode || isPasswordRecoveryMode()) {
    return <ResetPassword />;
  }

  // Admin 入口：未登录仍强制 Auth
  if (isAdminPortal() && !user) {
    return <Auth onAuthSuccess={handleAuthSuccess} adminPortal />;
  }

  // 独立 /login：强制登录页（互踢 / 登出落地），返回探索库用 onBack
  if (!user && isAuthRoute(pathname)) {
    return (
      <Auth
        key="auth-login-page"
        onAuthSuccess={handleAuthSuccess}
        initialMode="login"
        onBack={() => {
          navigateTo('/', true);
          setCurrentView('HOME');
        }}
      />
    );
  }

  // 访客 Auth gate（点材料 / 顶栏登录）
  if (!user && showAuthGate) {
    return (
      <Auth
        key={`auth-gate-${authInitialMode}`}
        onAuthSuccess={handleAuthSuccess}
        initialMode={authInitialMode}
        onBack={closeAuthGate}
      />
    );
  }

  // Header 红点：材料商 = pending 小样 + pending 询价 + tag_added；设计师 = 未读小样/询价 + story_featured
  const pendingSampleBadge = user
    ? sampleRequests.filter((s) => s.supplierId === user.id && s.status === 'PENDING').length
    : 0;
  const pendingInquiryBadge = user
    ? inquiries.filter((inq) => inq.supplierId === user.id && inq.status === 'PENDING').length
    : 0;
  const totalNotifications = !user
    ? 0
    : isSupabaseConfigured()
      ? user.role === 'SUPPLIER'
        ? pendingSampleBadge + pendingInquiryBadge + dbUnreadCounts.tag_added
        : user.role === 'DESIGNER'
          ? designerUnreadRequests + dbUnreadCounts.story_featured
          : dbUnreadTotal
      : user.role === 'DESIGNER'
        ? designerUnreadRequests
        : pendingSampleBadge + pendingInquiryBadge;

  const handleAvatarClick = () => {
    if (!user) {
      openAuthGate('login');
      return;
    }
    if (user.role === 'DESIGNER') {
      navigateTo(MY_PAGE_PATH);
      setSelectedMaterial(null);
      setSelectedMoodboard(null);
      setCurrentView('HOME');
      return;
    }
    redirectToRoleDashboard(user.dbRole);
    setCurrentView('DASHBOARD');
  };

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col">
        <Navbar
          user={user} 
          points={points} 
          onLogoClick={goToExploreLibrary}
          onProfileClick={() => {
            if (!user) {
              openAuthGate('login');
              return;
            }
            redirectToRoleDashboard(user.dbRole);
            setCurrentView('DASHBOARD');
          }}
          onAvatarClick={handleAvatarClick}
          onMyPageClick={() => {
            if (!user) {
              openAuthGate('login');
              return;
            }
            if (pathname !== MY_PAGE_PATH) {
              navigateTo(MY_PAGE_PATH);
            }
            setCurrentView('HOME');
          }}
          onMoodboardClick={() => {
            if (!user) {
              openAuthGate('login');
              return;
            }
            setCurrentView('MOODBOARD');
          }}
          onAuthClick={() => openAuthGate('login')}
          onLogout={async () => {
            if (isSupabaseConfigured()) await signOut();
            setUser(null);
            setSavedMaterialIds([]);
            setMoodboards([]);
            setActiveMoodboardId('');
            setSelectedMaterial(null);
            setSelectedMoodboard(null);
            setPendingMaterials([]);
            setCurrentView('HOME');
            closeAuthGate();
            window.location.replace(LOGIN_PATH);
          }}
          onRechargeClick={() => {
            if (!user) {
              openAuthGate('login');
              return;
            }
            setIsRechargeModalOpen(true);
          }}
          notifications={totalNotifications}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
          onSearchSubmit={() => {
            goToExploreLibrary();
          }}
          onSearchExit={() => {
            setSearchTerm('');
            goToExploreLibrary();
          }}
        />
        
        <main className="flex-grow pt-20 px-4 md:px-8">
          {user && onProfilePage && pageRoute.type === 'my-page' && user.role === 'DESIGNER' && currentView === 'HOME' && (
            <DesignerPage
              mode="owner"
              designerId={user.id}
              viewerId={user.id}
              materials={library}
              ownedMoodboards={moodboards}
              onSelectMoodboard={openMoodboardFromFeed}
              onBack={leaveProfilePages}
              onProfileUpdated={({ company, avatar }) => {
                setUser((prev) =>
                  prev
                    ? {
                        ...prev,
                        company: company !== undefined ? company ?? undefined : prev.company,
                        name:
                          company !== undefined
                            ? resolveUserDisplayName({ company, email: prev.email })
                            : prev.name,
                        avatar: avatar !== undefined ? avatar : prev.avatar,
                      }
                    : prev
                );
              }}
            />
          )}

          {user && onProfilePage && pageRoute.type === 'designer' && currentView === 'HOME' && (
            <DesignerPage
              mode="public"
              designerId={pageRoute.id}
              viewerId={user.id}
              materials={library}
              ownedMoodboards={[]}
              onSelectMoodboard={openMoodboardFromFeed}
              onBack={leaveProfilePages}
            />
          )}

          {user && onProfilePage && pageRoute.type === 'my-page' && user.role !== 'DESIGNER' && (
            <div className="max-w-3xl mx-auto py-20 text-center">
              <p className="text-gray-400 font-bold">{t('explore.designerOnlyPage')}</p>
              <button type="button" onClick={leaveProfilePages} className="mt-4 text-sm font-bold">
                {t('common.backToExplore')}
              </button>
            </div>
          )}

          {pageRoute.type === 'topic' && (
            <TopicArticleDetail articleId={pageRoute.id} onBack={goToExploreLibrary} />
          )}

          {user && pageRoute.type === 'supplier-topic-editor' && user.dbRole === 'supplier' && (
            <TopicArticleEditor
              userId={user.id}
              articleId={pageRoute.articleId}
              onBack={() => {
                navigateTo(SUPPLIER_DASHBOARD_PATH);
                setCurrentView('DASHBOARD');
              }}
            />
          )}

          {!onProfilePage && currentView === 'HOME' && pageRoute.type !== 'topic' && pageRoute.type !== 'supplier-topic-editor' && (
            <div className="max-w-7xl mx-auto">
              <WhatsNewSection />
              {!libraryHydrated ? (
                <div
                  className="py-10 md:py-16"
                  aria-busy="true"
                  aria-live="polite"
                  aria-label={t('common.loading')}
                >
                  <div className="flex flex-col items-center justify-center gap-4 mb-10">
                    <div className="w-10 h-10 border-2 border-gray-200 border-t-black rounded-full animate-spin" />
                    <p className="text-sm font-bold text-gray-400 tracking-wide">{t('common.loading')}</p>
                  </div>
                  <div className="columns-2 md:columns-3 lg:columns-4 gap-4 space-y-4">
                    {Array.from({ length: 8 }).map((_, i) => (
                      <div
                        key={`explore-skel-${i}`}
                        className="break-inside-avoid mb-4 rounded-2xl bg-gray-100 animate-pulse"
                        style={{ height: `${160 + (i % 4) * 48}px` }}
                      />
                    ))}
                  </div>
                </div>
              ) : (
                <>
                  <CategoryBar 
                    selected={selectedCategory} 
                    onSelect={setSelectedCategory} 
                  />
                  <PinterestFeed 
                    materials={library.filter(m => {
                      const matchesCategory = !selectedCategory || m.category === selectedCategory;
                      const matchesSearch = materialMatchesSearchQuery(m, searchTerm);
                      return matchesCategory && matchesSearch;
                    })}
                    publishedMoodboards={
                      !selectedCategory
                        ? publicMoodboards.filter((b) => {
                            if (!searchTerm) return true;
                            const q = searchTerm.toLowerCase();
                            return (
                              b.name.toLowerCase().includes(q) ||
                              (b.ownerName?.toLowerCase().includes(q) ?? false)
                            );
                          })
                        : []
                    }
                    onSelect={(m) => {
                      if (!user) {
                        openAuthGate('register', m.id);
                        return;
                      }
                      openMaterialDetail(m, 'home');
                    }}
                    onSelectMoodboard={(board) => {
                      if (!user) {
                        openAuthGate('login');
                        return;
                      }
                      openMoodboardFromFeed(board);
                    }}
                    onSave={(id, moodboardId, newMoodboardName) => {
                      if (!user) {
                        openAuthGate('login');
                        return;
                      }
                      handleSaveMaterial(id, moodboardId, newMoodboardName);
                    }}
                    savedIds={user?.role === 'DESIGNER' ? savedMaterialIds : []}
                    moodboards={user?.role === 'DESIGNER' ? moodboards : []}
                    collectedMoodboardIds={
                      user?.role === 'DESIGNER' ? collectedMoodboardIds : []
                    }
                    onToggleCollectMoodboard={
                      user?.role === 'DESIGNER' ? handleToggleCollectMoodboard : undefined
                    }
                  />
                </>
              )}
            </div>
          )}

          {user && currentView === 'MOODBOARD_VIEW' && selectedMoodboard && (
            <MoodBoardViewer
              board={selectedMoodboard}
              materials={library}
              onBack={() => {
                setSelectedMoodboard(null);
                setCurrentView('HOME');
              }}
              onSelectMaterial={(m) => openMaterialDetail(m, 'moodboard')}
              onFindSimilar={(item) => handleFindSimilar(item.name)}
            />
          )}

          {user && currentView === 'DETAILS' && selectedMaterial && pageRoute.type !== 'topic' && pageRoute.type !== 'supplier-topic-editor' && (
            <MaterialDetail 
              material={selectedMaterial} 
              user={user}
              editMode={parseMaterialEditMode(locationSearch)}
              fromSupplierDashboard={materialDetailReturnTo === 'supplier'}
              backLabel={
                materialDetailReturnTo === 'dashboard'
                  ? t('materialDetail.backDashboard')
                  : materialDetailReturnTo === 'supplier'
                    ? t('materialDetail.backSupplier')
                  : materialDetailReturnTo === 'moodboard'
                    ? t('materialDetail.backMoodboard')
                    : undefined
              }
              onBack={closeMaterialDetail}
              onMaterialUpdated={(updated) => {
                setLibrary((prev) =>
                  prev.map((m) => (m.id === updated.id ? updated : m))
                );
                setSelectedMaterial(updated);
              }}
              onDeductPoints={(amt) => {
                handlePointChange(-amt, '申领材料小样');
                if (isSupabaseConfigured() && selectedMaterial?.supplierId) {
                  void recordPointsConsume({
                    amount: amt,
                    description: '申领材料小样',
                    supplierId: selectedMaterial.supplierId,
                    materialId: selectedMaterial.id,
                    orderType: 'sample',
                    // 暂定：1 积分 ≈ ¥0.5 记入供应商 GMV（后续可改为真实计价）
                    amountCny: amt * 0.5,
                  }).then((r) => {
                    if (r.ok) setPoints(r.balanceAfter);
                  });
                }
              }}
              onSampleRequest={handleSampleRequest}
              onInquiry={handleInquiry}
              inquiries={inquiries}
              sampleRequests={sampleRequests}
            />
          )}

          {user && currentView === 'MOODBOARD' && user.role === 'DESIGNER' && (
            <MoodBoardDesigner 
              user={user}
              points={points}
              materials={library}
              savedIds={savedMaterialIds}
              moodboards={moodboards}
              setMoodboards={setMoodboards}
              activeMoodboardId={activeMoodboardId}
              setActiveMoodboardId={setActiveMoodboardId}
              onDeductPoints={(amt, desc) => handlePointChange(-amt, desc)}
              onSaveMaterial={handleAddToMoodboard}
              onUnsaveMaterial={handleRemoveFromCollect}
              onMoodboardPublished={refreshPublicMoodboards}
            />
          )}

          {user && !onProfilePage && currentView === 'DASHBOARD' && pageRoute.type !== 'supplier-topic-editor' && pageRoute.type !== 'topic' && (() => {
            switch (user.dbRole) {
              case 'admin':
                return (
                  <AdminDashboard
                    user={user}
                    library={library}
                    setLibrary={setLibrary}
                    pendingList={pendingMaterials}
                    onApprove={handleApproveMaterial}
                    onReject={handleRejectMaterial}
                    sampleRequests={sampleRequests}
                    onShipSample={(id) => handleShipSample(id, 'ADMIN')}
                    verificationRequests={verificationRequests}
                    onVerifySupplier={handleVerifySupplier}
                  />
                );
              case 'designer':
                return (
                  <DesignerDashboard
                    user={user}
                    savedIds={savedMaterialIds}
                    setSavedIds={setSavedMaterialIds}
                    moodboards={moodboards}
                    setMoodboards={setMoodboards}
                    library={library}
                    onRechargeClick={() => setIsRechargeModalOpen(true)}
                    onOpenMoodboard={(id) => { setActiveMoodboardId(id); setCurrentView('MOODBOARD'); }}
                    onViewMaterialDetail={(m) => openMaterialDetail(m, 'dashboard')}
                    inquiries={inquiries}
                    onInquiry={handleInquiry}
                    onSampleRequest={handleSampleRequest}
                    sampleRequests={sampleRequests}
                    onRequestsMarkedRead={() => {
                      setDesignerUnreadRequests(0);
                      void refreshUnreadNotifications();
                      void refreshDesignerUnreadRequests();
                    }}
                  />
                );
              case 'supplier':
                return (
                  <SupplierDashboard
                    user={user}
                    points={points}
                    onPointsUpdated={(balance) => {
                      setPoints(balance);
                      setUser((prev) => (prev ? { ...prev, points: balance } : prev));
                    }}
                    library={library}
                    setLibrary={setLibrary}
                    pendingList={pendingMaterials}
                    setPendingMaterials={setPendingMaterials}
                    onSubmitForReview={handleSubmitMaterialForReview}
                    onRechargeClick={() => setIsRechargeModalOpen(true)}
                    inquiries={inquiries}
                    onQuote={handleQuote}
                    sampleRequests={sampleRequests}
                    onShipSample={(id) => handleShipSample(id, 'SUPPLIER')}
                    onRequestVerification={handleRequestVerification}
                    onViewMaterialDetail={(m) => openMaterialDetail(m, 'supplier', { mode: 'edit' })}
                    unreadCounts={dbUnreadCounts}
                    onUnreadChanged={refreshUnreadNotifications}
                  />
                );
              default:
                // 未知角色：显示未授权，禁止 signOut
                return (
                  <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 p-8">
                    <p className="text-lg font-black text-gray-800">{t('explore.unauthorized')}</p>
                    <p className="text-sm text-gray-500">{t('explore.unauthorizedHint')}</p>
                    <button
                      type="button"
                      className="px-6 py-3 rounded-2xl bg-black text-white font-bold"
                      onClick={() => {
                        setUser(null);
                        window.location.replace(isAdminPortal() ? '/admin' : LOGIN_PATH);
                      }}
                    >
                      {t('explore.returnLogin')}
                    </button>
                  </div>
                );
            }
          })()}
        </main>

        <RechargeModal 
          isOpen={isRechargeModalOpen} 
          onClose={() => setIsRechargeModalOpen(false)} 
          onConfirm={handleRecharge} 
        />

        {showWelcomeBonus && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[200] flex items-center justify-center p-6">
            <div className="bg-white p-12 rounded-[50px] max-w-lg w-full text-center shadow-2xl relative">
              <div className="text-6xl mb-6">🎁</div>
              <h3 className="text-3xl font-black mb-4 tracking-tighter">{t('explore.welcomeTitle')}</h3>
              <p className="text-gray-500 mb-8 leading-relaxed">
                {t('explore.welcomeBody', { points: 1000 })}
              </p>
              <button 
                onClick={() => setShowWelcomeBonus(false)}
                className="w-full bg-black text-white py-5 rounded-2xl font-bold shadow-xl hover:scale-[1.02] transition-all"
              >
                {t('explore.startExploring')}
              </button>
            </div>
          </div>
        )}

        {showAdminLogin && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
            <div className="bg-white p-10 rounded-[40px] w-full max-w-sm shadow-2xl">
              <h3 className="text-2xl font-black mb-6">{t('admin.opsTitle')}</h3>
              <input 
                type="password" 
                autoComplete="new-password"
                name="admin-access-token"
                placeholder={t('admin.opsPlaceholder')}
                className="w-full p-4 bg-gray-50 rounded-2xl mb-4 border-none outline-none focus:ring-2 focus:ring-black"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
              />
              <div className="flex gap-4">
                <button type="button" onClick={() => setShowAdminLogin(false)} className="flex-1 py-4 font-bold text-gray-400">{t('common.cancel')}</button>
                <button type="button" onClick={handleAdminAuth} className="flex-1 py-4 bg-black text-white rounded-2xl font-bold">{t('admin.enterAdmin')}</button>
              </div>
            </div>
          </div>
        )}

        <footer className="bg-white border-t py-6 text-center text-sm text-gray-500">
          {t('explore.footer')}
        </footer>
      </div>
    </ErrorBoundary>
  );
};

export default App;

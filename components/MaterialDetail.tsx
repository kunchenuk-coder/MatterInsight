
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Material, User, Inquiry, SampleRequest, MaterialStatus, InquiryFormPayload, UNLIMITED_POINTS_BALANCE } from '../types';
import { toMaterialDetail, buildHumanDnaSnapshot } from '../data/materialDetailMock';
import {
  buildMaterialDataPayload,
  republishMaterial,
  saveMaterialDraft,
} from '../services/materialService';
import { isSupplierUser } from '../services/inquiryService';
import { resolveMaterialDetailPermissions } from '../utils/materialDetailPermissions';
import MaterialDetailTopSection from './MaterialDetailTopSection';
import MaterialMoodTagsSection from './MaterialMoodTagsSection';
import MaterialInspirationStoriesSection from './MaterialInspirationStoriesSection';
import MaterialEvaluationsSection from './MaterialEvaluationsSection';
import MaterialManageActionBar from './MaterialManageActionBar';
import type { MaterialHumanDna, MaterialEvaluations, InspirationStory, MaterialApplicationCase } from '../types/materialDetail';
import {
  disputeMaterialEvaluation,
  fetchMaterialEvaluations,
  fetchMyMaterialEvaluation,
  submitMaterialEvaluation,
  type MaterialEvaluationRow,
} from '../services/materialEvaluationService';
import {
  fetchUnreadNotificationRows,
  markNotificationsRead,
} from '../services/notificationService';
import { fetchMaterialInspirationStories } from '../services/inspirationStoryService';
import { fetchMaterialMoodTags } from '../services/moodTagService';
import {
  fetchMyProjectAdoptionForMaterial,
  type ProjectAdoptionRow,
} from '../services/projectAdoptionService';
import ProjectAdoptionModal from './ProjectAdoptionModal';
import useMaterialEventLog from '../hooks/useMaterialEventLog';
import useMaterialViewCount from '../hooks/useMaterialViewCount';
import { portalFromUserRole } from '../utils/appPortal';
import { isSupabaseConfigured } from '../services/supabaseClient';
import { pickLocale } from '../utils/localizedText';
import { recordPointsConsume } from '../services/adminAnalyticsService';
import { getSupplierProfile } from '../services/supplierProfileService';
import SupplierAuthorLink from './SupplierAuthorLink';
import type { SupplierProfile } from '../types';
interface MaterialDetailProps {
  material: Material;
  user: User | null;
  isPublicView?: boolean;
  backLabel?: string;
  editMode?: boolean;
  fromSupplierDashboard?: boolean;
  onBack: () => void;
  onDeductPoints: (amt: number) => void;
  onSampleRequest: (
    materialId: string,
    address: string,
    contactName: string,
    phone: string
  ) => void | Promise<boolean | void>;
  onInquiry: (
    materialId: string,
    payload: string | InquiryFormPayload,
    notes?: string
  ) => void | Promise<boolean | void>;
  inquiries: Inquiry[];
  sampleRequests: SampleRequest[];
  onMaterialUpdated?: (material: Material) => void;
  onPointsBalance?: (balance: number) => void;
}

const CATALOG_DOWNLOAD_POINTS = 10;

function resolveApplicationCases(
  material: Material,
  cases: MaterialApplicationCase[]
): MaterialApplicationCase[] {
  if (cases.length > 0) return cases;
  return (material.projectPhotos ?? []).filter(Boolean).map((url, i) => ({
    id: `project_photo_${i}`,
    url,
    is_for_training: false,
  }));
}

const MaterialDetail: React.FC<MaterialDetailProps> = ({ 
  material, user, onBack, onDeductPoints, onSampleRequest, onInquiry,
  inquiries, sampleRequests, isPublicView = false, backLabel,
  editMode = false, fromSupplierDashboard = false, onMaterialUpdated,
  onPointsBalance,
}) => {
  const { t } = useTranslation();
  const [selectedVariant, setSelectedVariant] = useState((material.variants && material.variants[0]) || { id: 'default', colorCode: '#FFFFFF', imageUrl: material.image, name: '默认' });
  const [isQuoting, setIsQuoting] = useState(false);
  const [isRequestingSample, setIsRequestingSample] = useState(false);
  const [sampleForm, setSampleForm] = useState({ address: '', contactName: user?.name || '', phone: '' });
  const [quoteForm, setQuoteForm] = useState({ project: '', address: '', area: '', date: '', notes: '' });
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);
  const [showAdoptionModal, setShowAdoptionModal] = useState(false);
  const [myAdoption, setMyAdoption] = useState<ProjectAdoptionRow | null>(null);
  const [myAdoptionLoading, setMyAdoptionLoading] = useState(false);
  const [supplierProfile, setSupplierProfile] = useState<SupplierProfile | null>(null);
  const [installPreviewIndex, setInstallPreviewIndex] = useState<number | null>(null);
  const [catalogDownloading, setCatalogDownloading] = useState(false);
  const variantStripRef = useRef<HTMLDivElement>(null);
  const supplierUnreadRowsRef = useRef<Awaited<ReturnType<typeof fetchUnreadNotificationRows>> | null>(null);

  const materialDetail = useMemo(() => toMaterialDetail(material), [material]);
  const [applicationCases, setApplicationCases] = useState(() =>
    resolveApplicationCases(material, materialDetail.application_cases)
  );
  const [moodTags, setMoodTags] = useState(materialDetail.mood_tags);
  const [inspirationStories, setInspirationStories] = useState<InspirationStory[]>(
    materialDetail.inspiration_stories
  );
  const [inspirationStoriesLoading, setInspirationStoriesLoading] = useState(false);
  const [evaluations, setEvaluations] = useState<MaterialEvaluations>(materialDetail.evaluations);
  const [evaluationVoteCount, setEvaluationVoteCount] = useState(
    materialDetail.evaluation_vote_count ?? 0
  );
  const [hasSubmittedRating, setHasSubmittedRating] = useState(false);
  const [myEvaluation, setMyEvaluation] = useState<MaterialEvaluationRow | null>(null);
  const [latestEvaluation, setLatestEvaluation] = useState<MaterialEvaluationRow | null>(null);
  const [sectionUnread, setSectionUnread] = useState({ eval: 0, mood: 0, story: 0 });
  const supplierViewer = isSupplierUser(user);
  const isOwnSupplierMaterial = Boolean(
    supplierViewer && user?.id && material.supplierId === user.id && !isPublicView
  );
  const { logEventSafe } = useMaterialEventLog(user?.id);
  const permissions = useMemo(
    () =>
      resolveMaterialDetailPermissions({
        user,
        material,
        isPublicView,
        editMode,
        fromSupplierDashboard,
      }),
    [user, material, isPublicView, editMode, fromSupplierDashboard]
  );
  const isManageMode = permissions.canManageApplicationCases;
  const displayName = pickLocale(material.name);
  const displayNotes = material.supplierNotes
    ? pickLocale(material.supplierNotes)
    : '';
  const displayDescription = material.description
    ? pickLocale(material.description)
    : '';

  /** 真实浏览计数：进入详情页 +1（sessionStorage 防 F5）；材料商编辑模式不刷量 */
  const { viewCount } = useMaterialViewCount({
    materialId: material.id,
    initialCount: material.clicks || 0,
    enabled: !isManageMode && isSupabaseConfigured(),
  });

  useEffect(() => {
    if (viewCount === (material.clicks || 0)) return;
    onMaterialUpdated?.({ ...material, clicks: viewCount });
  }, [viewCount]); // eslint-disable-line react-hooks/exhaustive-deps -- sync library once per count change

  useEffect(() => {
    if (!material.supplierId) {
      setSupplierProfile(null);
      return;
    }
    let cancelled = false;
    void getSupplierProfile(material.supplierId).then((p) => {
      if (!cancelled) setSupplierProfile(p);
    });
    return () => {
      cancelled = true;
    };
  }, [material.supplierId]);

  /** 材料商进入详情：先展示分区未读数，再按材料清零对应通知 */
  useEffect(() => {
    supplierUnreadRowsRef.current = null;
  }, [material.id]);

  useEffect(() => {
    if (!isOwnSupplierMaterial || !isSupabaseConfigured() || !material.id) {
      setSectionUnread({ eval: 0, mood: 0, story: 0 });
      return;
    }
    let cancelled = false;
    void (async () => {
      if (!supplierUnreadRowsRef.current) {
        supplierUnreadRowsRef.current = await fetchUnreadNotificationRows('supplier');
      }
      const rows = supplierUnreadRowsRef.current;
      if (cancelled) return;
      const storyIds = new Set(inspirationStories.map((s) => s.id).filter(Boolean));
      const evalCount = rows.filter(
        (r) => r.type === 'evaluation_added' && r.targetId === material.id
      ).length;
      const moodCount = rows.filter(
        (r) => r.type === 'tag_added' && r.targetId === material.id
      ).length;
      const storyCount = rows.filter(
        (r) => r.type === 'story_pending_review' && r.targetId && storyIds.has(r.targetId)
      ).length;
      setSectionUnread({ eval: evalCount, mood: moodCount, story: storyCount });

      await markNotificationsRead({
        types: ['tag_added', 'evaluation_added'],
        targetId: material.id,
        portal: 'supplier',
      });
      await Promise.all(
        [...storyIds].map((storyId) =>
          markNotificationsRead({
            types: ['story_pending_review'],
            targetId: storyId,
            portal: 'supplier',
          })
        )
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [isOwnSupplierMaterial, material.id, inspirationStories]);

  const humanDnaSnapshot = useCallback((): MaterialHumanDna => {
    return buildHumanDnaSnapshot({
      ...material,
      ...materialDetail,
      application_cases: applicationCases,
      mood_tags: moodTags,
      inspiration_stories: inspirationStories,
      evaluations,
      evaluation_vote_count: evaluationVoteCount,
    });
  }, [material, materialDetail, applicationCases, moodTags, inspirationStories, evaluations, evaluationVoteCount]);

  const persistToLibrary = useCallback(
    (statusLabel: 'draft' | '已发布') => {
      const humanDna = humanDnaSnapshot();
      const nextStatus =
        statusLabel === 'draft'
          ? ('draft' as MaterialStatus)
          : MaterialStatus.PUBLISHED;
      const updated = buildMaterialDataPayload(
        { ...material, status: nextStatus },
        humanDna
      );
      onMaterialUpdated?.(updated);
      return updated;
    },
    [humanDnaSnapshot, material, onMaterialUpdated]
  );

  const handleMoodTagInteract = useCallback(
    (tagName: string, tag: { is_custom?: boolean; is_brand_official?: boolean }) => {
      logEventSafe(material.id, 'TAG_MOOD_X2', {
        tag: tagName,
        is_custom: tag.is_custom,
        is_brand_official: tag.is_brand_official,
      });
    },
    [logEventSafe, material.id]
  );

  const showToast = (message: string, tone: 'success' | 'error') => {
    setToast({ message, tone });
    window.setTimeout(() => setToast(null), 3200);
  };

  const handleSaveDraft = async () => {
    if (!user || !isManageMode) return;
    setIsSavingDraft(true);
    const humanDna = humanDnaSnapshot();
    const result = await saveMaterialDraft(user.id, material.id, material, humanDna);
    setIsSavingDraft(false);
    if (!result.ok) {
      showToast(result.error || '草稿保存失败', 'error');
      return;
    }
    persistToLibrary('draft');
    showToast('草稿已保存，尚未对设计师公开', 'success');
  };

  const handleRepublish = async () => {
    if (!user || !isManageMode) return;
    setIsRepublishing(true);
    const humanDna = humanDnaSnapshot();
    const result = await republishMaterial(user.id, material.id, material, humanDna);
    setIsRepublishing(false);
    if (!result.ok) {
      showToast(result.error || '发布失败', 'error');
      return;
    }
    persistToLibrary('已发布');
    showToast('材料已成功再次发布，设计师可见最新版本', 'success');
  };

  useEffect(() => {
    setApplicationCases(resolveApplicationCases(material, materialDetail.application_cases));
    setEvaluations(materialDetail.evaluations);
    setEvaluationVoteCount(materialDetail.evaluation_vote_count ?? 0);
  }, [
    material.id,
    material.projectPhotos,
    materialDetail.application_cases,
    materialDetail.evaluations,
    materialDetail.evaluation_vote_count,
  ]);

  /** Source of truth: cloud mood tags (humanDna + material_tag_relation heal). */
  useEffect(() => {
    let cancelled = false;
    setMoodTags(materialDetail.mood_tags ?? []);

    if (!isSupabaseConfigured() || !material.id) return undefined;

    void (async () => {
      const portal =
        user?.role === 'SUPPLIER' || user?.role === 'DESIGNER' || user?.role === 'ADMIN'
          ? portalFromUserRole(user.role)
          : 'designer';
      const rows = await fetchMaterialMoodTags(material.id, portal);
      if (cancelled || rows.length === 0) return;
      setMoodTags(rows);
    })();

    return () => {
      cancelled = true;
    };
  }, [material.id, user?.id, user?.role, materialDetail.mood_tags]);

  /** Source of truth: inspiration_stories table (not only embedded humanDna JSON). */
  useEffect(() => {
    let cancelled = false;
    const loadStories = async () => {
      setInspirationStoriesLoading(true);
      try {
        const portal =
          user?.role === 'SUPPLIER' || user?.role === 'DESIGNER' || user?.role === 'ADMIN'
            ? portalFromUserRole(user.role)
            : 'designer';
        const rows = await fetchMaterialInspirationStories(material.id, portal);
        if (cancelled) return;
        if (rows.length > 0) {
          setInspirationStories(rows);
        } else {
          // Fallback to embedded mock/legacy JSON when table has no rows yet
          setInspirationStories(materialDetail.inspiration_stories ?? []);
        }
      } finally {
        if (!cancelled) setInspirationStoriesLoading(false);
      }
    };
    void loadStories();
    return () => {
      cancelled = true;
    };
  }, [material.id, user?.id, user?.role, materialDetail.inspiration_stories]);

  useEffect(() => {
    if (!isSupabaseConfigured() || !user?.id || !material.id) {
      setHasSubmittedRating(false);
      setMyEvaluation(null);
      setLatestEvaluation(null);
      return;
    }
    let cancelled = false;
    const portal = portalFromUserRole(user.role);
    void (async () => {
      if (user.role === 'DESIGNER') {
        const mine = await fetchMyMaterialEvaluation(material.id, user.id);
        if (cancelled) return;
        setMyEvaluation(mine);
        setHasSubmittedRating(Boolean(mine));
        setLatestEvaluation(null);
        return;
      }
      if (user.role === 'SUPPLIER' && user.id === material.supplierId) {
        const rows = await fetchMaterialEvaluations(material.id, portal);
        if (cancelled) return;
        const latest =
          rows
            .filter((r) => r.status !== 'revoked')
            .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0] ?? null;
        setLatestEvaluation(latest);
        setMyEvaluation(null);
        setHasSubmittedRating(false);
        return;
      }
      setHasSubmittedRating(false);
      setMyEvaluation(null);
      setLatestEvaluation(null);
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, user?.role, material.id, material.supplierId]);

  useEffect(() => {
    if (
      isPublicView ||
      !isSupabaseConfigured() ||
      user?.role !== 'DESIGNER' ||
      !user?.id
    ) {
      setMyAdoption(null);
      setMyAdoptionLoading(false);
      return;
    }
    let cancelled = false;
    setMyAdoptionLoading(true);
    void fetchMyProjectAdoptionForMaterial(material.id, user.id).then((row) => {
      if (!cancelled) {
        setMyAdoption(row);
        setMyAdoptionLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isPublicView, material.id, user?.id, user?.role]);

  // Generate Matter-ID
  const getCategoryAbbr = (cat: string) => {
    const map: Record<string, string> = {
      '石材': 'ST', '木材': 'WD', '金属': 'MT', '玻璃': 'GL', '涂料': 'PT', '织物': 'TX', '复合': 'CP'
    };
    return map[cat] || 'XX';
  };
  const matterId = `MAT-${getCategoryAbbr(material.category)}-${material.id.slice(-4).toUpperCase()}`;

  const displayBrand = material.brand ?? '';

  const ratingProjectName =
    quoteForm.project.trim() ||
    myEvaluation?.projectName ||
    (myAdoption ? `${displayName} 项目案例` : displayName);

  const handleSubmitEvaluation = async (submission: MaterialEvaluations) => {
    if (!user || user.role !== 'DESIGNER') return;

    const result = await submitMaterialEvaluation({
      userId: user.id,
      materialId: material.id,
      material,
      submission,
      currentEvaluations: evaluations,
      voteCount: evaluationVoteCount,
      projectName: ratingProjectName,
      projectAdoptionId: myAdoption?.id ?? null,
      evaluationId: myEvaluation?.id ?? null,
    });

    if (result.ok === false) {
      showToast(result.error, 'error');
      return;
    }

    setEvaluations(result.evaluations);
    setEvaluationVoteCount(result.voteCount);
    setHasSubmittedRating(true);
    onMaterialUpdated?.(result.material);
    const mine = await fetchMyMaterialEvaluation(material.id, user.id);
    setMyEvaluation(mine);
    showToast(myEvaluation ? '评分已更新，综合评估已重算' : '评分已提交，综合评估已更新', 'success');
  };

  const handleDisputeLatest = async () => {
    if (!latestEvaluation) return;
    const result = await disputeMaterialEvaluation(latestEvaluation.id, 'supplier');
    if (result.ok === false) {
      showToast(result.error, 'error');
      return;
    }
    setLatestEvaluation({ ...latestEvaluation, status: 'disputed' });
    showToast(t('eval.disputeOk'), 'success');
  };

  const handleInspirationStoriesChange = (stories: typeof inspirationStories) => {
    setInspirationStories(stories);
    if (permissions.canSubmitBrandStory) {
      onMaterialUpdated?.(
        buildMaterialDataPayload(
          material,
          buildHumanDnaSnapshot({
            ...material,
            ...materialDetail,
            application_cases: applicationCases,
            mood_tags: moodTags,
            inspiration_stories: stories,
            evaluations,
            evaluation_vote_count: evaluationVoteCount,
          })
        )
      );
    }
  };

  const installationList = material.installationMedia ?? [];

  useEffect(() => {
    if (installPreviewIndex === null) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setInstallPreviewIndex(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [installPreviewIndex]);

  const applyBalanceAfter = (balanceAfter: number) => {
    if (!Number.isFinite(balanceAfter)) return;
    const next = user?.isUnlimitedPoints ? UNLIMITED_POINTS_BALANCE : balanceAfter;
    onPointsBalance?.(next);
  };

  const handleDownloadCatalog = async () => {
    const url = material.catalogPdfUrl;
    if (!url || catalogDownloading) return;
    if (isPublicView || !user) {
      alert(t('materialDetail.loginForPoints'));
      return;
    }

    const designerPays = user.role === 'DESIGNER' && !user.isUnlimitedPoints;
    if (designerPays) {
      if (user.points < CATALOG_DOWNLOAD_POINTS) {
        alert(
          t('materialDetail.catalogNeedPoints', {
            cost: CATALOG_DOWNLOAD_POINTS,
            points: user.points,
          })
        );
        return;
      }
      if (!window.confirm(t('materialDetail.catalogConfirm', { cost: CATALOG_DOWNLOAD_POINTS }))) {
        return;
      }
    }

    setCatalogDownloading(true);
    try {
      if (user.role === 'DESIGNER' && isSupabaseConfigured()) {
        const charged = await recordPointsConsume({
          amount: CATALOG_DOWNLOAD_POINTS,
          description: '下载产品画册',
          supplierId: material.supplierId || null,
          materialId: material.id,
          portal: 'designer',
        });
        if (charged.ok === false) {
          alert(charged.error || t('materialDetail.catalogDownloadFail'));
          return;
        }
        applyBalanceAfter(charged.balanceAfter);
      }

      const fileName = material.catalogPdfName || 'catalog.pdf';
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('fetch failed');
        const blob = await res.blob();
        const objectUrl = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = objectUrl;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(objectUrl);
      } catch {
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.target = '_blank';
        a.rel = 'noreferrer';
        a.click();
      }
    } catch {
      alert(t('materialDetail.catalogDownloadFail'));
    } finally {
      setCatalogDownloading(false);
    }
  };

  const catalogDownloadButton = material.catalogPdfUrl ? (
    <button
      type="button"
      disabled={catalogDownloading}
      onClick={() => void handleDownloadCatalog()}
      className="inline-flex items-center gap-2 text-xs font-bold px-3 py-1.5 rounded-full bg-white border border-yellow-200 text-yellow-800 hover:bg-yellow-100 disabled:opacity-60"
    >
      {catalogDownloading && (
        <span className="w-3 h-3 border-2 border-yellow-700/30 border-t-yellow-800 rounded-full animate-spin" />
      )}
      {catalogDownloading ? t('materialDetail.downloadingPdf') : t('materialDetail.downloadPdf')}
    </button>
  ) : null;

  const handleShare = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#/share/${material.id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const handleSampleOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return alert('请先登录');
    if (supplierViewer) return;
    if (!sampleForm.address.trim() || !sampleForm.contactName.trim() || !sampleForm.phone.trim()) {
      showToast('请完整填写收件人、电话与地址', 'error');
      return;
    }
    if (user.points < material.pointsNeeded.sample) {
      alert('积分不足，请先充值');
      return;
    }
    const ok = await Promise.resolve(
      onSampleRequest(
        material.id,
        sampleForm.address.trim(),
        sampleForm.contactName.trim(),
        sampleForm.phone.trim()
      )
    );
    if (ok === false) {
      showToast('小样申请提交失败，请重试', 'error');
      return;
    }
    onDeductPoints(material.pointsNeeded.sample);
    setIsRequestingSample(false);
    showToast('小样申请已提交', 'success');
    window.setTimeout(() => onBack(), 600);
  };

  const handleQuoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (supplierViewer) return;
    if (!quoteForm.project.trim()) {
      showToast('请填写项目名称', 'error');
      return;
    }
    const areaRaw = quoteForm.area.trim();
    const estimatedArea = areaRaw ? Number(areaRaw) : null;
    if (areaRaw && Number.isNaN(estimatedArea as number)) {
      showToast('面积请填写数字', 'error');
      return;
    }

    const ok = await Promise.resolve(
      onInquiry(material.id, {
        moodBoardId: 'STANDALONE',
        projectName: quoteForm.project.trim(),
        projectLocation: quoteForm.address.trim() || undefined,
        estimatedArea,
        deliveryDate: quoteForm.date || null,
        remarks: quoteForm.notes.trim() || undefined,
      })
    );
    if (ok === false) {
      showToast('询价提交失败，请重试', 'error');
      return;
    }
    setIsQuoting(false);
    showToast('询价申请已发送', 'success');
    window.setTimeout(() => onBack(), 600);
  };

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-4 sm:py-8 relative">
      {toast && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 z-[300] px-6 py-3 rounded-2xl text-sm font-bold shadow-2xl backdrop-blur-md border transition-opacity ${
            toast.tone === 'success'
              ? 'bg-emerald-600/95 text-white border-emerald-400/30'
              : 'bg-red-600/95 text-white border-red-400/30'
          }`}
          role="status"
        >
          {toast.message}
        </div>
      )}

      <div className="flex flex-wrap justify-between items-center gap-3 mb-4 sm:mb-5">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-black transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel ?? (isPublicView ? t('materialDetail.backExplore') : isManageMode ? t('materialDetail.backSupplier') : t('materialDetail.backList'))}
        </button>
        <div className="flex flex-wrap items-center gap-2 sm:gap-3">
          {isManageMode && (
            <MaterialManageActionBar
              onSaveDraft={handleSaveDraft}
              onRepublish={handleRepublish}
              isSavingDraft={isSavingDraft}
              isRepublishing={isRepublishing}
              className="order-last sm:order-none w-full sm:w-auto justify-end"
            />
          )}
          {!isManageMode && (
            <button 
              onClick={handleShare}
              className={`flex items-center gap-2 px-6 py-1.5 rounded-full text-xs font-bold transition-all ${copySuccess ? 'bg-green-500 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
            >
              {copySuccess ? `✓ ${t('materialDetail.linkCopied')}` : `📢 ${t('materialDetail.share')}`}
            </button>
          )}
          {!isPublicView && (
            <div className="flex items-center gap-2">
              {permissions.showManageModeBanner && (
                <span className="bg-violet-100 text-violet-800 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                  {t('materialDetail.editMode')}
                </span>
              )}
              <div className="bg-gray-100 px-4 py-1.5 rounded-full hidden sm:block">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Matter-ID: </span>
              <span className="text-xs font-black text-black">{matterId}</span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-white p-4 sm:p-8 rounded-2xl sm:rounded-3xl shadow-sm border border-gray-100">
        <MaterialDetailTopSection
          mainImageUrl={selectedVariant.imageUrl || material.image}
          mainImageAlt={displayName}
          colorAccent={selectedVariant.colorCode}
          aiTrainedStatus={materialDetail.ai_trained_status}
          applicationCases={applicationCases}
          isSupplierEditMode={isManageMode}
          onApplicationCasesChange={isManageMode ? setApplicationCases : undefined}
          canUploadApplicationCases={permissions.canUploadApplicationCases}
          variantPicker={
            material.variants && material.variants.length > 0 ? (
              <div className="absolute bottom-4 left-4 right-4 flex items-center gap-1 bg-black/20 backdrop-blur-md px-1.5 py-2 rounded-2xl">
                <button
                  type="button"
                  onClick={() => {
                    const el = variantStripRef.current;
                    if (!el) return;
                    el.scrollBy({ left: -el.clientWidth * 0.7, behavior: 'smooth' });
                  }}
                  className="shrink-0 w-7 h-7 rounded-full bg-black/40 text-white text-sm font-bold hover:bg-black/60"
                  aria-label="上一组花色"
                >
                  ‹
                </button>
                <div
                  ref={variantStripRef}
                  className="flex-1 min-w-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                >
                  <div className="flex flex-col flex-wrap content-start gap-2 h-[4.5rem]">
                    {material.variants.map((v) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariant(v)}
                        title={pickLocale(v.name)}
                        className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${selectedVariant.id === v.id ? 'scale-110 border-white ring-2 ring-black' : 'border-white/50'}`}
                        style={{ backgroundColor: v.colorCode }}
                      />
                    ))}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const el = variantStripRef.current;
                    if (!el) return;
                    el.scrollBy({ left: el.clientWidth * 0.7, behavior: 'smooth' });
                  }}
                  className="shrink-0 w-7 h-7 rounded-full bg-black/40 text-white text-sm font-bold hover:bg-black/60"
                  aria-label="下一组花色"
                >
                  ›
                </button>
              </div>
            ) : null
          }
        />

        {(installationList.length > 0) && (
          <div className="mt-5">
            <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-3">
              {t('materialDetail.installation')}
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {installationList.map((item, i) => (
                <button
                  key={`${item.url}-${i}`}
                  type="button"
                  onClick={() => setInstallPreviewIndex(i)}
                  className="aspect-video rounded-2xl overflow-hidden bg-gray-100 relative group text-left"
                >
                  {item.kind === 'video' ? (
                    <video src={item.url} className="w-full h-full object-cover pointer-events-none" muted playsInline />
                  ) : (
                    <img src={item.url} alt="" className="w-full h-full object-cover" />
                  )}
                  <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-end p-3">
                    <span className="text-white text-[10px] font-bold opacity-0 group-hover:opacity-100">
                      {item.kind === 'video' ? t('materialDetail.installation') : t('cases.viewLarge')}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {installPreviewIndex !== null && installationList[installPreviewIndex] && (
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4 sm:p-8"
            onClick={() => setInstallPreviewIndex(null)}
          >
            <div className="absolute inset-0 bg-black/40 backdrop-blur-xl" aria-hidden />
            <div
              className="relative z-10 w-full max-w-5xl flex flex-col items-center"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                type="button"
                onClick={() => setInstallPreviewIndex(null)}
                className="absolute -top-2 right-0 sm:-top-4 sm:right-0 z-20 w-10 h-10 rounded-full bg-white/10 hover:bg-white/20 text-white backdrop-blur-sm border border-white/20 transition-colors"
                aria-label={t('materialDetail.installationClose')}
              >
                ✕
              </button>
              <div className="rounded-2xl overflow-hidden shadow-2xl bg-black/20 border border-white/10 max-h-[80vh] w-full flex justify-center">
                {installationList[installPreviewIndex].kind === 'video' ? (
                  <video
                    src={installationList[installPreviewIndex].url}
                    className="max-w-full max-h-[80vh]"
                    controls
                    autoPlay
                    playsInline
                  />
                ) : (
                  <img
                    src={installationList[installPreviewIndex].url}
                    alt=""
                    className="max-w-full max-h-[80vh] object-contain"
                  />
                )}
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8">
        {/* 1–2. Material information */}
        <div className="lg:col-span-5 order-1 lg:row-start-1">
          <div className="space-y-4 sm:space-y-5">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold">{displayName}</h1>
                <span className="text-xs font-bold text-gray-400 tabular-nums">
                  👀 {t('materialDetail.views', { count: viewCount })}
                </span>
              </div>
              <p className="text-gray-500 font-medium">
                {supplierProfile && (
                  <span className="inline-flex align-middle mr-2">
                    <SupplierAuthorLink
                      supplierId={material.supplierId}
                      displayName={
                        supplierProfile.company?.trim() ||
                        displayBrand ||
                        supplierProfile.username
                      }
                      avatarUrl={supplierProfile.avatar}
                    />
                  </span>
                )}
                <span>
                  {displayBrand}
                </span>
                {isPublicView && (
                  <span className="ml-2 text-[10px] bg-black text-white px-2 py-0.5 rounded-full font-bold">{t('materialDetail.publicPreview')}</span>
                )}
                <span className="mx-2">·</span>
                {t(`category.${material.category}`, { defaultValue: material.category })}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{t('materialDetail.spec')}</span>
                <span className="text-sm font-semibold">{material.specifications}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{t('materialDetail.priceRange')}</span>
                <span className="text-sm font-semibold">{material.priceRange}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{t('materialDetail.fireRating')}</span>
                <span className="text-sm font-semibold">{material.fireRating}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">{t('materialDetail.stockLead')}</span>
                <span className="text-sm font-semibold">{material.stock ? t('materialDetail.inStock') : t('materialDetail.custom')} · {material.leadTime}</span>
              </div>
            </div>

            {!supplierViewer && (
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
                {material.sampleAvailable !== false && (
                <button 
                  onClick={() => {
                    if (isPublicView) {
                      alert('请先注册/登录账户');
                      return;
                    }
                    setIsRequestingSample(true);
                  }}
                  className="flex-1 bg-black text-white py-4 rounded-2xl font-bold hover:bg-gray-800 transition-colors shadow-lg shadow-black/10"
                >
                  {material.sampleNote?.trim()
                    ? material.sampleNote
                    : t('materialDetail.requestSample', { points: material.pointsNeeded.sample })}
                </button>
                )}
                <button 
                  onClick={() => {
                    if (isPublicView) {
                      alert('请先注册/登录账户');
                      return;
                    }
                    setIsQuoting(true);
                  }}
                  className="flex-1 border-2 border-black py-4 rounded-2xl font-bold hover:bg-gray-50 transition-colors"
                >
                  {t('materialDetail.requestQuote')}
                </button>
              </div>
            )}

            {!isPublicView && user?.role === 'DESIGNER' && isSupabaseConfigured() && (
              <div className="space-y-2">
                <button
                  type="button"
                  disabled={myAdoptionLoading || myAdoption?.status === 'pending_review'}
                  title={
                    myAdoption?.status === 'pending_review'
                      ? t('materialDetail.adoptionPendingHint')
                      : undefined
                  }
                  onClick={() => setShowAdoptionModal(true)}
                  className="w-full border border-gray-300 py-3 rounded-2xl font-bold text-sm text-gray-800 hover:bg-gray-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  {t('materialDetail.adoptionCta')}
                </button>
                {myAdoption?.status === 'pending_review' && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl px-3 py-2">
                    {t('materialDetail.adoptionStatusPending')}
                  </p>
                )}
                {myAdoption?.status === 'approved' && (
                  <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-xl px-3 py-2">
                    {t('materialDetail.adoptionStatusApproved')}
                  </p>
                )}
                {myAdoption?.status === 'rejected' && (
                  <p className="text-xs text-red-700 bg-red-50 border border-red-100 rounded-xl px-3 py-2">
                    {t('materialDetail.adoptionStatusRejected')}
                    {myAdoption.reject_reason
                      ? `：${myAdoption.reject_reason}`
                      : ''}
                  </p>
                )}
              </div>
            )}

            {displayNotes && (
              <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100">
                <span className="text-[10px] text-yellow-600 font-black uppercase block mb-1">{t('materialDetail.supplierNotes')}</span>
                <p className="text-sm text-yellow-800 italic">{displayNotes}</p>
                {catalogDownloadButton && <div className="mt-3">{catalogDownloadButton}</div>}
              </div>
            )}
            {!displayNotes && catalogDownloadButton && (
              <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100">
                <span className="text-[10px] text-yellow-600 font-black uppercase block mb-2">{t('materialDetail.catalogPdf')}</span>
                {catalogDownloadButton}
              </div>
            )}
            {displayDescription && (
              <p className="text-sm text-gray-600 leading-relaxed">{displayDescription}</p>
            )}
          </div>
        </div>

        {/* Right column: overall rating + inspiration story (material detail only) */}
        <div className="lg:col-span-7 lg:col-start-6 lg:row-start-1 lg:row-span-2 order-2 flex flex-col gap-4 sm:gap-5">
          <MaterialEvaluationsSection
            evaluations={evaluations}
            readOnly={permissions.evaluationsReadOnly}
            showAggregateLabel={permissions.showAggregateEvaluations}
            interactive={permissions.canUseEvaluationSliders}
            hasSubmitted={hasSubmittedRating}
            onSubmitRating={handleSubmitEvaluation}
            projectName={ratingProjectName}
            unreadCount={isOwnSupplierMaterial ? sectionUnread.eval : 0}
            myEvaluations={myEvaluation?.evaluations ?? null}
            latestEvaluation={isOwnSupplierMaterial ? latestEvaluation : null}
            isSupplierView={isOwnSupplierMaterial}
            onDisputeLatest={isOwnSupplierMaterial ? handleDisputeLatest : undefined}
          />
          <MaterialInspirationStoriesSection
            stories={inspirationStories}
            onStoriesChange={handleInspirationStoriesChange}
            user={user}
            isPublicView={isPublicView}
            materialId={material.id}
            material={material}
            canSubmitDesignerStory={permissions.canSubmitDesignerStory}
            canSubmitBrandStory={permissions.canSubmitBrandStory}
            materialSupplierId={material.supplierId}
            persistBrandStories={permissions.canSubmitBrandStory && isManageMode}
            isLoading={inspirationStoriesLoading}
            unreadCount={isOwnSupplierMaterial ? sectionUnread.story : 0}
          />
        </div>

        {/* MOOD tags — remaining content */}
        <div className="lg:col-span-5 order-3 lg:row-start-2">
          <MaterialMoodTagsSection
            moodTags={moodTags}
            onMoodTagsChange={
              permissions.canAddBrandMoodTags || permissions.canInteractMoodTags
                ? (next) => {
                    setMoodTags(next);
                    onMaterialUpdated?.(
                      buildMaterialDataPayload(
                        material,
                        buildHumanDnaSnapshot({
                          ...material,
                          ...materialDetail,
                          application_cases: applicationCases,
                          mood_tags: next,
                          inspiration_stories: inspirationStories,
                          evaluations,
                          evaluation_vote_count: evaluationVoteCount,
                        })
                      )
                    );
                  }
                : undefined
            }
            user={user}
            isPublicView={isPublicView}
            materialId={material.id}
            interactive={permissions.canInteractMoodTags}
            canAddCustomMoodTags={permissions.canAddCustomMoodTags}
            canAddBrandMoodTags={permissions.canAddBrandMoodTags}
            onMoodTagInteract={permissions.canInteractMoodTags ? handleMoodTagInteract : undefined}
            compact
            unreadCount={isOwnSupplierMaterial ? sectionUnread.mood : 0}
          />
        </div>
        </div>

        {isManageMode && (
          <div className="mt-6 pt-5 border-t border-gray-100 flex justify-end">
            <MaterialManageActionBar
              onSaveDraft={handleSaveDraft}
              onRepublish={handleRepublish}
              isSavingDraft={isSavingDraft}
              isRepublishing={isRepublishing}
            />
          </div>
        )}
      </div>

      {/* Sample Request Dialog */}
      {isRequestingSample && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">{t('materialDetail.sampleTitle')}</h2>
            <form onSubmit={handleSampleOrder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.recipient')}</label>
                <input 
                  required 
                  type="text" 
                  value={sampleForm.contactName}
                  onChange={e => setSampleForm({...sampleForm, contactName: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.phone')}</label>
                <input 
                  required 
                  type="tel" 
                  value={sampleForm.phone}
                  onChange={e => setSampleForm({...sampleForm, phone: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.address')}</label>
                <textarea 
                  required 
                  value={sampleForm.address}
                  onChange={e => setSampleForm({...sampleForm, address: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black h-24 resize-none"
                  placeholder={t('materialDetail.addressPlaceholder')}
                ></textarea>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsRequestingSample(false)} className="flex-1 py-3 text-gray-500 font-bold">{t('common.cancel')}</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold shadow-lg shadow-black/20">{t('materialDetail.confirmSample')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quote Dialog */}
      {isQuoting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">{t('materialDetail.quoteTitle')}</h2>
            <form onSubmit={handleQuoteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.projectName')}</label>
                <input required type="text" value={quoteForm.project} onChange={e => setQuoteForm({...quoteForm, project: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.projectLocation')}</label>
                <input required type="text" value={quoteForm.address} onChange={e => setQuoteForm({...quoteForm, address: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.estimatedArea')}</label>
                  <input required type="number" value={quoteForm.area} onChange={e => setQuoteForm({...quoteForm, area: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.deliveryDate')}</label>
                  <input required type="date" value={quoteForm.date} onChange={e => setQuoteForm({...quoteForm, date: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">{t('materialDetail.extraNotes')}</label>
                <textarea value={quoteForm.notes} onChange={e => setQuoteForm({...quoteForm, notes: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black h-20 resize-none" placeholder={t('materialDetail.notesPlaceholder')}></textarea>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsQuoting(false)} className="flex-1 py-3 text-gray-500 font-bold">{t('common.cancel')}</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold shadow-lg shadow-black/20">{t('materialDetail.submitRequest')}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showAdoptionModal && user?.role === 'DESIGNER' && (
        <ProjectAdoptionModal
          open={showAdoptionModal}
          materialId={material.id}
          designerId={user.id}
          onClose={() => setShowAdoptionModal(false)}
          onSubmitted={(row) => setMyAdoption(row)}
        />
      )}
    </div>
  );
};

export default MaterialDetail;

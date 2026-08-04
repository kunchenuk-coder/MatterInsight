
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Material, User, Inquiry, SampleRequest, MaterialStatus, InquiryFormPayload } from '../types';
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
import type { MaterialHumanDna, MaterialEvaluations, InspirationStory } from '../types/materialDetail';
import {
  hasUserRatedMaterial,
  submitMaterialEvaluation,
} from '../services/materialEvaluationService';
import { fetchMaterialInspirationStories } from '../services/inspirationStoryService';
import { fetchMaterialMoodTags } from '../services/moodTagService';
import useMaterialEventLog from '../hooks/useMaterialEventLog';
import useMaterialViewCount from '../hooks/useMaterialViewCount';
import useMarkNotificationsRead from '../hooks/useMarkNotificationsRead';
import { portalFromUserRole } from '../utils/appPortal';
import { isSupabaseConfigured } from '../services/supabaseClient';

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
}

const MaterialDetail: React.FC<MaterialDetailProps> = ({ 
  material, user, onBack, onDeductPoints, onSampleRequest, onInquiry,
  inquiries, sampleRequests, isPublicView = false, backLabel,
  editMode = false, fromSupplierDashboard = false, onMaterialUpdated,
}) => {
  const [selectedVariant, setSelectedVariant] = useState((material.variants && material.variants[0]) || { id: 'default', colorCode: '#FFFFFF', imageUrl: material.image, name: '默认' });
  const [isQuoting, setIsQuoting] = useState(false);
  const [isRequestingSample, setIsRequestingSample] = useState(false);
  const [sampleForm, setSampleForm] = useState({ address: '', contactName: user?.name || '', phone: '' });
  const [quoteForm, setQuoteForm] = useState({ project: '', address: '', area: '', date: '', notes: '' });
  const [copySuccess, setCopySuccess] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isRepublishing, setIsRepublishing] = useState(false);
  const [toast, setToast] = useState<{ message: string; tone: 'success' | 'error' } | null>(null);

  const materialDetail = useMemo(() => toMaterialDetail(material), [material]);
  const [applicationCases, setApplicationCases] = useState(materialDetail.application_cases);
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
  const supplierViewer = isSupplierUser(user);
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

  /** 材料商进入详情 → 将该材料的 tag_added 未读清零 */
  useMarkNotificationsRead({
    enabled:
      Boolean(user) &&
      supplierViewer &&
      !isPublicView &&
      isSupabaseConfigured() &&
      Boolean(material.id),
    types: ['tag_added'],
    targetId: material.id,
    portal: 'supplier',
  });

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
    setApplicationCases(materialDetail.application_cases);
    setEvaluations(materialDetail.evaluations);
    setEvaluationVoteCount(materialDetail.evaluation_vote_count ?? 0);
  }, [
    material.id,
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
    if (user?.role === 'DESIGNER') {
      setHasSubmittedRating(hasUserRatedMaterial(user.id, material.id));
    } else {
      setHasSubmittedRating(false);
    }
  }, [user?.id, user?.role, material.id]);

  // Generate Matter-ID
  const getCategoryAbbr = (cat: string) => {
    const map: Record<string, string> = {
      '石材': 'ST', '木材': 'WD', '金属': 'MT', '玻璃': 'GL', '涂料': 'PT', '织物': 'TX', '复合': 'CP'
    };
    return map[cat] || 'XX';
  };
  const matterId = `MAT-${getCategoryAbbr(material.category)}-${material.id.slice(-4).toUpperCase()}`;

  // Check if brand should be obfuscated
  const hasRequestedSample = user ? sampleRequests.some(req => req.materialId === material.id && req.designerId === user.id) : false;
  const hasInquired = user ? inquiries.some(inq => inq.materialId === material.id && inq.designerId === user.id) : false;
  const displayBrand = (isPublicView || hasRequestedSample || hasInquired || (user && (user.role === 'ADMIN' || user.company === material.brand))) 
    ? material.brand 
    : material.brand.split('').map((c, i) => i === 0 || i === material.brand.length - 1 ? c : '*').join('');

  // Check if rating is allowed — designers may rate directly from detail page (one-time submit).
  const handleSubmitEvaluation = async (submission: MaterialEvaluations) => {
    if (!user || user.role !== 'DESIGNER') return;

    const result = await submitMaterialEvaluation({
      userId: user.id,
      materialId: material.id,
      material,
      submission,
      currentEvaluations: evaluations,
      voteCount: evaluationVoteCount,
    });

    if (!result.ok) {
      showToast(result.error, 'error');
      return;
    }

    setEvaluations(result.evaluations);
    setEvaluationVoteCount(result.voteCount);
    setHasSubmittedRating(true);
    onMaterialUpdated?.(result.material);
    showToast('评分已提交，综合评估已更新', 'success');
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
          {backLabel ?? (isPublicView ? '探索公开库' : isManageMode ? '返回材料商后台' : '返回列表')}
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
              {copySuccess ? '✓ 已复制链接' : '📢 分享材料'}
            </button>
          )}
          {!isPublicView && (
            <div className="flex items-center gap-2">
              {permissions.showManageModeBanner && (
                <span className="bg-violet-100 text-violet-800 px-3 py-1.5 rounded-full text-[10px] font-black uppercase tracking-wider">
                  材料商编辑模式
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
          mainImageAlt={material.name}
          colorAccent={selectedVariant.colorCode}
          aiTrainedStatus={materialDetail.ai_trained_status}
          applicationCases={applicationCases}
          isSupplierEditMode={isManageMode}
          onApplicationCasesChange={isManageMode ? setApplicationCases : undefined}
          canUploadApplicationCases={permissions.canUploadApplicationCases}
          variantPicker={
            <div className="absolute bottom-4 left-4 right-4 flex flex-wrap gap-2 bg-black/20 backdrop-blur-md p-3 rounded-2xl">
              {material.variants?.map(v => (
                <button
                  key={v.id}
                  onClick={() => setSelectedVariant(v)}
                  title={v.name}
                  className={`w-8 h-8 rounded-full border-2 transition-all hover:scale-110 ${selectedVariant.id === v.id ? 'scale-110 border-white ring-2 ring-black' : 'border-white/50'}`}
                  style={{ backgroundColor: v.colorCode }}
                />
              ))}
            </div>
          }
        />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8">
        {/* 1–2. Material information */}
        <div className="lg:col-span-5 order-1 lg:row-start-1">
          <div className="space-y-4 sm:space-y-5">
            <div>
              <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
                <h1 className="text-2xl sm:text-3xl font-bold">{material.name}</h1>
                <span className="text-xs font-bold text-gray-400 tabular-nums">
                  👀 浏览 {viewCount}
                </span>
              </div>
              <p className="text-gray-500 font-medium">
                <span className={!isPublicView && !hasRequestedSample && !hasInquired && (!user || (user.role !== 'ADMIN' && user.company !== material.brand)) ? 'blur-[4px] select-none' : ''}>
                  {displayBrand}
                </span>
                {!isPublicView && !hasRequestedSample && !hasInquired && user?.role === 'DESIGNER' && (
                  <span className="ml-2 text-[10px] bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-bold">申请后可见品牌</span>
                )}
                {isPublicView && (
                  <span className="ml-2 text-[10px] bg-black text-white px-2 py-0.5 rounded-full font-bold">公开预览</span>
                )}
                <span className="mx-2">·</span>
                {material.category}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">规格尺寸</span>
                <span className="text-sm font-semibold">{material.specifications}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">价格区间</span>
                <span className="text-sm font-semibold">{material.priceRange}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">防火等级</span>
                <span className="text-sm font-semibold">{material.fireRating}</span>
              </div>
              <div className="bg-gray-50 p-3 rounded-xl border border-gray-100">
                <span className="text-[10px] text-gray-400 font-bold uppercase block mb-1">库存/周期</span>
                <span className="text-sm font-semibold">{material.stock ? '现货' : '定制'} · {material.leadTime}</span>
              </div>
            </div>

            {!supplierViewer && (
              <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
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
                  申领小样 ({material.pointsNeeded.sample}点)
                </button>
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
                  申请报价
                </button>
              </div>
            )}

            {material.supplierNotes && (
              <div className="bg-yellow-50 p-4 rounded-2xl border border-yellow-100">
                <span className="text-[10px] text-yellow-600 font-black uppercase block mb-1">材料商备注</span>
                <p className="text-sm text-yellow-800 italic">{material.supplierNotes}</p>
              </div>
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
            <h2 className="text-2xl font-bold mb-6">申领材料小样</h2>
            <form onSubmit={handleSampleOrder} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">收件人姓名</label>
                <input 
                  required 
                  type="text" 
                  value={sampleForm.contactName}
                  onChange={e => setSampleForm({...sampleForm, contactName: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">联系电话</label>
                <input 
                  required 
                  type="tel" 
                  value={sampleForm.phone}
                  onChange={e => setSampleForm({...sampleForm, phone: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" 
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">详细收货地址</label>
                <textarea 
                  required 
                  value={sampleForm.address}
                  onChange={e => setSampleForm({...sampleForm, address: e.target.value})}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black h-24 resize-none"
                  placeholder="请输入完整的收货地址..."
                ></textarea>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsRequestingSample(false)} className="flex-1 py-3 text-gray-500 font-bold">取消</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold shadow-lg shadow-black/20">确认申领</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quote Dialog */}
      {isQuoting && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-md p-8 rounded-3xl shadow-2xl">
            <h2 className="text-2xl font-bold mb-6">申请详细报价</h2>
            <form onSubmit={handleQuoteSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">项目名称</label>
                <input required type="text" value={quoteForm.project} onChange={e => setQuoteForm({...quoteForm, project: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">项目所在地</label>
                <input required type="text" value={quoteForm.address} onChange={e => setQuoteForm({...quoteForm, address: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">预估面积 (㎡)</label>
                  <input required type="number" value={quoteForm.area} onChange={e => setQuoteForm({...quoteForm, area: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1">交付时间</label>
                  <input required type="date" value={quoteForm.date} onChange={e => setQuoteForm({...quoteForm, date: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1">额外备注</label>
                <textarea value={quoteForm.notes} onChange={e => setQuoteForm({...quoteForm, notes: e.target.value})} className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl outline-none focus:border-black h-20 resize-none" placeholder="如有特殊需求请填写..."></textarea>
              </div>
              <div className="pt-4 flex gap-4">
                <button type="button" onClick={() => setIsQuoting(false)} className="flex-1 py-3 text-gray-500 font-bold">取消</button>
                <button type="submit" className="flex-1 py-3 bg-black text-white rounded-xl font-bold shadow-lg shadow-black/20">提交申请</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default MaterialDetail;

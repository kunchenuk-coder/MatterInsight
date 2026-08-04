
import React, { useCallback, useEffect, useState } from 'react';
import { User, Material, Category, PendingMaterial, SampleRequest, MaterialStatus } from '../types';
import { fetchReadUrlsForObjectKeys, resolveUrlFromMap } from '../services/assetReadUrlService';
import { parseOssObjectKey } from '../utils/parseOssObjectKey';
import {
  fetchDesignersForAdmin,
  type AdminDesignerRow,
} from '../services/profileService';
import {
  approveInspirationStory,
  deleteAdminMaterialMoodTag,
  deleteInspirationStory,
  fetchAdminMoodTags,
  fetchInspirationStoryHistory,
  fetchPendingInspirationStories,
  rejectInspirationStory,
  type AdminMaterialMoodGroup,
  type AdminMoodTagChip,
  type AdminStoryRow,
} from '../services/adminModerationService';
import {
  fetchSupplierEvaluations,
  type AdminSupplierEvaluation,
} from '../services/adminAnalyticsService';
import { isSupabaseConfigured } from '../services/supabaseClient';

interface AdminDashboardProps {
  user: User;
  library: Material[];
  setLibrary: React.Dispatch<React.SetStateAction<Material[]>>;
  pendingList: PendingMaterial[];
  onApprove: (id: string, comment?: string) => void;
  onReject: (id: string, comment?: string) => void;
  sampleRequests: SampleRequest[];
  onShipSample: (id: string) => void | Promise<void>;
  verificationRequests: User[];
  onVerifySupplier: (userId: string) => void;
}

type AdminSubTab =
  | 'DESIGNERS'
  | 'MATERIALS'
  | 'SUPPLIERS'
  | 'PENDING'
  | 'SAMPLES'
  | 'VERIFICATIONS'
  | 'STORIES'
  | 'MOOD_TAGS';

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  user, library, setLibrary, pendingList, onApprove, onReject, sampleRequests, onShipSample,
  verificationRequests, onVerifySupplier
}) => {
  const [subTab, setSubTab] = useState<AdminSubTab>('DESIGNERS');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'ALL'>('ALL');
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [viewingSupplierProducts, setViewingSupplierProducts] = useState<string | null>(null);
  const [viewingPendingMaterial, setViewingPendingMaterial] = useState<PendingMaterial | null>(null);
  const [viewingVerificationDoc, setViewingVerificationDoc] = useState<User | null>(null);
  const [verificationDocDisplayUrl, setVerificationDocDisplayUrl] = useState('');
  const [verificationDocLoading, setVerificationDocLoading] = useState(false);
  const [auditAction, setAuditAction] = useState<{ id: string, type: 'APPROVE' | 'REJECT' } | null>(null);
  const [auditComment, setAuditComment] = useState('');
  const [designers, setDesigners] = useState<AdminDesignerRow[]>([]);
  const [designersLoading, setDesignersLoading] = useState(false);
  const [pendingStories, setPendingStories] = useState<AdminStoryRow[]>([]);
  const [storyHistory, setStoryHistory] = useState<AdminStoryRow[]>([]);
  const [storiesLoading, setStoriesLoading] = useState(false);
  const [storyReviewTab, setStoryReviewTab] = useState<'pending' | 'history'>('pending');
  const [storyRejectId, setStoryRejectId] = useState<string | null>(null);
  const [storyRejectReason, setStoryRejectReason] = useState('');
  const [storyActionBusy, setStoryActionBusy] = useState<string | null>(null);
  const [moodGroups, setMoodGroups] = useState<AdminMaterialMoodGroup[]>([]);
  const [moodTagsLoading, setMoodTagsLoading] = useState(false);
  const [moodTagBusy, setMoodTagBusy] = useState<string | null>(null);
  const [supplierEvals, setSupplierEvals] = useState<AdminSupplierEvaluation[]>([]);
  const [suppliersLoading, setSuppliersLoading] = useState(false);

  const loadDesigners = useCallback(async () => {
    setDesignersLoading(true);
    try {
      const rows = await fetchDesignersForAdmin();
      setDesigners(rows);
    } finally {
      setDesignersLoading(false);
    }
  }, []);

  const loadSupplierEvals = useCallback(async () => {
    setSuppliersLoading(true);
    try {
      if (!isSupabaseConfigured()) {
        setSupplierEvals([]);
        return;
      }
      setSupplierEvals(await fetchSupplierEvaluations());
    } finally {
      setSuppliersLoading(false);
    }
  }, []);

  const loadPendingStories = useCallback(async () => {
    setStoriesLoading(true);
    try {
      const [pending, history] = await Promise.all([
        fetchPendingInspirationStories(),
        fetchInspirationStoryHistory(),
      ]);
      setPendingStories(pending);
      setStoryHistory(history);
    } finally {
      setStoriesLoading(false);
    }
  }, []);

  const loadMoodTags = useCallback(async () => {
    setMoodTagsLoading(true);
    try {
      setMoodGroups(await fetchAdminMoodTags());
    } finally {
      setMoodTagsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (subTab === 'DESIGNERS') void loadDesigners();
    if (subTab === 'SUPPLIERS') void loadSupplierEvals();
    if (subTab === 'STORIES') void loadPendingStories();
    if (subTab === 'MOOD_TAGS') void loadMoodTags();
  }, [subTab, loadDesigners, loadSupplierEvals, loadPendingStories, loadMoodTags]);

  useEffect(() => {
    if (subTab === 'SAMPLES') {
      console.info('[AdminDashboard] sampleRequests from props:', sampleRequests.length, sampleRequests);
    }
  }, [subTab, sampleRequests]);

  // Badge count for story review tab
  useEffect(() => {
    void loadPendingStories();
  }, [loadPendingStories]);

  const handleApproveStory = async (id: string) => {
    setStoryActionBusy(id);
    const result = await approveInspirationStory(id);
    setStoryActionBusy(null);
    if (!result.ok) {
      alert(result.error || '通过失败');
      return;
    }
    await loadPendingStories();
  };

  const handleRejectStoryConfirm = async () => {
    if (!storyRejectId) return;
    setStoryActionBusy(storyRejectId);
    const result = await rejectInspirationStory(storyRejectId, storyRejectReason);
    setStoryActionBusy(null);
    if (!result.ok) {
      alert(result.error || '拒绝失败');
      return;
    }
    setStoryRejectId(null);
    setStoryRejectReason('');
    await loadPendingStories();
  };

  const handleDeleteStory = async (id: string) => {
    if (!window.confirm('确认物理删除该灵感故事？此操作不可恢复。')) return;
    setStoryActionBusy(id);
    const result = await deleteInspirationStory(id);
    setStoryActionBusy(null);
    if (!result.ok) {
      alert(result.error || '删除失败');
      return;
    }
    await loadPendingStories();
  };
  const handleDeleteMoodTag = async (
    group: AdminMaterialMoodGroup,
    chip: AdminMoodTagChip
  ) => {
    if (!window.confirm(`确认从「${group.material_name}」删除标签「${chip.tag_name}」？`)) return;
    const busyKey = `${group.material_id}:${chip.tag_name}`;
    setMoodTagBusy(busyKey);
    const result = await deleteAdminMaterialMoodTag({
      material_id: group.material_id,
      tag_name: chip.tag_name,
      relation_ids: chip.relation_ids,
    });
    setMoodTagBusy(null);
    if (!result.ok) {
      alert(result.error || '删除失败');
      return;
    }
    setMoodGroups((prev) =>
      prev
        .map((g) =>
          g.material_id !== group.material_id
            ? g
            : {
                ...g,
                tags: g.tags.filter(
                  (t) => t.tag_name.toLowerCase() !== chip.tag_name.toLowerCase()
                ),
              }
        )
        .filter((g) => g.tags.length > 0)
    );
  };

  const formatStoryTime = (iso: string) => {
    try {
      return new Date(iso).toLocaleString('zh-CN');
    } catch {
      return iso || '—';
    }
  };

  const authorRoleLabel = (role: string | null, isBrand: boolean) => {
    const r = (role ?? '').toLowerCase();
    if (r === 'supplier' || isBrand) return '材料商（品牌故事）';
    if (r === 'designer') return '设计师';
    if (r === 'admin') return '管理员';
    return role || '未知';
  };
  const openVerificationDoc = async (req: User) => {
    setViewingVerificationDoc(req);
    setVerificationDocDisplayUrl('');
    const stored = req.verificationDoc?.trim();
    if (!stored) return;

    const key = parseOssObjectKey(stored);
    if (!key && (stored.startsWith('data:') || stored.startsWith('http'))) {
      setVerificationDocDisplayUrl(stored);
      return;
    }

    setVerificationDocLoading(true);
    try {
      const urlMap = await fetchReadUrlsForObjectKeys([key ?? stored]);
      const resolved = resolveUrlFromMap(stored, key, urlMap);
      setVerificationDocDisplayUrl(resolved);
    } finally {
      setVerificationDocLoading(false);
    }
  };

  const closeVerificationDoc = () => {
    setViewingVerificationDoc(null);
    setVerificationDocDisplayUrl('');
    setVerificationDocLoading(false);
  };

  const formatLastActive = (iso: string | null) => {
    if (!iso) return '—';
    try {
      return new Date(iso).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '—';
    }
  };

  // 收入预估：优先用 commerce_orders GMV 合计，否则回退浏览/收藏启发式
  const totalClicks = library.reduce((acc, m) => acc + (m.clicks || 0), 0);
  const totalSaves = library.reduce((acc, m) => acc + (m.saves || 0), 0);
  const gmvTotal = supplierEvals.reduce((acc, s) => acc + (s.gmvCny || 0), 0);
  const estimatedIncome =
    gmvTotal > 0
      ? gmvTotal.toFixed(2)
      : (totalClicks * 0.5 + totalSaves * 2).toFixed(2);

  /** 本地无云端时的品牌聚合回退（避免空白） */
  const fallbackSuppliers: AdminSupplierEvaluation[] = Array.from(
    new Set(library.map((m) => m.supplierId || m.brand))
  ).map((key, idx) => {
    const products = library.filter((m) => (m.supplierId || m.brand) === key);
    const brand = products[0]?.brand || key;
    return {
      id: products[0]?.supplierId || `local_${idx}`,
      name: brand,
      email: '',
      publishedCount: products.length,
      pointsConsumed: 0,
      gmvCny: 0,
      risk: 'Low' as const,
    };
  });

  const suppliers =
    isSupabaseConfigured() && supplierEvals.length > 0
      ? supplierEvals
      : isSupabaseConfigured()
        ? supplierEvals
        : fallbackSuppliers;

  const filteredLibrary = library.filter(m => selectedCategory === 'ALL' || m.category === selectedCategory);

  const materialQuoteCount = (m: Material) =>
    typeof m.quoteCount === 'number'
      ? m.quoteCount
      : 0;

  const handleUpdateMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingMaterial) {
      setLibrary(prev => prev.map(m => m.id === editingMaterial.id ? editingMaterial : m));
      setEditingMaterial(null);
      alert('材料信息已更新');
    }
  };

  const exportCSV = (data: any[], filename: string) => {
    if (!data || data.length === 0) return;
    
    const headers = Object.keys(data[0]);
    const csvContent = [
      headers.join(','),
      ...data.map(row => 
        headers.map(header => {
          let cell = row[header] === null || row[header] === undefined ? '' : String(row[header]);
          // Escape quotes and wrap in quotes if contains comma or newline
          cell = cell.replace(/"/g, '""');
          if (cell.includes(',') || cell.includes('\n') || cell.includes('"')) {
            cell = `"${cell}"`;
          }
          return cell;
        }).join(',')
      )
    ].join('\n');

    // Add UTF-8 BOM to prevent garbled text in Excel
    const BOM = '\uFEFF';
    const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto py-10 space-y-10">
      <header className="flex justify-between items-center">
        <div>
          <h1 className="text-4xl font-black tracking-tighter uppercase">运营管控后台</h1>
          <p className="text-gray-400 font-medium">数据透明化 · 流程标准化 · 生态健康化</p>
        </div>
        <div className="flex gap-4">
           <div className="bg-black text-white px-8 py-3 rounded-2xl flex flex-col items-center">
              <span className="text-[10px] font-bold opacity-50 uppercase tracking-widest">总计预估收入 (CNY)</span>
              <span className="text-xl font-black">¥ {estimatedIncome}</span>
           </div>
        </div>
      </header>

      <div className="flex bg-gray-100 p-1.5 rounded-[24px] w-fit">
        <button onClick={() => setSubTab('DESIGNERS')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'DESIGNERS' ? 'bg-white shadow-md' : 'text-gray-400'}`}>设计师管理</button>
        <button onClick={() => setSubTab('MATERIALS')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'MATERIALS' ? 'bg-white shadow-md' : 'text-gray-400'}`}>材料库监管</button>
        <button onClick={() => setSubTab('SUPPLIERS')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'SUPPLIERS' ? 'bg-white shadow-md' : 'text-gray-400'}`}>供应商评估</button>
        <button onClick={() => setSubTab('SAMPLES')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'SAMPLES' ? 'bg-white shadow-md' : 'text-gray-400'}`}>
          小样申请 {sampleRequests.filter(s => s.status === 'PENDING').length > 0 && <span className="ml-1 bg-orange-500 text-white px-1.5 py-0.5 rounded-full text-[8px]">{sampleRequests.filter(s => s.status === 'PENDING').length}</span>}
        </button>
        <button onClick={() => setSubTab('PENDING')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'PENDING' ? 'bg-white shadow-md' : 'text-gray-400'}`}>
          上架审核 {pendingList.filter(p => p.status === MaterialStatus.PENDING).length > 0 && <span className="ml-1 bg-red-500 text-white px-1.5 py-0.5 rounded-full text-[8px]">{pendingList.filter(p => p.status === MaterialStatus.PENDING).length}</span>}
        </button>
        <button onClick={() => setSubTab('VERIFICATIONS')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'VERIFICATIONS' ? 'bg-white shadow-md' : 'text-gray-400'}`}>
          供应商认证 {verificationRequests.length > 0 && <span className="ml-1 bg-blue-500 text-white px-1.5 py-0.5 rounded-full text-[8px]">{verificationRequests.length}</span>}
        </button>
        <button onClick={() => setSubTab('STORIES')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'STORIES' ? 'bg-white shadow-md' : 'text-gray-400'}`}>
          灵感故事审核 {pendingStories.length > 0 && <span className="ml-1 bg-amber-500 text-white px-1.5 py-0.5 rounded-full text-[8px]">{pendingStories.length}</span>}
        </button>
        <button onClick={() => setSubTab('MOOD_TAGS')} className={`px-8 py-3 rounded-2xl text-xs font-black uppercase transition-all ${subTab === 'MOOD_TAGS' ? 'bg-white shadow-md' : 'text-gray-400'}`}>
          情绪标签管理
        </button>
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {subTab === 'DESIGNERS' && (
          <div>
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">注册名</th>
                   <th className="p-6">剩余积分</th>
                   <th className="p-6">粉丝 / 关注</th>
                   <th className="p-6">最后活跃</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {designersLoading ? (
                   <tr>
                     <td colSpan={5} className="p-16 text-center text-gray-400 text-sm font-medium">
                       正在加载设计师数据…
                     </td>
                   </tr>
                 ) : designers.length === 0 ? (
                   <tr>
                     <td colSpan={5} className="p-16 text-center text-gray-400 text-sm">
                       暂无已注册设计师
                     </td>
                   </tr>
                 ) : (
                 designers.map(d => (
                   <tr key={d.id} className="border-b hover:bg-gray-50 transition-colors">
                     <td className="p-6">
                        <p className="font-bold">{d.name}</p>
                        <p className="text-[10px] text-gray-400 break-all">{d.email}</p>
                     </td>
                     <td className="p-6 font-black">{d.points}</td>
                     <td className="p-6 font-black tabular-nums">
                       {d.followersCount} / {d.followingCount}
                     </td>
                     <td className="p-6 text-xs text-gray-400">{formatLastActive(d.lastActive)}</td>
                     <td className="p-6 text-right space-x-4">
                       <button className="text-xs font-bold text-blue-600 hover:underline">对话记录</button>
                       <button className="text-xs font-bold text-red-500 hover:underline">禁言评论</button>
                       <button className="text-xs font-bold bg-black text-white px-3 py-1 rounded-lg">修改积分</button>
                     </td>
                   </tr>
                 ))
                 )}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">设计师总数: {designers.length} 位</p>
               <button
                 onClick={() =>
                   exportCSV(
                     designers.map((d) => ({
                       ID: d.id,
                       注册名: d.name,
                       邮箱: d.email,
                       剩余积分: d.points,
                       粉丝数: d.followersCount,
                       关注数: d.followingCount,
                       最后活跃: formatLastActive(d.lastActive),
                     })),
                     'designers_report.csv'
                   )
                 }
                 className="bg-white border px-6 py-2 rounded-xl text-xs font-bold shadow-sm"
               >导出 Excel 数据表</button>
             </div>
          </div>
        )}

        {subTab === 'MATERIALS' && (
          <div>
             <div className="p-6 bg-gray-50 border-b flex flex-wrap gap-2">
                <button 
                  onClick={() => setSelectedCategory('ALL')}
                  className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${selectedCategory === 'ALL' ? 'bg-black text-white' : 'bg-white text-gray-400 border'}`}
                >
                  全部
                </button>
                {Object.values(Category).map(cat => (
                  <button 
                    key={cat}
                    onClick={() => setSelectedCategory(cat)}
                    className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest transition-all ${selectedCategory === cat ? 'bg-black text-white' : 'bg-white text-gray-400 border'}`}
                  >
                    {cat}
                  </button>
                ))}
             </div>
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">材料信息</th>
                   <th className="p-6">品类</th>
                   <th className="p-6">浏览次数</th>
                   <th className="p-6">收藏次数</th>
                   <th className="p-6">报价次数</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {filteredLibrary.map(m => (
                   <tr key={m.id} className="border-b hover:bg-gray-50 transition-colors">
                     <td className="p-6 flex items-center gap-4">
                        <img src={m.image} className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold">{m.name}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-black">{m.brand}</p>
                        </div>
                     </td>
                     <td className="p-6 text-xs font-bold">{m.category}</td>
                     <td className="p-6 font-black text-blue-500">{m.clicks || 0}</td>
                     <td className="p-6 font-black text-green-500">{m.saves || 0}</td>
                     <td className="p-6 font-black text-purple-500">{materialQuoteCount(m)}</td>
                     <td className="p-6 text-right space-x-4">
                       <button 
                         onClick={() => setEditingMaterial(m)}
                         className="text-xs font-bold text-blue-600 hover:underline"
                       >
                         编辑信息
                       </button>
                       <button 
                         onClick={() => setLibrary(library.filter(lib => lib.id !== m.id))}
                         className="text-xs font-bold text-red-500 hover:underline"
                       >下架材料</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">材料单品总数: {filteredLibrary.length} 件</p>
               <button 
                 onClick={() => {
                   const exportData = filteredLibrary.map(m => ({
                     'ID': m.id,
                     '材料名称': m.name,
                     '品类': m.category,
                     '品牌': m.brand,
                     '规格说明': m.specifications,
                     '价格范围': m.priceRange,
                     '防火等级': m.fireRating,
                     '浏览次数': m.clicks || 0,
                     '收藏次数': m.saves || 0,
                     '报价次数': materialQuoteCount(m),
                   }));
                   exportCSV(exportData, `materials_report_${selectedCategory}.csv`);
                 }} 
                 className="bg-white border px-6 py-2 rounded-xl text-xs font-bold shadow-sm hover:bg-black hover:text-white transition-all"
               >
                 导出 Excel 详细表
               </button>
             </div>
          </div>
        )}

        {subTab === 'SUPPLIERS' && (
          <div>
             {suppliersLoading ? (
               <div className="p-16 text-center text-sm font-bold text-gray-400">正在加载供应商评估数据…</div>
             ) : (
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">材料商名称</th>
                   <th className="p-6">上架单品</th>
                   <th className="p-6">积分消费</th>
                   <th className="p-6">交易流水</th>
                   <th className="p-6">风险预警</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {suppliers.map(s => (
                    <tr key={s.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-6">
                        <p className="font-bold">{s.name || '（未命名）'}</p>
                        {s.email ? (
                          <p className="text-[10px] text-gray-400 font-bold mt-0.5">{s.email}</p>
                        ) : null}
                      </td>
                      <td className="p-6">
                        <button 
                          onClick={() => setViewingSupplierProducts(s.id)}
                          className="font-black text-blue-600 hover:underline"
                        >
                          {s.publishedCount}
                        </button>
                      </td>
                      <td className="p-6 font-black">{s.pointsConsumed}</td>
                      <td className="p-6 font-black">¥ {Number(s.gmvCny || 0).toFixed(2)}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${s.risk === 'Suspicious' ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-green-100 text-green-600'}`}>
                          {s.risk === 'Suspicious' ? '⚠️ AI检测异常: 引导线下私单' : '状态良好'}
                        </span>
                      </td>
                      <td className="p-6 text-right space-x-4">
                        <button className="text-xs font-bold text-blue-600 hover:underline">对话质询</button>
                        <button className="text-xs font-bold text-red-500 hover:underline">警告处分</button>
                      </td>
                    </tr>
                 ))}
                 {suppliers.length === 0 && (
                   <tr>
                     <td colSpan={6} className="p-16 text-center text-sm font-bold text-gray-400">
                       暂无材料商数据
                     </td>
                   </tr>
                 )}
               </tbody>
             </table>
             )}
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">入驻材料商: {suppliers.length} 家</p>
               <button
                 onClick={() =>
                   exportCSV(
                     suppliers.map((s) => ({
                       材料商ID: s.id,
                       名称: s.name,
                       邮箱: s.email,
                       上架单品: s.publishedCount,
                       积分消费: s.pointsConsumed,
                       交易流水: s.gmvCny,
                       风险: s.risk,
                     })),
                     'suppliers_report.csv'
                   )
                 }
                 className="bg-white border px-6 py-2 rounded-xl text-xs font-bold shadow-sm"
               >
                 导出 Excel 数据表
               </button>
             </div>
          </div>
        )}

        {subTab === 'SAMPLES' && (
          <div>
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">申请材料</th>
                   <th className="p-6">收件信息</th>
                   <th className="p-6">申请日期</th>
                   <th className="p-6">状态</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {sampleRequests.map(req => {
                   const m = library.find(x => x.id === req.materialId);
                   return (
                    <tr key={req.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-6 flex items-center gap-4">
                         <img src={m?.image} className="w-10 h-10 rounded-lg object-cover" />
                         <div>
                           <p className="font-bold">{m?.name}</p>
                           <p className="text-[10px] text-gray-400 uppercase font-black">{m?.brand}</p>
                         </div>
                      </td>
                      <td className="p-6">
                        <p className="text-xs font-bold">{req.contactName} ({req.phone})</p>
                        <p className="text-[10px] text-gray-400 truncate max-w-xs">{req.address}</p>
                      </td>
                      <td className="p-6 text-xs text-gray-400">{new Date(req.submitDate).toLocaleDateString()}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${req.status === 'PENDING' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                          {req.status === 'PENDING'
                            ? '待处理'
                            : req.status === 'SHIPPED_BY_ADMIN'
                              ? '平台已寄'
                              : req.status === 'SHIPPED_BY_SUPPLIER'
                                ? '材料商已寄'
                                : '已完成'}
                        </span>
                      </td>
                      <td className="p-6 text-right space-x-4">
                        {req.status === 'PENDING' && (
                          <button 
                            type="button"
                            onClick={() => {
                              void Promise.resolve(onShipSample(req.id));
                            }}
                            className="text-xs font-bold bg-black text-white px-4 py-2 rounded-xl hover:scale-105 transition-transform"
                          >
                            代寄并标记已寄出
                          </button>
                        )}
                      </td>
                    </tr>
                   );
                 })}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">小样申请总数: {sampleRequests.length} 件</p>
             </div>
          </div>
        )}

        {subTab === 'PENDING' && (
          <div>
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">申请材料</th>
                   <th className="p-6">提交者</th>
                   <th className="p-6">提交日期</th>
                   <th className="p-6">状态</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {pendingList.filter(p => p.status === MaterialStatus.PENDING).map(p => (
                   <tr key={p.id} className="border-b hover:bg-gray-50 transition-colors cursor-pointer" onClick={() => setViewingPendingMaterial(p)}>
                     <td className="p-6 flex items-center gap-4">
                        <img src={p.image} className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold">{p.name}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-black">{p.brand}</p>
                        </div>
                     </td>
                     <td className="p-6 text-xs font-bold">{p.submitterId}</td>
                     <td className="p-6 text-xs text-gray-400">{new Date(p.submitDate).toLocaleDateString()}</td>
                     <td className="p-6">
                       <span className="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest bg-yellow-100 text-yellow-600">
                         待审核
                       </span>
                     </td>
                     <td className="p-6 text-right space-x-4" onClick={(e) => e.stopPropagation()}>
                       <button 
                         onClick={() => onApprove(p.id)}
                         className="text-xs font-bold bg-black text-white px-4 py-2 rounded-xl hover:scale-105 transition-transform"
                       >
                         通过审核
                       </button>
                       <button 
                         onClick={() => setAuditAction({ id: p.id, type: 'REJECT' })}
                         className="text-xs font-bold text-red-500 hover:underline"
                       >
                         驳回申请
                       </button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">待审核申请: {pendingList.filter(p => p.status === MaterialStatus.PENDING).length} 件</p>
             </div>
          </div>
        )}

        {subTab === 'VERIFICATIONS' && (
          <div>
             {/* 移动端：卡片视图，避免宽表横向溢出导致操作列不可点 */}
             <div className="md:hidden p-4 space-y-4">
               {verificationRequests.map((req) => (
                 <div
                   key={req.id}
                   className="border border-gray-100 rounded-3xl p-5 shadow-sm bg-white space-y-4"
                 >
                   <div>
                     <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">供应商信息</p>
                     <p className="font-bold text-base break-words">{req.company}</p>
                     <p className="text-xs text-gray-400 break-all mt-1">{req.email}</p>
                   </div>
                   <div>
                     <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">联系电话</p>
                     <p className="font-black">{req.registeredPhone || '—'}</p>
                   </div>
                   <div>
                     <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest mb-1">认证文件</p>
                     {req.verificationDoc ? (
                       <button
                         type="button"
                         onClick={() => void openVerificationDoc(req)}
                         className="text-xs font-bold text-blue-600 hover:underline"
                       >
                         查看证件大图
                       </button>
                     ) : (
                       <p className="text-xs text-gray-400">未上传</p>
                     )}
                   </div>
                   <div className="pt-2 border-t border-gray-100 space-y-2">
                     <p className="text-[10px] font-black uppercase text-gray-400 tracking-widest">管理操作</p>
                     <button
                       type="button"
                       onClick={() => onVerifySupplier(req.id)}
                       className="w-full py-3 bg-black text-white rounded-xl text-xs font-bold active:scale-[0.98] transition-transform"
                     >
                       通过认证
                     </button>
                     <button
                       type="button"
                       className="w-full py-3 text-red-500 text-xs font-bold rounded-xl border border-red-100 bg-red-50/50"
                     >
                       驳回申请
                     </button>
                   </div>
                 </div>
               ))}
               {verificationRequests.length === 0 && (
                 <p className="p-12 text-center text-gray-300 italic">暂无待处理的认证申请</p>
               )}
             </div>

             {/* 桌面端：保留原表格 */}
             <table className="hidden md:table w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">供应商信息</th>
                   <th className="p-6">联系电话</th>
                   <th className="p-6">认证文件</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {verificationRequests.map(req => (
                   <tr key={req.id} className="border-b hover:bg-gray-50 transition-colors">
                     <td className="p-6">
                        <p className="font-bold">{req.company}</p>
                        <p className="text-[10px] text-gray-400">{req.email}</p>
                     </td>
                     <td className="p-6 font-black">{req.registeredPhone}</td>
                     <td className="p-6">
                        <button 
                          onClick={() => void openVerificationDoc(req)}
                          className="text-xs font-bold text-blue-600 hover:underline"
                        >
                          查看证件大图
                        </button>
                     </td>
                     <td className="p-6 text-right space-x-4">
                       <button 
                         onClick={() => onVerifySupplier(req.id)}
                         className="text-xs font-bold bg-black text-white px-4 py-2 rounded-xl hover:scale-105 transition-transform"
                       >
                         通过认证
                       </button>
                       <button className="text-xs font-bold text-red-500 hover:underline">驳回申请</button>
                     </td>
                   </tr>
                 ))}
                 {verificationRequests.length === 0 && (
                   <tr>
                     <td colSpan={4} className="p-20 text-center text-gray-300 italic">暂无待处理的认证申请</td>
                   </tr>
                 )}
               </tbody>
             </table>
          </div>
        )}

        {subTab === 'STORIES' && (
          <div>
            <div className="px-8 pt-8 pb-2 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
              <div>
                <h2 className="text-lg font-black">灵感故事审核</h2>
                <p className="text-xs text-gray-400 mt-1">数据源：inspiration_stories</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="flex bg-gray-100 p-1 rounded-xl">
                  <button
                    type="button"
                    onClick={() => setStoryReviewTab('pending')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
                      storyReviewTab === 'pending' ? 'bg-white shadow-sm' : 'text-gray-400'
                    }`}
                  >
                    待审核 {pendingStories.length > 0 && `(${pendingStories.length})`}
                  </button>
                  <button
                    type="button"
                    onClick={() => setStoryReviewTab('history')}
                    className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase transition-all ${
                      storyReviewTab === 'history' ? 'bg-white shadow-sm' : 'text-gray-400'
                    }`}
                  >
                    审核历史 {storyHistory.length > 0 && `(${storyHistory.length})`}
                  </button>
                </div>
                <button
                  type="button"
                  onClick={() => void loadPendingStories()}
                  className="text-xs font-bold border px-4 py-2 rounded-xl hover:bg-gray-50"
                >
                  刷新
                </button>
              </div>
            </div>

            {storyReviewTab === 'pending' ? (
              <>
                <table className="w-full text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                      <th className="p-6 w-[36%]">标题 / 正文摘要</th>
                      <th className="p-6 w-[18%]">作者角色</th>
                      <th className="p-6 w-[16%]">关联材料</th>
                      <th className="p-6 w-[14%]">提交时间</th>
                      <th className="p-6 w-[16%] text-right">审核操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storiesLoading ? (
                      <tr>
                        <td colSpan={5} className="p-16 text-center text-gray-400 text-sm">正在加载待审故事…</td>
                      </tr>
                    ) : pendingStories.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="p-16 text-center text-gray-300 italic">暂无待审核灵感故事</td>
                      </tr>
                    ) : (
                      pendingStories.map((story) => (
                        <tr key={story.id} className="border-b hover:bg-gray-50 transition-colors align-top">
                          <td className="p-6 w-[36%] max-w-0">
                            <p
                              className="font-bold text-sm text-gray-900 whitespace-normal break-all line-clamp-2"
                              title={story.title || undefined}
                            >
                              {story.title || '（无标题）'}
                            </p>
                            <p
                              className="text-xs text-gray-500 mt-2 leading-relaxed whitespace-normal break-all line-clamp-3"
                              title={story.content}
                            >
                              {story.content}
                            </p>
                          </td>
                          <td className="p-6 w-[18%]">
                            <p className="text-xs font-bold">{authorRoleLabel(story.author_role, story.is_brand_hint)}</p>
                            <p className="text-[10px] text-gray-400 mt-1 break-all">{story.author_email || story.designer_id}</p>
                          </td>
                          <td className="p-6 w-[16%]">
                            <p className="text-xs font-bold break-words">{story.material_name || '—'}</p>
                            <p className="text-[10px] text-gray-400 break-all mt-1">{story.material_id || ''}</p>
                          </td>
                          <td className="p-6 text-xs text-gray-400 whitespace-nowrap">{formatStoryTime(story.created_at)}</td>
                          <td className="p-6 text-right space-x-3 whitespace-nowrap">
                            <button
                              type="button"
                              disabled={storyActionBusy === story.id}
                              onClick={() => void handleApproveStory(story.id)}
                              className="text-xs font-bold bg-black text-white px-3 py-1.5 rounded-lg disabled:opacity-50"
                            >
                              通过
                            </button>
                            <button
                              type="button"
                              disabled={storyActionBusy === story.id}
                              onClick={() => {
                                setStoryRejectId(story.id);
                                setStoryRejectReason('');
                              }}
                              className="text-xs font-bold text-amber-700 hover:underline disabled:opacity-50"
                            >
                              拒绝
                            </button>
                            <button
                              type="button"
                              disabled={storyActionBusy === story.id}
                              onClick={() => void handleDeleteStory(story.id)}
                              className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="p-8 bg-gray-50 border-t">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    待审故事: {pendingStories.length} 条
                  </p>
                </div>
              </>
            ) : (
              <>
                <table className="w-full text-left border-collapse table-fixed">
                  <thead>
                    <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                      <th className="p-6 w-[34%]">标题 / 正文摘要</th>
                      <th className="p-6 w-[18%]">作者</th>
                      <th className="p-6 w-[14%]">关联材料</th>
                      <th className="p-6 w-[12%]">状态</th>
                      <th className="p-6 w-[14%]">提交时间</th>
                      <th className="p-6 w-[8%] text-right">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {storiesLoading ? (
                      <tr>
                        <td colSpan={6} className="p-16 text-center text-gray-400 text-sm">正在加载审核历史…</td>
                      </tr>
                    ) : storyHistory.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-16 text-center text-gray-300 italic">
                          暂无审核历史（已物理删除的记录不会出现在此）
                        </td>
                      </tr>
                    ) : (
                      storyHistory.map((story) => (
                        <tr key={story.id} className="border-b hover:bg-gray-50 transition-colors align-top">
                          <td className="p-6 max-w-0">
                            <p
                              className="font-bold text-sm text-gray-900 whitespace-normal break-all line-clamp-2"
                              title={story.title || undefined}
                            >
                              {story.title || '（无标题）'}
                            </p>
                            <p
                              className="text-xs text-gray-500 mt-2 leading-relaxed whitespace-normal break-all line-clamp-3"
                              title={story.content}
                            >
                              {story.content}
                            </p>
                            {story.status === 'rejected' && story.review_notes && (
                              <p className="text-[10px] text-gray-400 mt-2 line-clamp-2" title={story.review_notes}>
                                拒绝理由：{story.review_notes}
                              </p>
                            )}
                          </td>
                          <td className="p-6">
                            <p className="text-xs font-bold">{authorRoleLabel(story.author_role, story.is_brand_hint)}</p>
                            <p className="text-[10px] text-gray-400 mt-1 break-all">{story.author_email || story.designer_id}</p>
                          </td>
                          <td className="p-6 text-xs font-bold break-words">{story.material_name || '—'}</td>
                          <td className="p-6">
                            <span
                              className={`inline-flex items-center whitespace-nowrap px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide ${
                                story.status === 'published'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : story.status === 'rejected'
                                    ? 'bg-gray-100 text-gray-500'
                                    : 'bg-gray-100 text-gray-500'
                              }`}
                            >
                              {story.status === 'published'
                                ? '已通过'
                                : story.status === 'rejected'
                                  ? '已拒绝'
                                  : story.status}
                            </span>
                          </td>
                          <td className="p-6 text-xs text-gray-400 whitespace-nowrap">{formatStoryTime(story.created_at)}</td>
                          <td className="p-6 text-right">
                            <button
                              type="button"
                              disabled={storyActionBusy === story.id}
                              onClick={() => void handleDeleteStory(story.id)}
                              className="text-xs font-bold text-red-500 hover:underline disabled:opacity-50"
                            >
                              删除
                            </button>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
                <div className="p-8 bg-gray-50 border-t">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                    历史记录: {storyHistory.length} 条
                  </p>
                </div>
              </>
            )}
          </div>
        )}

        {subTab === 'MOOD_TAGS' && (
          <div>
            <div className="px-8 pt-8 pb-2 flex justify-between items-center gap-4">
              <div>
                <h2 className="text-lg font-black">情绪标签管理</h2>
                <p className="text-xs text-gray-400 mt-1">
                  按材料聚合展示 · 同名官方/设计师标签已合并 · 琥珀色=官方，紫色=社区
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadMoodTags()}
                className="text-xs font-bold border px-4 py-2 rounded-xl hover:bg-gray-50 shrink-0"
              >
                刷新
              </button>
            </div>
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                  <th className="p-6 w-[28%]">材料</th>
                  <th className="p-6">情绪标签组</th>
                </tr>
              </thead>
              <tbody>
                {moodTagsLoading ? (
                  <tr>
                    <td colSpan={2} className="p-16 text-center text-gray-400 text-sm">正在加载情绪标签…</td>
                  </tr>
                ) : moodGroups.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="p-16 text-center text-gray-300 italic">暂无情绪标签记录</td>
                  </tr>
                ) : (
                  moodGroups.map((group) => (
                    <tr key={group.material_id} className="border-b hover:bg-gray-50/80 transition-colors align-top">
                      <td className="p-6">
                        <p className="font-bold text-sm text-gray-900">{group.material_name}</p>
                        <p className="text-[10px] text-gray-400 mt-1">
                          {group.tags.length} 个标签
                        </p>
                      </td>
                      <td className="p-6">
                        <div className="flex flex-wrap gap-2">
                          {group.tags.map((chip) => {
                            const busyKey = `${group.material_id}:${chip.tag_name}`;
                            const chipClass = chip.is_brand
                              ? 'bg-amber-50 border-amber-200 text-amber-900'
                              : chip.is_custom
                                ? 'bg-violet-50 border-violet-200 text-violet-800'
                                : 'bg-gray-50 border-gray-200 text-gray-700';
                            return (
                              <span
                                key={`${group.material_id}:${chip.tag_name}`}
                                className={`inline-flex items-center gap-1.5 max-w-full pl-3 pr-1.5 py-1 rounded-full border text-xs font-bold ${chipClass}`}
                                title={
                                  chip.is_brand && chip.is_custom
                                    ? '官方 + 设计师共识'
                                    : chip.is_brand
                                      ? '官方品牌标签'
                                      : chip.is_custom
                                        ? '设计师自定义'
                                        : '社区标签'
                                }
                              >
                                <span className="truncate">{chip.tag_name}</span>
                                {chip.count > 0 && (
                                  <span className="tabular-nums opacity-70 font-black">
                                    {chip.count}
                                  </span>
                                )}
                                {chip.is_brand && (
                                  <span className="text-[9px] font-black uppercase tracking-wider opacity-60">
                                    官方
                                  </span>
                                )}
                                <button
                                  type="button"
                                  disabled={moodTagBusy === busyKey}
                                  onClick={() => void handleDeleteMoodTag(group, chip)}
                                  className="ml-0.5 w-5 h-5 rounded-full text-[11px] leading-none font-black text-current/50 hover:bg-black/10 hover:text-red-600 disabled:opacity-40"
                                  aria-label={`删除 ${chip.tag_name}`}
                                >
                                  ×
                                </button>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
            <div className="p-8 bg-gray-50 border-t flex flex-wrap gap-6 items-center">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                材料数: {moodGroups.length}
              </p>
              <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                标签总数:{' '}
                {moodGroups.reduce((acc, g) => acc + g.tags.length, 0)}
              </p>
            </div>
          </div>
        )}
      </div>

      {storyRejectId && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center p-6">
          <div className="bg-white rounded-[32px] max-w-md w-full p-8 shadow-2xl">
            <h3 className="text-xl font-black mb-2">拒绝灵感故事</h3>
            <p className="text-xs text-gray-400 mb-4">可选填拒绝理由，将写入 review_notes</p>
            <textarea
              value={storyRejectReason}
              onChange={(e) => setStoryRejectReason(e.target.value)}
              rows={4}
              placeholder="例如：内容与材料不符 / 疑似广告…"
              className="w-full border border-gray-200 rounded-2xl p-4 text-sm outline-none focus:border-black resize-none"
            />
            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => {
                  setStoryRejectId(null);
                  setStoryRejectReason('');
                }}
                className="flex-1 py-3 rounded-2xl text-sm font-bold text-gray-500 hover:bg-gray-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={!!storyActionBusy}
                onClick={() => void handleRejectStoryConfirm()}
                className="flex-1 py-3 rounded-2xl text-sm font-bold bg-black text-white disabled:opacity-50"
              >
                确认拒绝
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Verification Doc Modal */}
      {viewingVerificationDoc && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[200] flex items-center justify-center p-6" onClick={closeVerificationDoc}>
          <div className="max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 text-white">
              <h3 className="text-xl font-bold">{viewingVerificationDoc.company || viewingVerificationDoc.email} - 认证证件</h3>
              <button type="button" onClick={closeVerificationDoc} className="text-3xl">✕</button>
            </div>
            {verificationDocLoading ? (
              <div className="py-24 text-center text-white/70 text-sm font-medium">正在加载证件图片…</div>
            ) : verificationDocDisplayUrl ? (
              <img
                src={verificationDocDisplayUrl}
                className="w-full h-auto rounded-2xl shadow-2xl border border-white/10"
                alt="verification doc"
              />
            ) : (
              <div className="py-24 text-center text-white/60 text-sm">
                无法加载证件图片，请确认材料商已上传且 OSS 读取配置正常
              </div>
            )}
          </div>
        </div>
      )}

      {/* Edit Material Modal */}
      {editingMaterial && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl p-10 rounded-[40px] shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">编辑材料信息</h3>
              <button onClick={() => setEditingMaterial(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            <form onSubmit={handleUpdateMaterial} className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">材料名称</label>
                  <input 
                    type="text" 
                    value={editingMaterial.name}
                    onChange={e => setEditingMaterial({...editingMaterial, name: e.target.value})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">品牌</label>
                  <input 
                    type="text" 
                    value={editingMaterial.brand}
                    onChange={e => setEditingMaterial({...editingMaterial, brand: e.target.value})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">品类</label>
                  <select 
                    value={editingMaterial.category}
                    onChange={e => setEditingMaterial({...editingMaterial, category: e.target.value as Category})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  >
                    {Object.values(Category).map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">价格区间</label>
                  <input 
                    type="text" 
                    value={editingMaterial.priceRange}
                    onChange={e => setEditingMaterial({...editingMaterial, priceRange: e.target.value})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">防火等级</label>
                  <input 
                    type="text" 
                    value={editingMaterial.fireRating}
                    onChange={e => setEditingMaterial({...editingMaterial, fireRating: e.target.value})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">库存/周期</label>
                  <input 
                    type="text" 
                    value={editingMaterial.leadTime}
                    onChange={e => setEditingMaterial({...editingMaterial, leadTime: e.target.value})}
                    className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                  />
                </div>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">规格说明</label>
                <textarea 
                  value={editingMaterial.specifications}
                  onChange={e => setEditingMaterial({...editingMaterial, specifications: e.target.value})}
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black h-24 resize-none"
                ></textarea>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">材料商备注</label>
                <textarea 
                  value={editingMaterial.supplierNotes || ''}
                  onChange={e => setEditingMaterial({...editingMaterial, supplierNotes: e.target.value})}
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black h-24 resize-none"
                ></textarea>
              </div>
              <div className="flex gap-4 pt-4">
                <button type="button" onClick={() => setEditingMaterial(null)} className="flex-1 py-4 bg-gray-100 rounded-2xl font-bold">取消</button>
                <button type="submit" className="flex-1 py-4 bg-black text-white rounded-2xl font-bold">保存更改</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* Supplier Products Drill-down Modal */}
      {viewingSupplierProducts && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-4xl p-10 rounded-[40px] shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">
                {(suppliers.find((s) => s.id === viewingSupplierProducts)?.name ||
                  library.find((m) => m.supplierId === viewingSupplierProducts)?.brand ||
                  '材料商')}{' '}
                - 上架单品
              </h3>
              <button onClick={() => setViewingSupplierProducts(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {library
                .filter(
                  (m) =>
                    m.supplierId === viewingSupplierProducts ||
                    m.brand === viewingSupplierProducts
                )
                .map((m) => (
                <div key={m.id} className="bg-gray-50 rounded-3xl p-4 border border-gray-100">
                  <img src={m.image} className="w-full aspect-video object-cover rounded-2xl mb-4" />
                  <h4 className="font-bold mb-1">{m.name}</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400">{m.category}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-bold ${m.clicks > 0 ? 'text-gray-900' : 'text-gray-400'}`}>👀 {m.clicks || 0}</span>
                      <span className="text-[10px] font-bold text-gray-400">🤍 {m.saves || 0}</span>
                      <span className="text-[10px] font-bold text-purple-500">报价 {m.quoteCount || 0}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {/* Audit Comment Modal */}
      {auditAction && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md p-10 rounded-[40px] shadow-2xl">
            <h3 className="text-2xl font-black mb-6">{auditAction.type === 'APPROVE' ? '确认通过审核' : '确认驳回申请'}</h3>
            <div className="space-y-6">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">审核意见 / 驳回理由</label>
                <textarea 
                  value={auditComment}
                  onChange={e => setAuditComment(e.target.value)}
                  placeholder={auditAction.type === 'APPROVE' ? '请输入通过意见 (可选)' : '请输入驳回理由 (必填)'}
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black h-32 resize-none"
                ></textarea>
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={() => { setAuditAction(null); setAuditComment(''); }}
                  className="flex-1 py-4 bg-gray-100 rounded-2xl font-bold"
                >
                  取消
                </button>
                <button 
                  onClick={() => {
                    if (auditAction.type === 'REJECT' && !auditComment.trim()) {
                      alert('驳回申请必须填写理由');
                      return;
                    }
                    if (auditAction.type === 'APPROVE') {
                      onApprove(auditAction.id, auditComment);
                    } else {
                      onReject(auditAction.id, auditComment);
                    }
                    setAuditAction(null);
                    setAuditComment('');
                  }}
                  className={`flex-1 py-4 text-white rounded-2xl font-bold shadow-xl ${auditAction.type === 'APPROVE' ? 'bg-black shadow-black/20' : 'bg-red-500 shadow-red-500/20'}`}
                >
                  确认提交
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Pending Material Detail Modal */}
      {viewingPendingMaterial && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[180] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-4xl p-10 rounded-[40px] shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">申请详情: {viewingPendingMaterial.name}</h3>
              <button onClick={() => setViewingPendingMaterial(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
              <div className="space-y-6">
                <img src={viewingPendingMaterial.image} className="w-full aspect-video object-cover rounded-3xl shadow-lg" />
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">品牌</p>
                    <p className="font-bold">{viewingPendingMaterial.brand}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">品类</p>
                    <p className="font-bold">{viewingPendingMaterial.category}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">价格区间</p>
                    <p className="font-bold">{viewingPendingMaterial.priceRange}</p>
                  </div>
                  <div className="bg-gray-50 p-4 rounded-2xl">
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">防火等级</p>
                    <p className="font-bold">{viewingPendingMaterial.fireRating}</p>
                  </div>
                </div>
              </div>
              
              <div className="space-y-6">
                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">规格说明</p>
                  <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-2xl">{viewingPendingMaterial.specifications}</p>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">供应商备注</p>
                  <p className="text-sm text-gray-600 bg-gray-50 p-4 rounded-2xl italic">"{viewingPendingMaterial.supplierNotes || '无'}"</p>
                </div>
                {viewingPendingMaterial.variants && viewingPendingMaterial.variants.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-2">产品花色 ({viewingPendingMaterial.variants.length})</p>
                    <div className="flex flex-wrap gap-2">
                      {viewingPendingMaterial.variants.map(v => (
                        <div key={v.id} className="w-12 h-12 rounded-lg border overflow-hidden">
                          <img src={v.imageUrl} className="w-full h-full object-cover" title={v.name} />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {viewingPendingMaterial.projectPhotos && viewingPendingMaterial.projectPhotos.length > 0 && (
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-2">应用案例 ({viewingPendingMaterial.projectPhotos.length})</p>
                    <div className="grid grid-cols-3 gap-2">
                      {viewingPendingMaterial.projectPhotos.map((p, i) => (
                        <img key={i} src={p} className="w-full aspect-square object-cover rounded-lg border" />
                      ))}
                    </div>
                  </div>
                )}
                
                <div className="flex gap-4 pt-4">
                  <button 
                    onClick={() => {
                      onApprove(viewingPendingMaterial.id);
                      setViewingPendingMaterial(null);
                    }}
                    className="flex-1 py-4 bg-black text-white rounded-2xl font-bold shadow-xl shadow-black/20"
                  >
                    通过审核
                  </button>
                  <button 
                    onClick={() => {
                      setAuditAction({ id: viewingPendingMaterial.id, type: 'REJECT' });
                      setViewingPendingMaterial(null);
                    }}
                    className="flex-1 py-4 bg-red-500 text-white rounded-2xl font-bold shadow-xl shadow-red-500/20"
                  >
                    驳回申请
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;

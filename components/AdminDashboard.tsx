
import React, { useState } from 'react';
import { User, Material, Category, PendingMaterial, SampleRequest, MaterialStatus } from '../types';

interface AdminDashboardProps {
  user: User;
  library: Material[];
  setLibrary: React.Dispatch<React.SetStateAction<Material[]>>;
  pendingList: PendingMaterial[];
  onApprove: (id: string, comment?: string) => void;
  onReject: (id: string, comment?: string) => void;
  sampleRequests: SampleRequest[];
  onShipSample: (id: string) => void;
  verificationRequests: User[];
  onVerifySupplier: (userId: string) => void;
}

const AdminDashboard: React.FC<AdminDashboardProps> = ({ 
  user, library, setLibrary, pendingList, onApprove, onReject, sampleRequests, onShipSample,
  verificationRequests, onVerifySupplier
}) => {
  const [subTab, setSubTab] = useState<'DESIGNERS' | 'MATERIALS' | 'SUPPLIERS' | 'PENDING' | 'SAMPLES' | 'VERIFICATIONS'>('DESIGNERS');
  const [selectedCategory, setSelectedCategory] = useState<Category | 'ALL'>('ALL');
  const [editingMaterial, setEditingMaterial] = useState<Material | null>(null);
  const [viewingSupplierProducts, setViewingSupplierProducts] = useState<string | null>(null);
  const [viewingPendingMaterial, setViewingPendingMaterial] = useState<PendingMaterial | null>(null);
  const [viewingVerificationDoc, setViewingVerificationDoc] = useState<User | null>(null);
  const [auditAction, setAuditAction] = useState<{ id: string, type: 'APPROVE' | 'REJECT' } | null>(null);
  const [auditComment, setAuditComment] = useState('');

  const designers = [
    { id: 'd1', name: '陈设计师', points: 850, transactions: 12, income: 2500, status: 'Active' },
    { id: 'd2', name: '李木子', points: 420, transactions: 5, income: 1200, status: 'Active' }
  ];

  // Derive total income from library points needed or simulate based on actual interactions
  const totalClicks = library.reduce((acc, m) => acc + (m.clicks || 0), 0);
  const totalSaves = library.reduce((acc, m) => acc + (m.saves || 0), 0);
  const estimatedIncome = (totalClicks * 0.5 + totalSaves * 2).toFixed(2);

  const suppliers = Array.from(new Set(library.map(m => m.brand))).map((brand, idx) => {
    const products = library.filter(m => m.brand === brand);
    const clicks = products.reduce((acc, m) => acc + (m.clicks || 0), 0);
    const saves = products.reduce((acc, m) => acc + (m.saves || 0), 0);
    return {
      id: `s${idx + 1}`,
      name: brand,
      company: brand,
      points: clicks * 10,
      income: (clicks * 5 + saves * 20),
      risk: clicks > 100 && saves < 2 ? 'Suspicious' : 'Low'
    };
  });

  const filteredLibrary = library.filter(m => selectedCategory === 'ALL' || m.category === selectedCategory);

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
      </div>

      <div className="bg-white rounded-[40px] border border-gray-100 shadow-sm overflow-hidden">
        {subTab === 'DESIGNERS' && (
          <div>
             <table className="w-full text-left border-collapse">
               <thead>
                 <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                   <th className="p-6">注册名</th>
                   <th className="p-6">剩余积分</th>
                   <th className="p-6">交易总额</th>
                   <th className="p-6">最后活跃</th>
                   <th className="p-6 text-right">管理操作</th>
                 </tr>
               </thead>
               <tbody>
                 {designers.map(d => (
                   <tr key={d.id} className="border-b hover:bg-gray-50 transition-colors">
                     <td className="p-6">
                        <p className="font-bold">{d.name}</p>
                        <p className="text-[10px] text-gray-400">designer_{d.id}@mail.com</p>
                     </td>
                     <td className="p-6 font-black">{d.points}</td>
                     <td className="p-6 font-black">¥ {d.income}</td>
                     <td className="p-6 text-xs text-gray-400">2024-05-18 14:22</td>
                     <td className="p-6 text-right space-x-4">
                       <button className="text-xs font-bold text-blue-600 hover:underline">对话记录</button>
                       <button className="text-xs font-bold text-red-500 hover:underline">禁言评论</button>
                       <button className="text-xs font-bold bg-black text-white px-3 py-1 rounded-lg">修改积分</button>
                     </td>
                   </tr>
                 ))}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">设计师总数: {designers.length} 位</p>
               <button onClick={() => exportCSV(designers, 'designers_report.csv')} className="bg-white border px-6 py-2 rounded-xl text-xs font-bold shadow-sm">导出 Excel 数据表</button>
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
                     <td className="p-6 font-black text-green-500">{m.saves}</td>
                     <td className="p-6 font-black text-purple-500">{Math.floor((m.clicks || 0) * 0.15)}</td>
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
                     '报价估算': Math.floor((m.clicks || 0) * 0.15)
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
                 {suppliers.map(s => {
                   const productCount = library.filter(m => m.brand === s.company).length;
                   return (
                    <tr key={s.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-6 font-bold">{s.name}</td>
                      <td className="p-6">
                        <button 
                          onClick={() => setViewingSupplierProducts(s.company)}
                          className="font-black text-blue-600 hover:underline"
                        >
                          {productCount}
                        </button>
                      </td>
                      <td className="p-6 font-black">{s.points}</td>
                      <td className="p-6 font-black">¥ {s.income}</td>
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
                   );
                 })}
               </tbody>
             </table>
             <div className="p-8 bg-gray-50 border-t flex justify-between items-center">
               <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">入驻材料商: {suppliers.length} 家</p>
               <button onClick={() => exportCSV(suppliers, 'suppliers_report.csv')} className="bg-white border px-6 py-2 rounded-xl text-xs font-bold shadow-sm">导出 Excel 数据表</button>
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
                          {req.status === 'PENDING' ? '待处理' : req.status === 'SHIPPED_BY_SUPPLIER' ? '材料商已寄' : '平台已寄'}
                        </span>
                      </td>
                      <td className="p-6 text-right space-x-4">
                        {req.status === 'PENDING' && (
                          <button 
                            onClick={() => onShipSample(req.id)}
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
                         onClick={() => setViewingVerificationDoc(req)}
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
                          onClick={() => setViewingVerificationDoc(req)}
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
      </div>

      {/* Verification Doc Modal */}
      {viewingVerificationDoc && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[200] flex items-center justify-center p-6" onClick={() => setViewingVerificationDoc(null)}>
          <div className="max-w-4xl w-full" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4 text-white">
              <h3 className="text-xl font-bold">{viewingVerificationDoc.company} - 认证证件</h3>
              <button onClick={() => setViewingVerificationDoc(null)} className="text-3xl">✕</button>
            </div>
            <img src={viewingVerificationDoc.verificationDoc} className="w-full h-auto rounded-2xl shadow-2xl border border-white/10" alt="verification doc" />
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
              <h3 className="text-2xl font-black">{viewingSupplierProducts} - 上架单品</h3>
              <button onClick={() => setViewingSupplierProducts(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {library.filter(m => m.brand === viewingSupplierProducts).map(m => (
                <div key={m.id} className="bg-gray-50 rounded-3xl p-4 border border-gray-100">
                  <img src={m.image} className="w-full aspect-video object-cover rounded-2xl mb-4" />
                  <h4 className="font-bold mb-1">{m.name}</h4>
                  <div className="flex justify-between items-center">
                    <span className="text-xs text-gray-400">{m.category}</span>
                    <div className="flex items-center gap-3">
                      <span className={`text-[10px] font-bold ${m.clicks > 0 ? 'text-gray-900' : 'text-gray-400'}`}>👀 {m.clicks || 0}</span>
                      <span className="text-[10px] font-bold text-gray-400">🤍 {m.saves || 0}</span>
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

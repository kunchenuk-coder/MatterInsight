
import React, { useState } from 'react';
import { User, Material, Category, MoodBoard, Inquiry, SampleRequest } from '../types';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import { UserOptions } from 'jspdf-autotable';

// Add type declaration for jspdf-autotable
interface jsPDFWithPlugin extends jsPDF {
  autoTable: (options: UserOptions) => jsPDF;
}

interface DashboardProps {
  user: User;
  savedIds: string[];
  setSavedIds: React.Dispatch<React.SetStateAction<string[]>>;
  moodboards: MoodBoard[];
  setMoodboards: React.Dispatch<React.SetStateAction<MoodBoard[]>>;
  library: Material[];
  onRechargeClick: () => void;
  onOpenMoodboard: (id: string) => void;
  onViewMaterialDetail: (m: Material) => void;
  inquiries: Inquiry[];
  onInquiry: (matId: string, mbId: string, notes?: string) => void;
  onSampleRequest: (matId: string, address: string, contact: string, phone: string) => void;
  sampleRequests: SampleRequest[];
}

const DesignerDashboard: React.FC<DashboardProps> = ({ 
  user, savedIds, setSavedIds, moodboards, setMoodboards, library, 
  onRechargeClick, onOpenMoodboard, onViewMaterialDetail, inquiries, onInquiry, sampleRequests
}) => {
  const [activeTab, setActiveTab] = useState<'TABLES' | 'ASSETS' | 'RECORDS'>('TABLES');
  const [expandedCategory, setExpandedCategory] = useState<Category | null>(null);
  const [editingMbId, setEditingMbId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [expandedMbs, setExpandedMbs] = useState<string[]>([]);
  const [showQuotation, setShowQuotation] = useState<MoodBoard | null>(null);
  const [viewingQuote, setViewingQuote] = useState<Inquiry | null>(null);

  const savedMaterials = library.filter(m => savedIds.includes(m.id));
  const groupedAssets = Object.values(Category).map(cat => ({
    category: cat,
    items: savedMaterials.filter(m => m.category === cat)
  }));

  const handleRemoveAsset = (id: string) => {
    setSavedIds(prev => prev.filter(mid => mid !== id));
  };

  const handleStartEdit = (mb: MoodBoard) => {
    setEditingMbId(mb.id);
    setEditingName(mb.name);
  };

  const handleSaveName = () => {
    if (editingMbId) {
      setMoodboards(prev => prev.map(mb => mb.id === editingMbId ? { ...mb, name: editingName } : mb));
      setEditingMbId(null);
    }
  };

  const handleCreateBoard = () => {
    const newBoard: MoodBoard = {
      id: `mb_${Date.now()}`,
      name: `新建情绪板 ${moodboards.length + 1}`,
      items: [],
      isPaid: false,
      maxMaterials: 10
    };
    setMoodboards([...moodboards, newBoard]);
  };

  const handleOneClickInquiry = (mb: MoodBoard) => {
    if (mb.items.length === 0) return alert('情绪板内暂无材料');
    if (confirm(`确认向所有供应商发送针对 "${mb.name}" 的询价请求？`)) {
      mb.items.forEach(item => {
        const existing = inquiries.find(inq => inq.materialId === item.materialId && inq.moodBoardId === mb.id);
        if (!existing) {
          onInquiry(item.materialId, mb.id, '来自一键询价');
        }
      });
    }
  };

  const handleExportPDF = () => {
    if (!showQuotation) return;
    
    try {
      const doc = new jsPDF() as jsPDFWithPlugin;
      
      // Title
      doc.setFontSize(20);
      doc.text(`${showQuotation.name} - 详细报价表`, 14, 22);
      
      // Subtitle
      doc.setFontSize(10);
      doc.setTextColor(100);
      doc.text(`物见 | MATTER INSIGHT - 生成日期: ${new Date().toLocaleDateString()}`, 14, 30);
      
      const tableRows = showQuotation.items.map(item => {
        const m = library.find(x => x.id === item.materialId);
        const inq = inquiries.find(i => i.materialId === item.materialId && i.moodBoardId === showQuotation.id);
        return [
          m?.name || '未知',
          m?.brand || '未知',
          m?.specifications || '-',
          m?.priceRange || '-',
          inq?.status === 'QUOTED' ? `¥ ${inq.quotePrice}` : '未报价',
          inq?.status === 'QUOTED' ? `¥ ${inq.totalPrice}` : '-',
          inq?.status === 'QUOTED' ? '已报价' : (inq ? '询价中' : '未询价')
        ];
      });

      doc.autoTable({
        startY: 40,
        head: [['材料名称', '品牌', '规格', '参考价', '供应商报价', '总价 (预估150㎡)', '状态']],
        body: tableRows,
        theme: 'striped',
        headStyles: { fillColor: [0, 0, 0], textColor: [255, 255, 255] },
        styles: { fontSize: 8, font: 'helvetica' }
      });

      doc.save(`物见报价单_${showQuotation.name}_${Date.now()}.pdf`);
      alert('PDF 报价单生成成功，已开始下载');
    } catch (error) {
      console.error('PDF export failed:', error);
      alert('导出 PDF 失败，请检查浏览器兼容性或尝试刷新。');
    }
  };

  return (
    <div className="max-w-6xl mx-auto py-10 space-y-12">
      <header className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6">
        <div className="px-6 md:px-0">
          <h1 className="text-3xl md:text-4xl font-black mb-2 tracking-tighter text-black uppercase">控制中心</h1>
          <p className="text-gray-400 font-bold text-xs md:text-sm">{user.name} · {user.company || '独立设计师'} <span className="ml-2 text-black bg-gray-100 px-2 py-0.5 rounded text-[10px]">PRO</span></p>
        </div>
      </header>

      <div className="flex gap-4 md:gap-8 border-b px-6 md:px-0 overflow-x-auto no-scrollbar">
        <button onClick={() => setActiveTab('TABLES')} className={`pb-4 text-[10px] md:text-sm font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'TABLES' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>材料表</button>
        <button onClick={() => setActiveTab('ASSETS')} className={`pb-4 text-[10px] md:text-sm font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'ASSETS' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>资产库</button>
        <button onClick={() => setActiveTab('RECORDS')} className={`pb-4 text-[10px] md:text-sm font-black uppercase tracking-widest transition-all whitespace-nowrap ${activeTab === 'RECORDS' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>申请记录</button>
      </div>

      <div className="px-6 md:px-0">
        {activeTab === 'TABLES' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 pb-20">
            {moodboards.map(mb => (
              <div key={mb.id} className="bg-white p-8 rounded-[40px] border border-gray-100 shadow-sm hover:shadow-xl transition-all group relative">
                <div className="flex justify-between items-start mb-6">
                  <div className="flex-1">
                    {editingMbId === mb.id ? (
                      <input 
                        autoFocus
                        value={editingName}
                        onChange={e => setEditingName(e.target.value)}
                        onBlur={handleSaveName}
                        onKeyDown={e => e.key === 'Enter' && handleSaveName()}
                        className="text-xl font-bold border-b-2 border-black outline-none w-full"
                      />
                    ) : (
                      <h3 
                        onClick={() => handleStartEdit(mb)}
                        className="text-xl font-bold cursor-pointer hover:text-blue-600 transition-colors"
                        title="点击重命名"
                      >
                        {mb.name}
                      </h3>
                    )}
                    <p className="text-xs text-gray-400 font-bold uppercase tracking-widest mt-1">项目材料清单</p>
                  </div>
                  {mb.isPaid && <span className="bg-yellow-400 text-black text-[9px] font-black px-2 py-0.5 rounded-full">PRO</span>}
                </div>
                <div className="space-y-4 mb-8">
                  {mb.items.filter(i => i.materialId).slice(0, expandedMbs.includes(mb.id) ? undefined : 3).map((item, idx) => {
                    const m = library.find(x => x.id === item.materialId);
                    return (
                      <div key={idx} className="flex items-center gap-4 group/item">
                         <div className="w-10 h-10 rounded-lg overflow-hidden bg-gray-50 border border-gray-100 shrink-0">
                            <img src={m?.image} className="w-full h-full object-cover" alt={m?.name} />
                         </div>
                         <div className="flex-1 min-w-0">
                            <p className="text-xs font-black text-gray-900 truncate">{m?.name}</p>
                            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-tight">{m?.brand}</p>
                         </div>
                         <div className="text-[10px] font-black text-gray-300 group-hover/item:text-black transition-colors">
                            ¥{m?.priceRange?.split('-')[0].replace('¥','')}
                         </div>
                      </div>
                    );
                  })}
                  {mb.items.filter(i => i.materialId).length > 3 && (
                    <button 
                      onClick={() => setExpandedMbs(prev => prev.includes(mb.id) ? prev.filter(id => id !== mb.id) : [...prev, mb.id])}
                      className="w-full py-2 bg-gray-50 hover:bg-gray-100 rounded-xl text-[10px] font-black text-gray-400 uppercase tracking-widest flex items-center justify-center gap-2 transition-all mt-4"
                    >
                      {expandedMbs.includes(mb.id) ? (
                        <>收起 <span className="rotate-180">↓</span></>
                      ) : (
                        <>查看全部 {mb.items.filter(i => i.materialId).length} 件材料 <span>↓</span></>
                      )}
                    </button>
                  )}
                  {mb.items.length === 0 && <p className="text-xs text-gray-300 italic py-4 text-center">该清单暂无材料</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => onOpenMoodboard(mb.id)}
                    className="bg-black text-white py-3 rounded-2xl font-bold text-[10px] uppercase tracking-wider hover:scale-105 transition-all"
                  >
                    编辑情绪板
                  </button>
                  <button 
                    onClick={() => setShowQuotation(mb)}
                    className="bg-gray-100 text-black py-3 rounded-2xl font-bold text-[10px] uppercase tracking-wider hover:bg-gray-200 transition-all"
                  >
                    查看报价表
                  </button>
                </div>
              </div>
            ))}

            <button 
              onClick={handleCreateBoard}
              className="bg-gray-50 p-6 rounded-[40px] border border-dashed border-gray-300 flex items-center justify-center gap-4 hover:bg-gray-100 transition-all group h-24 md:h-auto"
            >
              <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-lg shadow-sm group-hover:scale-110 transition-transform">➕</div>
              <p className="font-black text-gray-400 uppercase tracking-widest text-[10px]">新建情绪板</p>
            </button>
          </div>
        )}

        {/* Quotation Modal remains same but we need to ensure tab division is closed correctly */}
      </div>

      {/* Quotation Modal */}
      {showQuotation && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-5xl max-h-[90vh] overflow-y-auto p-10 rounded-[40px] shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <div>
                <h2 className="text-3xl font-black">{showQuotation.name} - 详细报价表</h2>
                <p className="text-gray-400 text-sm font-bold mt-1 uppercase tracking-widest">Generated at {new Date().toLocaleDateString()}</p>
              </div>
              <button onClick={() => setShowQuotation(null)} className="text-gray-400 hover:text-black text-2xl">✕</button>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b-2 border-black text-[10px] font-black uppercase tracking-widest">
                    <th className="py-4 px-2">材料名称</th>
                    <th className="py-4 px-2">品牌</th>
                    <th className="py-4 px-2">规格</th>
                    <th className="py-4 px-2">参考价</th>
                    <th className="py-4 px-2">供应商报价</th>
                    <th className="py-4 px-2">总价 (预估150㎡)</th>
                    <th className="py-4 px-2">状态</th>
                    <th className="py-4 px-2 text-right">操作</th>
                  </tr>
                </thead>
                <tbody>
                  {showQuotation.items
                    .filter(item => item.materialId) // Only show actual materials
                    .map((item, idx) => {
                      const m = library.find(x => x.id === item.materialId);
                      const inq = inquiries.find(i => i.materialId === item.materialId && i.moodBoardId === showQuotation.id);
                      return (
                        <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50 transition-colors">
                          <td className="py-4 px-2 font-bold text-black">{m?.name || '未命名材料'}</td>
                          <td className="py-4 px-2 text-sm text-gray-600">{m?.brand || '-'}</td>
                          <td className="py-4 px-2 text-xs text-gray-400">{m?.specifications || '-'}</td>
                          <td className="py-4 px-2 font-black text-gray-400">{m?.priceRange || '-'}</td>
                        <td className="py-4 px-2 font-black text-blue-600">
                          {inq?.status === 'QUOTED' ? `¥ ${inq.quotePrice}` : '-'}
                        </td>
                        <td className="py-4 px-2 font-black text-black">
                          {inq?.status === 'QUOTED' ? `¥ ${inq.totalPrice}` : '-'}
                        </td>
                        <td className="py-4 px-2">
                          {inq ? (
                            <span className={`px-2 py-1 text-[9px] font-black rounded-full uppercase ${inq.status === 'QUOTED' ? 'bg-blue-100 text-blue-600' : 'bg-yellow-100 text-yellow-600'}`}>
                              {inq.status === 'QUOTED' ? '已报价' : '询价中'}
                            </span>
                          ) : (
                            <span className="px-2 py-1 bg-gray-100 text-gray-400 text-[9px] font-black rounded-full uppercase">未询价</span>
                          )}
                        </td>
                        <td className="py-4 px-2 text-right">
                          {inq?.status === 'QUOTED' ? (
                            <button 
                              onClick={() => setViewingQuote(inq)}
                              className="text-[10px] font-black text-green-600 hover:underline"
                            >
                              查看报价详情
                            </button>
                          ) : (
                            <button 
                              onClick={() => onInquiry(item.materialId, showQuotation.id)}
                              className="text-[10px] font-black text-blue-600 hover:underline"
                            >
                              {inq ? '催促报价' : '申请报价'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {showQuotation.items.length === 0 && (
                    <tr>
                      <td colSpan={8} className="py-20 text-center text-gray-300 italic">暂无材料数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            
            <div className="mt-10 flex justify-end gap-4">
              <button onClick={handleExportPDF} className="px-8 py-3 bg-gray-100 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all">导出 PDF</button>
              <button onClick={() => handleOneClickInquiry(showQuotation)} className="px-8 py-3 bg-black text-white rounded-xl font-bold text-sm hover:scale-105 transition-all">一键询价</button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'ASSETS' && (
        <div className="space-y-4">
          {groupedAssets.map(group => (
            <div key={group.category} className="bg-white rounded-[32px] border border-gray-100 overflow-hidden">
              <button 
                onClick={() => setExpandedCategory(expandedCategory === group.category ? null : group.category)}
                className="w-full flex items-center justify-between p-6 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-4">
                  <span className="text-xl">{group.items.length > 0 ? '📁' : '📁'}</span>
                  <span className="font-bold text-lg">{group.category} <span className="text-gray-300 ml-2 font-black">({group.items.length})</span></span>
                </div>
                <span className={`transition-transform ${expandedCategory === group.category ? 'rotate-180' : ''}`}>▼</span>
              </button>
              
              {expandedCategory === group.category && (
                <div className="p-6 pt-0 grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-4">
                  {group.items.map(item => (
                    <div key={item.id} className="relative group aspect-square rounded-2xl overflow-hidden border cursor-pointer" onClick={() => onViewMaterialDetail(item)}>
                      <img src={item.image} className="w-full h-full object-cover" />
                      <button 
                        onClick={(e) => { e.stopPropagation(); handleRemoveAsset(item.id); }}
                        className="absolute top-2 right-2 bg-red-500 text-white w-6 h-6 rounded-full flex items-center justify-center text-[10px] shadow-lg opacity-0 group-hover:opacity-100 transition-opacity"
                      >✕</button>
                    </div>
                  ))}
                  {group.items.length === 0 && <p className="col-span-full text-center py-10 text-gray-300 text-xs italic">该分类下暂无收藏材料</p>}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {activeTab === 'RECORDS' && (
        <div className="bg-white rounded-[40px] border border-gray-100 overflow-hidden shadow-sm">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-gray-50 border-b text-[10px] font-black uppercase text-gray-400 tracking-widest">
                <th className="p-6">申请类型</th>
                <th className="p-6">申请材料</th>
                <th className="p-6">相关信息</th>
                <th className="p-6">申请日期</th>
                <th className="p-6">状态</th>
              </tr>
            </thead>
            <tbody>
              {/* Combine Sample Requests and Inquiries */}
              {[
                ...sampleRequests.filter(r => r.designerId === user.id).map(r => ({ ...r, type: 'SAMPLE' as const })),
                ...inquiries.filter(i => i.designerId === user.id).map(i => ({ ...i, type: 'INQUIRY' as const }))
              ].sort((a, b) => new Date(b.submitDate).getTime() - new Date(a.submitDate).getTime()).map(record => {
                const m = library.find(x => x.id === record.materialId);
                if (record.type === 'SAMPLE') {
                  const req = record as SampleRequest;
                  return (
                    <tr key={req.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-6">
                        <span className="px-2 py-1 bg-purple-100 text-purple-600 text-[8px] font-black rounded-full uppercase">小样申请</span>
                      </td>
                      <td className="p-6 flex items-center gap-4">
                        <img src={m?.image} className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold text-sm">{m?.name}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-black">{m?.brand}</p>
                        </div>
                      </td>
                      <td className="p-6">
                        <p className="text-xs font-bold">{req.contactName}</p>
                        <p className="text-[10px] text-gray-400 truncate max-w-[200px]">{req.address}</p>
                      </td>
                      <td className="p-6 text-xs text-gray-400">{new Date(req.submitDate).toLocaleDateString()}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${req.status === 'PENDING' ? 'bg-yellow-100 text-yellow-600' : 'bg-green-100 text-green-600'}`}>
                          {req.status === 'PENDING' ? '待寄送' : '已寄送'}
                        </span>
                      </td>
                    </tr>
                  );
                } else {
                  const inq = record as Inquiry;
                  return (
                    <tr key={inq.id} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="p-6">
                        <span className="px-2 py-1 bg-blue-100 text-blue-600 text-[8px] font-black rounded-full uppercase">询价申请</span>
                      </td>
                      <td className="p-6 flex items-center gap-4">
                        <img src={m?.image} className="w-10 h-10 rounded-lg object-cover" />
                        <div>
                          <p className="font-bold text-sm">{m?.name}</p>
                          <p className="text-[10px] text-gray-400 uppercase font-black">{m?.brand}</p>
                        </div>
                      </td>
                      <td className="p-6">
                        <p className="text-xs font-bold">关联情绪板</p>
                        <p className="text-[10px] text-gray-400 truncate max-w-[200px]">{moodboards.find(b => b.id === inq.moodBoardId)?.name || '未知'}</p>
                      </td>
                      <td className="p-6 text-xs text-gray-400">{new Date(inq.submitDate).toLocaleDateString()}</td>
                      <td className="p-6">
                        <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest ${inq.status === 'PENDING' ? 'bg-yellow-100 text-yellow-600' : 'bg-blue-100 text-blue-600'}`}>
                          {inq.status === 'PENDING' ? '询价中' : '已报价'}
                        </span>
                      </td>
                    </tr>
                  );
                }
              })}
              {sampleRequests.filter(r => r.designerId === user.id).length === 0 && inquiries.filter(i => i.designerId === user.id).length === 0 && (
                <tr>
                  <td colSpan={5} className="p-20 text-center text-gray-300 italic">暂无申请记录</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Quote Detail Modal */}
      {viewingQuote && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md p-10 rounded-[40px] shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">报价详情</h3>
              <button onClick={() => setViewingQuote(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-black uppercase text-gray-400 mb-1">材料名称</p>
                <p className="font-bold">{library.find(m => m.id === viewingQuote.materialId)?.name}</p>
              </div>
              <div className="bg-blue-50 p-6 rounded-3xl border border-blue-100">
                <p className="text-[10px] font-black uppercase text-blue-600 mb-1">当前报价</p>
                <p className="text-3xl font-black text-blue-700">¥ {viewingQuote.quotePrice} <span className="text-sm font-normal">/ ㎡</span></p>
              </div>
              <div>
                <p className="text-[10px] font-black uppercase text-gray-400 mb-2">供应商说明</p>
                <p className="text-sm text-gray-600 leading-relaxed italic">
                  {viewingQuote.notes || '暂无说明'}
                </p>
              </div>
              {viewingQuote.history && viewingQuote.history.length > 1 && (
                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-2">价格变动记录</p>
                  <div className="space-y-2">
                    {viewingQuote.history.map((h, i) => (
                      <div key={i} className="flex justify-between text-[10px] border-b pb-1">
                        <span className="text-gray-400">{new Date(h.date).toLocaleDateString()}</span>
                        <span className="font-bold">¥ {h.price}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <button onClick={() => setViewingQuote(null)} className="w-full py-4 bg-black text-white rounded-2xl font-bold">关闭</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DesignerDashboard;

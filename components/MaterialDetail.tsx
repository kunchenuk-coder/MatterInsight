
import React, { useState } from 'react';
import { Material, User, Inquiry, SampleRequest } from '../types';
import { isSupplierUser } from '../services/inquiryService';

interface MaterialDetailProps {
  material: Material;
  user: User | null;
  isPublicView?: boolean;
  backLabel?: string;
  onBack: () => void;
  onDeductPoints: (amt: number) => void;
  onSampleRequest: (materialId: string, address: string, contactName: string, phone: string) => void;
  onInquiry: (materialId: string, moodBoardId: string, notes?: string) => void;
  inquiries: Inquiry[];
  sampleRequests: SampleRequest[];
}

const MaterialDetail: React.FC<MaterialDetailProps> = ({ 
  material, user, onBack, onDeductPoints, onSampleRequest, onInquiry,
  inquiries, sampleRequests, isPublicView = false, backLabel
}) => {
  const [selectedVariant, setSelectedVariant] = useState((material.variants && material.variants[0]) || { id: 'default', colorCode: '#FFFFFF', imageUrl: material.image, name: '默认' });
  const [isQuoting, setIsQuoting] = useState(false);
  const [isRequestingSample, setIsRequestingSample] = useState(false);
  const [sampleForm, setSampleForm] = useState({ address: '', contactName: user?.name || '', phone: '' });
  const [quoteForm, setQuoteForm] = useState({ project: '', address: '', area: '', date: '', notes: '' });
  const [zoomedImage, setZoomedImage] = useState<string | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);

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

  // Check if rating is allowed
  const canRate = user && user.role === 'DESIGNER' && (
    sampleRequests.some(req => req.materialId === material.id && req.designerId === user.id && req.status === 'COMPLETED') ||
    inquiries.some(inq => inq.materialId === material.id && inq.designerId === user.id && inq.status === 'COMPLETED')
  );

  const handleShare = () => {
    const shareUrl = `${window.location.origin}${window.location.pathname}#/share/${material.id}`;
    navigator.clipboard.writeText(shareUrl).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  };

  const supplierViewer = isSupplierUser(user);

  const handleSampleOrder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return alert('请先登录');
    if (supplierViewer) return;
    if (user.points < material.pointsNeeded.sample) {
      alert('积分不足，请先充值');
      return;
    }
    onDeductPoints(material.pointsNeeded.sample);
    onSampleRequest(material.id, sampleForm.address, sampleForm.contactName, sampleForm.phone);
    setIsRequestingSample(false);
    onBack(); // Return to material list as requested
  };

  const handleQuoteSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (supplierViewer) return;
    // For standalone material detail, we use a dummy moodboard ID or handle it specially
    onInquiry(material.id, 'STANDALONE', `项目: ${quoteForm.project} | 地址: ${quoteForm.address} | 面积: ${quoteForm.area} | 时间: ${quoteForm.date} | 备注: ${quoteForm.notes}`);
    setIsQuoting(false);
    onBack();
  };

  return (
    <div className="max-w-6xl mx-auto py-8">
      <div className="flex justify-between items-center mb-6">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 text-gray-500 hover:text-black transition-colors"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
          {backLabel ?? (isPublicView ? '探索公开库' : '返回列表')}
        </button>
        <div className="flex items-center gap-3">
          <button 
            onClick={handleShare}
            className={`flex items-center gap-2 px-6 py-1.5 rounded-full text-xs font-bold transition-all ${copySuccess ? 'bg-green-500 text-white' : 'bg-blue-50 text-blue-600 hover:bg-blue-100'}`}
          >
            {copySuccess ? '✓ 已复制链接' : '📢 分享材料'}
          </button>
          {!isPublicView && (
            <div className="bg-gray-100 px-4 py-1.5 rounded-full hidden sm:block">
              <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Matter-ID: </span>
              <span className="text-xs font-black text-black">{matterId}</span>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 bg-white p-8 rounded-3xl shadow-sm border border-gray-100">
        {/* Left: Info */}
        <div className="lg:col-span-5 flex flex-col gap-8">
          <div className="relative group">
            <img 
              src={selectedVariant.imageUrl || material.image} 
              alt={material.name} 
              className="w-full aspect-[4/5] object-cover rounded-2xl shadow-lg border border-gray-200 transition-all duration-500" 
              style={{ filter: `drop-shadow(0 0 10px ${selectedVariant.colorCode}44)` }}
            />
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
          </div>

          <div className="space-y-6">
            <div>
              <h1 className="text-3xl font-bold mb-1">{material.name}</h1>
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
              <div className="flex gap-4">
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

        {/* Right: Projects & Ratings */}
        <div className="lg:col-span-7 flex flex-col gap-8">
          <div>
            <h2 className="text-xl font-bold mb-4">应用案例</h2>
            <div className="flex flex-col gap-6 overflow-y-auto max-h-[600px] pr-4 custom-scrollbar">
              {material.projectPhotos.map((p, idx) => (
                <div 
                  key={idx} 
                  className="relative rounded-2xl overflow-hidden group cursor-zoom-in"
                  onClick={() => setZoomedImage(p)}
                >
                  <img src={p} className="w-full h-auto object-cover" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-6">
                    <div className="text-white">
                      <p className="font-bold text-lg">某高端住宅项目</p>
                      <p className="text-sm opacity-80">2023 · 上海浦东 · 350㎡</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Zoomed Image Modal */}
          {zoomedImage && (
            <div 
              className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[200] flex items-center justify-center p-4 cursor-zoom-out"
              onClick={() => setZoomedImage(null)}
            >
              <button 
                onClick={() => setZoomedImage(null)}
                className="absolute top-10 right-10 text-white text-4xl hover:scale-110 transition-transform"
              >✕</button>
              <img 
                src={zoomedImage} 
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl" 
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}

          <div className="bg-gray-50 p-6 rounded-2xl border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-bold">材料综合评估</h2>
              {user.role === 'DESIGNER' && !canRate && (
                <span className="text-[10px] text-gray-400 font-bold bg-white px-3 py-1 rounded-full border">完成订单后可评分</span>
              )}
              {canRate && (
                <button className="text-xs font-bold bg-black text-white px-4 py-1.5 rounded-full hover:scale-105 transition-transform">
                  立即评分
                </button>
              )}
            </div>
            <div className="space-y-4">
              {Object.entries(material.ratings).map(([key, val]) => (
                <div key={key} className="flex items-center gap-4">
                  <span className="w-20 text-xs font-bold text-gray-500 uppercase">{key === 'aesthetic' ? '美观' : key === 'durable' ? '耐用' : key === 'service' ? '服务' : key === 'cleanliness' ? '易洁' : '推荐'}</span>
                  <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                    {/* Fix: Explicitly cast val to number to resolve arithmetic operation error */}
                    <div className="h-full bg-black rounded-full" style={{ width: `${((val as number) / 5) * 100}%` }}></div>
                  </div>
                  <span className="text-xs font-bold">{val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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

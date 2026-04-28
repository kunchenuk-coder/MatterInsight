
import React, { useState } from 'react';
import { User, Category, PendingMaterial, Material, Inquiry, SampleRequest, MaterialStatus, AuditLog, MaterialVariant } from '../types';
import { CATEGORIES } from '../constants';

const COMMON_COLORS = [
  { name: '白色', code: '#FFFFFF' },
  { name: '浅灰', code: '#F5F5F5' },
  { name: '深灰', code: '#4A4A4A' },
  { name: '黑色', code: '#000000' },
  { name: '米色', code: '#F5F5DC' },
  { name: '棕色', code: '#8B4513' },
  { name: '蓝色', code: '#0000FF' },
  { name: '绿色', code: '#008000' },
];

interface SupplierDashboardProps {
  user: User;
  library: Material[];
  setLibrary: React.Dispatch<React.SetStateAction<Material[]>>;
  pendingList: PendingMaterial[];
  setPendingMaterials: React.Dispatch<React.SetStateAction<PendingMaterial[]>>;
  onSubmitForReview: (material: PendingMaterial) => void;
  onRechargeClick: () => void;
  inquiries: Inquiry[];
  onQuote: (inquiryId: string, price: string, notes: string) => void;
  sampleRequests: SampleRequest[];
  onShipSample: (requestId: string) => void;
  onRequestVerification: (phone: string, doc: string) => void;
}

const compressImage = (file: File, maxWidth = 1200, quality = 0.7): Promise<string> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target?.result as string;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = (height * maxWidth) / width;
          width = maxWidth;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx?.drawImage(img, 0, 0, width, height);
        
        // Use jpeg for better compression
        const dataUrl = canvas.toDataURL('image/jpeg', quality);
        resolve(dataUrl);
      };
      img.onerror = (err) => reject(err);
    };
    reader.onerror = (err) => reject(err);
  });
};

const SupplierDashboard: React.FC<SupplierDashboardProps> = ({ 
  user, library, setLibrary, pendingList, setPendingMaterials, onSubmitForReview, onRechargeClick, inquiries, onQuote,
  sampleRequests, onShipSample, onRequestVerification
}) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [activeTab, setActiveTab] = useState<'ORDERS' | 'PRODUCTS' | 'SAMPLES'>('ORDERS');
  const [showOrderDetails, setShowOrderDetails] = useState<Inquiry | null>(null);

  // Clear notifications when viewing products
  React.useEffect(() => {
    if (activeTab === 'PRODUCTS') {
      setLibrary(prev => prev.map(m => m.supplierId === user.id ? { ...m, isAcknowledged: true } : m));
      setPendingMaterials(prev => prev.map(p => p.submitterId === user.id ? { ...p, isAcknowledged: true } : p));
    }
  }, [activeTab, user.id, setLibrary, setPendingMaterials]);
  const [showQuoteForm, setShowQuoteForm] = useState<Inquiry | null>(null);
  const [quotePrice, setQuotePrice] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');
  const [verificationForm, setVerificationForm] = useState({ phone: '', doc: '' });

  const handleVerificationSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationForm.phone || !verificationForm.doc) {
      alert('请填写手机号并上传证件');
      return;
    }
    onRequestVerification(verificationForm.phone, verificationForm.doc);
  };

  if (!user.isVerified) {
    const isWaiting = !!user.registeredPhone;

    return (
      <div className="max-w-2xl mx-auto py-20">
        <div className="bg-white p-12 rounded-[50px] shadow-2xl border border-gray-100 text-center">
          <div className="text-6xl mb-8">{isWaiting ? '⏳' : '🛡️'}</div>
          <h2 className="text-3xl font-black mb-4 tracking-tighter">
            {isWaiting ? '认证审核中' : '供应商入驻认证'}
          </h2>
          <p className="text-gray-500 mb-10 leading-relaxed">
            {isWaiting 
              ? '感谢您的申请！我们的工作人员正在核实您的资料，请耐心等待。认证通过后，您将收到系统通知并解锁完整功能。'
              : '为了维护物见平台的专业性与材料真实性，新入驻供应商需完成身份认证。认证通过后，您即可发布材料并接收设计师询价。'}
          </p>
          
          {!isWaiting ? (
            <form onSubmit={handleVerificationSubmit} className="space-y-6 text-left">
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">联系手机号</label>
                <input 
                  required
                  type="tel" 
                  value={verificationForm.phone}
                  onChange={e => setVerificationForm({...verificationForm, phone: e.target.value})}
                  placeholder="请输入您的联系电话"
                  className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">营业执照 / 身份证明</label>
                <div className="relative aspect-video bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden">
                  {verificationForm.doc ? (
                    <img src={verificationForm.doc} className="w-full h-full object-cover" alt="doc" />
                  ) : (
                    <>
                      <span className="text-3xl mb-2">📄</span>
                      <span className="text-xs text-gray-400 font-bold">点击上传证件照片</span>
                    </>
                  )}
                  <input 
                    type="file" 
                    accept="image/*" 
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        try {
                          const compressed = await compressImage(file, 800, 0.6); // Even more aggressive for docs
                          setVerificationForm({...verificationForm, doc: compressed});
                        } catch (err) {
                          console.error('Doc compression error:', err);
                          alert('证件处理失败，请重试');
                        }
                      }
                    }} 
                    className="absolute inset-0 opacity-0 cursor-pointer" 
                  />
                </div>
              </div>
              <button 
                type="submit"
                className="w-full bg-black text-white py-5 rounded-2xl font-bold shadow-xl shadow-black/20 hover:scale-[1.02] transition-all"
              >
                提交认证申请
              </button>
            </form>
          ) : (
            <div className="pt-4">
              <div className="inline-block px-8 py-4 bg-gray-50 rounded-2xl text-gray-400 font-bold text-sm">
                申请已于 {new Date().toLocaleDateString()} 提交
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  const [formData, setFormData] = useState({
    name: '',
    category: Category.ST,
    brand: user.company || '',
    specifications: '',
    priceRange: '',
    stock: true,
    leadTime: '',
    fireRating: 'Class A',
    supplierNotes: '',
    image: '',
    variants: [] as MaterialVariant[],
    projectPhotos: [] as string[]
  });

  const handleReapply = (material: PendingMaterial) => {
    setFormData({
      name: material.name,
      category: material.category,
      brand: material.brand,
      specifications: material.specifications,
      priceRange: material.priceRange,
      stock: material.stock,
      leadTime: material.leadTime,
      fireRating: material.fireRating,
      supplierNotes: material.supplierNotes || '',
      image: material.image,
      variants: material.variants || [],
      projectPhotos: material.projectPhotos || []
    });
    // Remove the old rejected entry
    setPendingMaterials(prev => prev.filter(p => p.id !== material.id));
    setIsPublishing(true);
  };
  const supplierProducts = library.filter(m => m.supplierId === user.id);
  const myPendingProducts = pendingList.filter(p => p.submitterId === user.id);
  const supplierInquiries = inquiries.filter(inq => inq.supplierId === 'supplier_1' || inq.supplierId === user.id); // Robust filtering
  const supplierSamples = sampleRequests.filter(req => req.supplierId === 'supplier_1' || req.supplierId === user.id);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>, field: 'image' | 'projectPhotos' | 'variants') => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setIsProcessing(true);
    setUploadProgress(0);

    const fileArray = Array.from(files) as File[];
    const totalFiles = fileArray.length;
    const results: string[] = [];

    for (let i = 0; i < totalFiles; i++) {
      const file = fileArray[i];
      try {
        const result = await compressImage(file);
        results.push(result);
      } catch (err) {
        console.error('File compression error:', err);
        alert(`文件 "${file.name}" 处理失败`);
      }
      setUploadProgress(Math.round(((i + 1) / totalFiles) * 100));
    }

    const generateId = () => {
      try {
        return crypto.randomUUID();
      } catch (e) {
        return Math.random().toString(36).substring(2, 15);
      }
    };

    if (field === 'image') {
      setFormData(prev => ({ ...prev, image: results[0] }));
    } else if (field === 'projectPhotos') {
      setFormData(prev => ({ ...prev, projectPhotos: [...prev.projectPhotos, ...results] }));
    } else if (field === 'variants') {
      const newVariants: MaterialVariant[] = results.map((img, idx) => ({
        id: generateId(),
        imageUrl: img,
        colorCode: COMMON_COLORS[idx % COMMON_COLORS.length].code,
        name: `花色 ${formData.variants.length + idx + 1}`
      }));
      setFormData(prev => ({ ...prev, variants: [...prev.variants, ...newVariants] }));
    }

    setIsProcessing(false);
    setUploadProgress(0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.variants.length === 0 && !formData.image) {
      alert('请至少上传一张主图或花色图片');
      return;
    }

    const submitLog: AuditLog = {
      date: new Date().toISOString(),
      action: 'SUBMIT',
      comment: '供应商提交申请',
      operatorId: user.id
    };

    const generateId = () => {
      try {
        return crypto.randomUUID();
      } catch (e) {
        return Math.random().toString(36).substring(2, 15);
      }
    };

    const newPending: PendingMaterial = {
      ...formData,
      id: generateId(),
      image: formData.image || (formData.variants && formData.variants.length > 0 ? formData.variants[0].imageUrl : ''),
      submitterId: user.id,
      supplierId: user.id,
      submitDate: new Date().toISOString(),
      status: MaterialStatus.PENDING,
      auditLog: [submitLog],
    };
    try {
      onSubmitForReview(newPending);
      setIsPublishing(false);
      alert('材料已提交审核，请耐心等待平台审核结果。');
      // Reset form
      setFormData({
        name: '',
        category: Category.ST,
        brand: user.company || '',
        specifications: '',
        priceRange: '',
        stock: true,
        leadTime: '',
        fireRating: 'Class A',
        supplierNotes: '',
        image: '',
        variants: [],
        projectPhotos: []
      });
    } catch (error) {
      console.error('Submission error:', error);
      alert('提交失败，可能是由于图片数据过大。请尝试减少图片数量或压缩图片后再试。');
    }
  };

  const handleDeleteProduct = (id: string) => {
    if (confirm('确定要下架并删除该产品吗？')) {
      setLibrary(prev => prev.filter(m => m.id !== id));
    }
  };

  const handleSendQuote = () => {
    if (!showQuoteForm) return;
    onQuote(showQuoteForm.id, quotePrice, quoteNotes);
    alert('报价已成功发送给设计师！');
    setShowQuoteForm(null);
    setQuotePrice('');
    setQuoteNotes('');
  };

  const handleModifyQuote = (inq: Inquiry) => {
    setQuotePrice(inq.quotePrice || '');
    setQuoteNotes(inq.notes || '');
    setShowQuoteForm(inq);
  };

  return (
    <div className="max-w-6xl mx-auto py-10 space-y-12">
      <header className="flex justify-between items-end">
        <div>
          <h1 className="text-4xl font-black mb-2 tracking-tighter text-black uppercase">{user.company} 控制台</h1>
          <p className="text-gray-500 font-medium">发布您的材料，实时获取设计师询价</p>
        </div>
        <div className="flex gap-4">
          <button 
            onClick={() => setIsPublishing(true)}
            className="bg-black text-white px-8 py-3 rounded-2xl font-bold shadow-xl shadow-black/20 hover:scale-105 transition-transform h-fit self-center"
          >
            + 发布新材料
          </button>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div 
          onClick={() => setActiveTab('PRODUCTS')}
          className={`p-6 rounded-3xl border text-center shadow-sm cursor-pointer transition-all ${activeTab === 'PRODUCTS' ? 'bg-black text-white border-black scale-105' : 'bg-white hover:bg-gray-50'}`}
        >
          <p className={`${activeTab === 'PRODUCTS' ? 'text-gray-400' : 'text-gray-400'} text-[10px] font-bold uppercase mb-1`}>上架单品</p>
          <p className="text-3xl font-black">{supplierProducts.length + myPendingProducts.length} / 50</p>
          <div className={`w-full ${activeTab === 'PRODUCTS' ? 'bg-gray-800' : 'bg-gray-100'} h-1.5 mt-4 rounded-full overflow-hidden`}>
            <div className={`${activeTab === 'PRODUCTS' ? 'bg-white' : 'bg-black'} h-full`} style={{ width: `${((supplierProducts.length + myPendingProducts.length) / 50) * 100}%` }}></div>
          </div>
        </div>
        <div className="bg-white p-6 rounded-3xl border text-center shadow-sm">
          <p className="text-gray-400 text-[10px] font-bold uppercase mb-1">本月浏览</p>
          <p className="text-3xl font-black">{supplierProducts.reduce((acc, curr) => acc + (curr.clicks || 0), 0)}</p>
        </div>
        <div 
          onClick={() => setActiveTab('SAMPLES')}
          className={`p-6 rounded-3xl border text-center shadow-sm cursor-pointer transition-all ${activeTab === 'SAMPLES' ? 'bg-black text-white border-black scale-105' : 'bg-white hover:bg-gray-50'}`}
        >
          <p className={`${activeTab === 'SAMPLES' ? 'text-gray-400' : 'text-gray-400'} text-[10px] font-bold uppercase mb-1`}>小样申请</p>
          <p className={`text-3xl font-black ${activeTab === 'SAMPLES' ? 'text-white' : 'text-orange-500'}`}>{supplierSamples.filter(s => s.status === 'PENDING').length}</p>
        </div>
        <div className="bg-white p-6 rounded-3xl border text-center shadow-sm">
          <p className="text-gray-400 text-[10px] font-bold uppercase mb-1">信誉分</p>
          <p className="text-3xl font-black text-green-500">4.9</p>
        </div>
      </div>

      <div className="flex gap-8 border-b">
        <button onClick={() => setActiveTab('ORDERS')} className={`pb-4 text-sm font-black uppercase tracking-widest transition-all ${activeTab === 'ORDERS' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>待处理询价单</button>
        <button onClick={() => setActiveTab('SAMPLES')} className={`pb-4 text-sm font-black uppercase tracking-widest transition-all ${activeTab === 'SAMPLES' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>小样申请单</button>
        <button onClick={() => setActiveTab('PRODUCTS')} className={`pb-4 text-sm font-black uppercase tracking-widest transition-all ${activeTab === 'PRODUCTS' ? 'border-b-4 border-black text-black' : 'text-gray-300'}`}>我的上架单品</button>
      </div>

      {activeTab === 'ORDERS' && (
        <section className="bg-white rounded-[40px] border border-gray-100 p-10 shadow-sm">
          <div className="space-y-6">
            {supplierInquiries.map((inq) => {
              const m = library.find(x => x.id === inq.materialId);
              return (
                <div key={inq.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-gray-50 rounded-[28px] border border-gray-100 group hover:border-black transition-all">
                  <div className="flex items-center gap-6 mb-4 md:mb-0">
                    <div className="w-16 h-16 bg-white rounded-2xl border flex items-center justify-center font-bold text-gray-300 overflow-hidden">
                       <img src={m?.image} alt="quote" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">询价材料: {m?.name}</span>
                        {inq.status === 'PENDING' && <span className="text-[10px] bg-red-500 text-white px-2 py-0.5 rounded-full font-bold">NEW</span>}
                      </div>
                      <p className="text-xs text-gray-400">项目ID: {inq.moodBoardId} · 申请日期: {new Date(inq.submitDate).toLocaleDateString()}</p>
                      <p className="text-xs text-gray-400 mt-1 font-bold">
                        {inq.status === 'PENDING' ? (
                          <span className="text-orange-500">等待初次报价</span>
                        ) : (
                          <span className="text-green-600">已报价 (¥{inq.quotePrice})</span>
                        )}
                      </p>
                    </div>
                  </div>
                    <div className="flex gap-3">
                      <button 
                        onClick={() => setShowOrderDetails(inq)}
                        className={`px-6 py-2 rounded-full text-xs font-bold shadow-lg transition-transform hover:scale-105 active:scale-95 ${inq.status === 'PENDING' ? 'bg-black text-white shadow-black/10' : 'bg-gray-100 text-gray-600'}`}
                      >
                        {inq.status === 'PENDING' ? '立即去报价' : '重新报价 / 查看'}
                      </button>
                    </div>
                </div>
              );
            })}
            {supplierInquiries.length === 0 && <p className="text-center py-20 text-gray-300 italic">暂无询价申请</p>}
          </div>
        </section>
      )}

      {activeTab === 'SAMPLES' && (
        <section className="bg-white rounded-[40px] border border-gray-100 p-10 shadow-sm">
          <div className="space-y-6">
            {supplierSamples.map((req) => {
              const m = library.find(x => x.id === req.materialId);
              return (
                <div key={req.id} className="flex flex-col md:flex-row md:items-center justify-between p-6 bg-gray-50 rounded-[28px] border border-gray-100 group hover:border-black transition-all">
                  <div className="flex items-center gap-6 mb-4 md:mb-0">
                    <div className="w-16 h-16 bg-white rounded-2xl border flex items-center justify-center overflow-hidden">
                       <img src={m?.image} alt="sample" className="w-full h-full object-cover" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm font-bold">申领材料: {m?.name}</span>
                        {req.status === 'PENDING' && <span className="text-[10px] bg-orange-500 text-white px-2 py-0.5 rounded-full font-bold">待寄送</span>}
                      </div>
                      <p className="text-xs text-gray-500 font-medium">收件人: {req.contactName} ({req.phone})</p>
                      <p className="text-xs text-gray-400 mt-1">地址: {req.address}</p>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    {req.status === 'PENDING' ? (
                      <button 
                        onClick={() => onShipSample(req.id)}
                        className="px-6 py-2 bg-black text-white rounded-full text-xs font-bold shadow-lg shadow-black/10"
                      >
                        确认已寄出
                      </button>
                    ) : (
                      <span className="px-6 py-2 bg-green-50 text-green-600 rounded-full text-xs font-bold">
                        {req.status === 'SHIPPED_BY_SUPPLIER' ? '已寄出' : '平台代寄'}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {supplierSamples.length === 0 && <p className="text-center py-20 text-gray-300 italic">暂无小样申请</p>}
          </div>
        </section>
      )}

      {activeTab === 'PRODUCTS' && (
        <section className="bg-white rounded-[40px] border border-gray-100 p-10 shadow-sm">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {/* Pending Products */}
            {myPendingProducts.map(product => (
              <div key={product.id} className={`bg-gray-50 rounded-3xl p-4 border group relative ${product.status === MaterialStatus.REJECTED ? 'border-red-200 opacity-90' : 'border-yellow-200 opacity-80'}`}>
                <div className={`absolute top-4 left-4 z-10 text-black text-[10px] font-black px-3 py-1 rounded-full shadow-lg ${product.status === MaterialStatus.REJECTED ? 'bg-red-400' : 'bg-yellow-400'}`}>
                  {product.status}
                </div>
                {product.isAcknowledged === false && (
                  <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white z-20"></div>
                )}
                <img src={product.image} className={`w-full aspect-video object-cover rounded-2xl mb-4 ${product.status === MaterialStatus.REJECTED ? '' : 'grayscale-[50%]'}`} />
                <h4 className="font-bold mb-1">{product.name}</h4>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">{product.category}</span>
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-gray-400 italic">
                      {product.status === MaterialStatus.REJECTED ? '审核未通过，请查看意见' : '等待管理员审核...'}
                    </span>
                  </div>
                </div>
                {product.status === MaterialStatus.REJECTED && (
                  <div className="mt-3 space-y-3">
                    {product.auditLog.length > 0 && (
                      <div className="p-3 bg-red-50 rounded-xl border border-red-100">
                        <p className="text-[9px] font-black text-red-600 uppercase mb-1">审核意见</p>
                        <p className="text-[10px] text-red-700 italic">"{product.auditLog[product.auditLog.length - 1].comment}"</p>
                      </div>
                    )}
                    <button 
                      onClick={() => handleReapply(product)}
                      className="w-full py-2 bg-black text-white rounded-xl text-[10px] font-bold hover:scale-[1.02] transition-transform"
                    >
                      再次申请 (修改信息)
                    </button>
                  </div>
                )}
              </div>
            ))}

            {/* Approved Products */}
            {supplierProducts.map(product => (
              <div key={product.id} className="bg-gray-50 rounded-3xl p-4 border border-gray-100 group relative">
                {product.isAcknowledged === false && (
                  <div className="absolute top-4 right-4 w-3 h-3 bg-red-500 rounded-full border-2 border-white z-20"></div>
                )}
                <img src={product.image} className="w-full aspect-video object-cover rounded-2xl mb-4" />
                <h4 className="font-bold mb-1">{product.name}</h4>
                <div className="flex justify-between items-center">
                  <span className="text-xs text-gray-400">{product.category}</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-bold ${product.clicks > 0 ? 'text-gray-900' : 'text-gray-400'}`}>👀 {product.clicks || 0}</span>
                    <span className="text-[10px] font-bold text-gray-400">🤍 {product.saves || 0}</span>
                  </div>
                </div>
                <button 
                  onClick={() => handleDeleteProduct(product.id)}
                  className="absolute top-6 right-6 bg-white/90 backdrop-blur p-2 rounded-full text-red-500 opacity-0 group-hover:opacity-100 transition-all shadow-lg"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Order Details Modal */}
      {showOrderDetails && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-2xl p-10 rounded-[40px] shadow-2xl overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">{showOrderDetails.status === 'QUOTED' ? '报价单详情' : '询价单详情'}</h3>
              <button onClick={() => setShowOrderDetails(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            
            <div className="space-y-8">
              {/* Part 1: Designer Requirements */}
              <div className="space-y-6">
                <div className="flex items-center gap-4 pb-4 border-b">
                   <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center text-xl">👤</div>
                   <div>
                     <p className="text-sm font-black">设计师需求详情</p>
                     <p className="text-[10px] text-gray-400 uppercase tracking-widest">Designer Requirements</p>
                   </div>
                </div>

                <div className="grid grid-cols-2 gap-8">
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">项目编号</p>
                    <p className="font-bold">{showOrderDetails.moodBoardId}</p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black uppercase text-gray-400 mb-1">申请日期</p>
                    <p className="font-bold">{new Date(showOrderDetails.submitDate).toLocaleString()}</p>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-1">询价材料</p>
                  <div className="flex items-center gap-4 mt-2">
                    <img src={library.find(m => m.id === showOrderDetails.materialId)?.image} className="w-16 h-16 rounded-xl object-cover border" />
                    <p className="font-bold text-lg">{library.find(m => m.id === showOrderDetails.materialId)?.name}</p>
                  </div>
                </div>
                <div className="bg-gray-50 p-6 rounded-3xl">
                  <p className="text-[10px] font-black uppercase text-gray-400 mb-2">设计师留言</p>
                  <p className="text-sm text-gray-600 leading-relaxed italic">
                    {showOrderDetails.designerNotes || '“您好，请提供该材料的最新报价及库存情况，谢谢。”'}
                  </p>
                </div>
              </div>

              {/* Part 2: Supplier Quote (if exists) */}
              {showOrderDetails.status === 'QUOTED' && (
                <div className="space-y-6 pt-8 border-t border-dashed">
                  <div className="flex items-center gap-4 pb-4">
                     <div className="w-12 h-12 bg-black rounded-full flex items-center justify-center text-xl text-white">📄</div>
                     <div>
                       <p className="text-sm font-black">您的报价信息</p>
                       <p className="text-[10px] text-gray-400 uppercase tracking-widest">Your Quotation</p>
                     </div>
                  </div>
                  <div className="bg-black text-white p-8 rounded-[32px] shadow-xl">
                    <div className="flex justify-between items-end mb-6">
                      <div>
                        <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest mb-1">报价格式 (¥/㎡)</p>
                        <p className="text-3xl font-black">¥ {showOrderDetails.quotePrice}</p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest mb-1">报价日期</p>
                        <p className="text-sm font-bold">{new Date().toLocaleDateString()}</p>
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] font-bold opacity-50 uppercase tracking-widest mb-2">备注说明</p>
                      <p className="text-sm leading-relaxed">{showOrderDetails.notes || '无备注'}</p>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex gap-4 pt-4">
                <button onClick={() => setShowOrderDetails(null)} className="flex-1 py-4 bg-gray-100 rounded-2xl font-bold hover:bg-gray-200 transition-colors">关闭</button>
                {showOrderDetails.status === 'PENDING' ? (
                  <button 
                    onClick={() => {
                      setShowOrderDetails(null);
                      setShowQuoteForm(showOrderDetails);
                    }}
                    className="flex-1 py-4 bg-black text-white rounded-2xl font-bold shadow-xl shadow-black/20 hover:scale-[1.02] transition-transform"
                  >
                    立即去报价
                  </button>
                ) : (
                  <button 
                    onClick={() => {
                      setShowOrderDetails(null);
                      handleModifyQuote(showOrderDetails);
                    }}
                    className="flex-1 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-xl shadow-blue-600/20 hover:scale-[1.02] transition-transform"
                  >
                    修改报价单
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quote Form Modal */}
      {showQuoteForm && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[150] flex items-center justify-center p-6">
          <div className="bg-white w-full max-w-md p-10 rounded-[40px] shadow-2xl">
            <div className="flex justify-between items-center mb-8">
              <h3 className="text-2xl font-black">立即报价</h3>
              <button onClick={() => setShowQuoteForm(null)} className="text-gray-400 hover:text-black text-xl">✕</button>
            </div>
            <div className="space-y-6">
              <div>
                <p className="text-[10px] font-black uppercase text-gray-400 mb-1">针对材料</p>
                <p className="font-bold">{library.find(m => m.id === showQuoteForm.materialId)?.name}</p>
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">您的报价 (¥/㎡)</label>
                <input 
                  type="text" 
                  value={quotePrice}
                  onChange={e => setQuotePrice(e.target.value)}
                  placeholder="请输入单价"
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black"
                />
              </div>
              <div>
                <label className="block text-[10px] font-black uppercase text-gray-400 mb-2">备注说明</label>
                <textarea 
                  value={quoteNotes}
                  onChange={e => setQuoteNotes(e.target.value)}
                  placeholder="例如: 含运费、现货供应、量大从优..."
                  className="w-full p-4 bg-gray-50 rounded-2xl border-none outline-none focus:ring-2 focus:ring-black h-32 resize-none"
                ></textarea>
              </div>
              <button 
                onClick={handleSendQuote}
                className="w-full py-4 bg-black text-white rounded-2xl font-bold shadow-xl shadow-black/20"
              >
                发送报价
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Publishing Modal */}
      {isPublishing && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-4xl max-h-[90vh] overflow-y-auto p-10 rounded-[40px] shadow-2xl custom-scrollbar">
            <div className="flex justify-between items-center mb-10">
              <h2 className="text-3xl font-bold">发布新材料</h2>
              <button onClick={() => setIsPublishing(false)} className="text-gray-400 hover:text-black text-2xl">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="grid grid-cols-1 md:grid-cols-2 gap-10">
              {/* Form Left: Basic Info */}
              <div className="space-y-6">
                {isProcessing && (
                  <div className="bg-black/5 p-4 rounded-2xl animate-pulse">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[10px] font-black uppercase">处理中... {uploadProgress}%</span>
                    </div>
                    <div className="w-full bg-gray-200 h-1 rounded-full overflow-hidden">
                      <div className="bg-black h-full transition-all duration-300" style={{ width: `${uploadProgress}%` }}></div>
                    </div>
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">材料名称</label>
                  <input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} type="text" className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all" placeholder="例如: 意式极简大理石" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">材料分类</label>
                    <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value as Category})} className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all">
                      {CATEGORIES.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">价格区间</label>
                    <input required value={formData.priceRange} onChange={e => setFormData({...formData, priceRange: e.target.value})} type="text" className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all" placeholder="¥500-800/㎡" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">规格尺寸</label>
                  <input required value={formData.specifications} onChange={e => setFormData({...formData, specifications: e.target.value})} type="text" className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all" placeholder="600x1200x12mm" />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">防火等级</label>
                    <select value={formData.fireRating} onChange={e => setFormData({...formData, fireRating: e.target.value})} className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all">
                      <option value="Class A">Class A (不燃)</option>
                      <option value="Class B1">Class B1 (难燃)</option>
                      <option value="Class B2">Class B2 (可燃)</option>
                      <option value="Class B3">Class B3 (易燃)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">生产周期</label>
                    <input required value={formData.leadTime} onChange={e => setFormData({...formData, leadTime: e.target.value})} type="text" className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all" placeholder="15天" />
                  </div>
                </div>
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">材料商备注 (显示在详情页)</label>
                  <textarea 
                    value={formData.supplierNotes} 
                    onChange={e => setFormData({...formData, supplierNotes: e.target.value})} 
                    className="w-full p-4 bg-gray-50 border-none rounded-2xl outline-none focus:ring-2 focus:ring-black transition-all h-24 resize-none" 
                    placeholder="例如: 该材料为天然石材，纹理具有唯一性..."
                  ></textarea>
                </div>
              </div>

              {/* Form Right: Images */}
              <div className="space-y-6">
                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">主图 (小样图)</label>
                  <div className="relative group aspect-video bg-gray-50 rounded-2xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors overflow-hidden">
                    {formData.image ? (
                      <img src={formData.image} className="w-full h-full object-cover" alt="preview" />
                    ) : (
                      <>
                        <span className="text-3xl mb-2">📸</span>
                        <span className="text-xs text-gray-400 font-bold">点击上传材料主图</span>
                      </>
                    )}
                    <input type="file" accept="image/*" onChange={e => handleFileChange(e, 'image')} className="absolute inset-0 opacity-0 cursor-pointer" disabled={isProcessing} />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">批量上传花色 (Product Series)</label>
                  <div className="grid grid-cols-3 gap-2 mb-4">
                    {formData.variants.map((variant, i) => (
                      <div key={variant.id} className="aspect-square rounded-xl bg-gray-100 overflow-hidden relative group">
                        <img src={variant.imageUrl} className="w-full h-full object-cover" alt="variant" />
                        <div className="absolute bottom-0 left-0 right-0 p-1 bg-black/50 backdrop-blur-sm flex gap-1">
                          {COMMON_COLORS.slice(0, 4).map(c => (
                            <button
                              key={c.code}
                              type="button"
                              onClick={() => {
                                const newVariants = [...formData.variants];
                                newVariants[i].colorCode = c.code;
                                newVariants[i].name = c.name;
                                setFormData({ ...formData, variants: newVariants });
                              }}
                              className={`w-3 h-3 rounded-full border border-white/50 ${variant.colorCode === c.code ? 'ring-1 ring-white' : ''}`}
                              style={{ backgroundColor: c.code }}
                            />
                          ))}
                        </div>
                        <button type="button" onClick={() => setFormData(p => ({...p, variants: p.variants.filter((_, idx) => idx !== i)}))} className="absolute top-1 right-1 bg-black/50 text-white w-5 h-5 rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                    ))}
                    <div className="relative aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100">
                      <span className="text-xl">+</span>
                      <input type="file" multiple accept="image/*" onChange={e => handleFileChange(e, 'variants')} className="absolute inset-0 opacity-0 cursor-pointer" disabled={isProcessing} />
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 font-medium">提示: 批量选择多张花色图片，系统将自动生成系列产品</p>
                </div>

                <div>
                  <label className="block text-[10px] font-black uppercase text-gray-400 tracking-widest mb-2">项目应用案例照片</label>
                  <div className="grid grid-cols-3 gap-2">
                    {formData.projectPhotos.map((url, i) => (
                      <div key={i} className="aspect-square rounded-xl bg-gray-100 overflow-hidden relative group">
                        <img src={url} className="w-full h-full object-cover" alt="project" />
                        <button type="button" onClick={() => setFormData(p => ({...p, projectPhotos: p.projectPhotos.filter((_, idx) => idx !== i)}))} className="absolute top-1 right-1 bg-black/50 text-white w-5 h-5 rounded-full text-[10px] opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                    ))}
                    {formData.projectPhotos.length < 6 && (
                      <div className="relative aspect-square rounded-xl border-2 border-dashed border-gray-200 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100">
                        <span className="text-xl">+</span>
                        <input type="file" multiple accept="image/*" onChange={e => handleFileChange(e, 'projectPhotos')} className="absolute inset-0 opacity-0 cursor-pointer" disabled={isProcessing} />
                      </div>
                    )}
                  </div>
                  <p className="text-[10px] text-gray-400 mt-2 font-medium">提示: 真实的高质量项目照片能获得更高的审核评分和推荐位</p>
                </div>

                <div className="pt-6">
                  <button type="submit" className="w-full bg-black text-white py-5 rounded-[20px] font-black text-lg shadow-2xl shadow-black/20 hover:scale-[1.02] active:scale-[0.98] transition-all">
                    提交并进入审核
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default SupplierDashboard;


import React, { useState, useEffect, useRef, Component } from 'react';
import { User, UserRole, Material, Category, MoodBoard, PointTransaction, PendingMaterial, Inquiry, SampleRequest, MaterialStatus, AuditLog, Notification } from './types';
import { MOCK_MATERIALS } from './constants';
import Navbar from './components/Navbar';
import Auth from './components/Auth';
import PinterestFeed from './components/PinterestFeed';
import CategoryBar from './components/CategoryBar';
import MaterialDetail from './components/MaterialDetail';
import MoodBoardDesigner from './components/MoodBoardDesigner';
import SupplierDashboard from './components/SupplierDashboard';
import DesignerDashboard from './components/DesignerDashboard';
import AdminDashboard from './components/AdminDashboard';
import RechargeModal from './components/RechargeModal';

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
            <h2 className="text-2xl font-black mb-4">抱歉，程序出现了错误</h2>
            <p className="text-gray-500 mb-8 text-sm leading-relaxed">
              可能是由于上传的图片过大导致本地存储空间溢出，或者是数据格式不兼容。
              您可以尝试刷新页面，或者清除浏览器缓存后重试。
            </p>
            <button 
              onClick={() => {
                localStorage.clear();
                window.location.reload();
              }}
              className="w-full bg-black text-white py-4 rounded-2xl font-bold shadow-xl hover:scale-[1.02] transition-all"
            >
              重置应用并刷新
            </button>
            <button 
              onClick={() => window.location.reload()}
              className="w-full mt-4 py-4 text-gray-400 font-bold hover:text-black transition-colors"
            >
              仅刷新页面
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
  const [user, setUser] = useState<User | null>(null);
  const [currentView, setCurrentView] = useState<'HOME' | 'DETAILS' | 'MOODBOARD' | 'DASHBOARD'>('HOME');
  const [selectedMaterial, setSelectedMaterial] = useState<Material | null>(null);
  const [selectedCategory, setSelectedCategory] = useState<Category | null>(null);
  const [sharedMaterialId, setSharedMaterialId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [points, setPoints] = useState(1000); 
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminPass, setAdminPass] = useState('');

  // Persistence Helpers
  const saveToLocal = (key: string, data: any) => {
    try {
      localStorage.setItem(`matter_insight_${key}`, JSON.stringify(data));
    } catch (e) {
      console.error(`Failed to save ${key} to local storage:`, e);
      if (e instanceof Error && e.name === 'QuotaExceededError') {
        // Try to clear some non-essential data if quota is hit
        try {
          // Clear notifications as they are less critical
          localStorage.removeItem('matter_insight_notifications');
          // Try saving again
          localStorage.setItem(`matter_insight_${key}`, JSON.stringify(data));
        } catch (retryError) {
          alert('本地存储空间已满，且无法通过清理临时数据释放空间。请尝试删除一些旧的情绪板或减少上传的图片数量。');
        }
      }
    }
  };

  const getFromLocal = (key: string) => {
    try {
      const saved = localStorage.getItem(`matter_insight_${key}`);
      return saved ? JSON.parse(saved) : null;
    } catch (e) {
      console.error(`Failed to load ${key} from local storage:`, e);
      return null;
    }
  };

  // States with Persistence
  const [library, setLibrary] = useState<Material[]>(() => {
    const saved = getFromLocal('library');
    if (!saved) return MOCK_MATERIALS;
    // Migration: Ensure all materials have variants array and stats
    return saved.map((m: any) => ({
      ...m,
      variants: m.variants || [],
      clicks: m.clicks || 0,
      saves: m.saves || 0
    }));
  });
  const [pendingMaterials, setPendingMaterials] = useState<PendingMaterial[]>(() => {
    const saved = getFromLocal('pending');
    if (!saved) return [];
    return saved.map((m: any) => ({
      ...m,
      variants: m.variants || [],
      clicks: m.clicks || 0,
      saves: m.saves || 0
    }));
  });
  const [inquiries, setInquiries] = useState<Inquiry[]>(() => getFromLocal('inquiries') || []);
  const [sampleRequests, setSampleRequests] = useState<SampleRequest[]>(() => getFromLocal('samples') || []);
  const [moodboards, setMoodboards] = useState<MoodBoard[]>(() => getFromLocal('moodboards') || [
    { id: 'mb_1', name: '默认情绪板', items: [], isPaid: false, maxMaterials: 10 }
  ]);
  const [notifications, setNotifications] = useState<Notification[]>(() => getFromLocal('notifications') || []);
  const [activeMoodboardId, setActiveMoodboardId] = useState<string>('mb_1');
  const [savedMaterialIds, setSavedMaterialIds] = useState<string[]>(() => getFromLocal('saved_ids') || []);
  const [verificationRequests, setVerificationRequests] = useState<User[]>(() => getFromLocal('verifications') || []);
  const [verifiedUserIds, setVerifiedUserIds] = useState<string[]>(() => getFromLocal('verified_ids') || []);
  const [isRechargeModalOpen, setIsRechargeModalOpen] = useState(false);
  const [showWelcomeBonus, setShowWelcomeBonus] = useState(false);
  const [showFeatureModal, setShowFeatureModal] = useState(false);
  const savedIdsRef = useRef<string[]>([]);
  const moodboardsRef = useRef<MoodBoard[]>([]);
  const libraryRef = useRef<Material[]>([]);

  savedIdsRef.current = savedMaterialIds;
  moodboardsRef.current = moodboards;
  libraryRef.current = library;

  useEffect(() => {
    setUser((u) => (u ? { ...u, collections: savedMaterialIds } : u));
  }, [savedMaterialIds]);

  useEffect(() => {
    // Check for shared material in hash
    const hash = window.location.hash;
    if (hash.startsWith('#/share/')) {
      const id = hash.replace('#/share/', '');
      setSharedMaterialId(id);
    }
  }, []);

  // Persistence Effect
  useEffect(() => {
    saveToLocal('library', library);
    saveToLocal('pending', pendingMaterials);
    saveToLocal('inquiries', inquiries);
    saveToLocal('samples', sampleRequests);
    saveToLocal('moodboards', moodboards);
    saveToLocal('notifications', notifications);
    saveToLocal('saved_ids', savedMaterialIds);
    saveToLocal('verifications', verificationRequests);
    saveToLocal('verified_ids', verifiedUserIds);
  }, [library, pendingMaterials, inquiries, sampleRequests, moodboards, notifications, savedMaterialIds, verificationRequests, verifiedUserIds]);

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

  const handleApproveMaterial = (id: string, comment: string = '审核通过') => {
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
      addNotification(pending.submitterId, '材料审核通过', `您的材料 "${pending.name}" 已审核通过并发布。`, 'AUDIT');
      alert(`材料 "${newMat.name}" 已通过审核并上架！`);
    }
  };

  const handleRejectMaterial = (id: string, comment: string = '不符合上架标准') => {
    const pending = pendingMaterials.find(p => p.id === id);
    if (pending) {
      const auditEntry: AuditLog = {
        date: new Date().toISOString(),
        action: 'REJECT',
        comment,
        operatorId: user?.id || 'admin'
      };
      // We keep it in pending but mark as rejected, or just remove and notify
      // User requested "move to rejected status" - let's keep it in pending list for supplier to see
      setPendingMaterials(prev => prev.map(p => 
        p.id === id ? { ...p, status: MaterialStatus.REJECTED, auditLog: [...p.auditLog, auditEntry], isAcknowledged: false } : p
      ));
      addNotification(pending.submitterId, '材料审核驳回', `您的材料 "${pending.name}" 审核未通过。原因：${comment}`, 'AUDIT');
      alert('申请已驳回');
    }
  };

  const handleAuthSuccess = (userData: User) => {
    // For demo purposes, if it's a supplier, we give them a fixed ID to match mock data
    const baseUser = userData.role === 'SUPPLIER' ? { ...userData, id: 'supplier_1' } : userData;
    
    // Check if user should be verified based on persisted list
    const isVerified = baseUser.role === 'ADMIN' || verifiedUserIds.includes(baseUser.id) || baseUser.isVerified;
    const persistedCollections: string[] = getFromLocal('saved_ids') || [];
    const finalUser = {
      ...baseUser,
      isVerified,
      transactions: baseUser.transactions || [],
      collections: persistedCollections,
    };

    setUser(finalUser);
    setSavedMaterialIds(persistedCollections);
    setPoints(userData.points);
    
    if ((userData as any).showWelcomeBonus) {
      setShowWelcomeBonus(true);
    }

    // Supplier should go to Explore (HOME) page upon login
    if (userData.role === 'SUPPLIER') {
      setCurrentView('HOME');
    }
  };

  const handleAdminAuth = () => {
    if (adminPass === 'admin123') {
      setUser({
        id: 'admin_1',
        name: '平台管理员',
        email: 'admin@materialmatters.com',
        role: 'ADMIN',
        points: 999999,
        isVerified: true
      });
      setShowAdminLogin(false);
      setAdminPass('');
      setCurrentView('DASHBOARD');
    } else {
      alert('密码错误');
    }
  };

  /** 仅写入「我的收藏」与 user.collections，不创建或修改情绪板 */
  const handleToggleCollect = (matId: string) => {
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
        remark: mat?.name || '',
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
    alert(`成功充值 ${amount} 积分！`);
  };

  const handleInquiry = (materialId: string, moodBoardId: string, notes?: string) => {
    const material = library.find(m => m.id === materialId);
    if (!material || !user) return;

    const newInquiry: Inquiry = {
      id: `inq_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
      materialId,
      designerId: user.id,
      supplierId: material.supplierId || 'supplier_1', 
      moodBoardId,
      status: 'PENDING',
      submitDate: new Date().toISOString(),
      designerNotes: notes
    };
    setInquiries(prev => [...prev, newInquiry]);
    alert('询价申请已发送！材料商将尽快为您报价。');
  };

  const handleQuote = (inquiryId: string, price: string, notes: string) => {
    setInquiries(prev => prev.map(inq => {
      if (inq.id === inquiryId) {
        const historyEntry = { price, date: new Date().toISOString(), notes };
        return { 
          ...inq, 
          status: 'QUOTED', 
          quotePrice: price, 
          notes, 
          totalPrice: (parseFloat(price) * 150).toString(), // Mocking 150sqm
          history: [...(inq.history || []), historyEntry]
        };
      }
      return inq;
    }));
  };

  const handleSampleRequest = (materialId: string, address: string, contactName: string, phone: string) => {
    const material = library.find(m => m.id === materialId);
    if (!user || !material) return;
    const newRequest: SampleRequest = {
      id: `samp_${Date.now()}`,
      materialId,
      designerId: user.id,
      supplierId: material.supplierId || 'supplier_1',
      address,
      contactName,
      phone,
      status: 'PENDING',
      submitDate: new Date().toISOString()
    };
    setSampleRequests(prev => [...prev, newRequest]);
    alert('小样申请已提交！');
  };

  const handleShipSample = (requestId: string, role: 'SUPPLIER' | 'ADMIN') => {
    setSampleRequests(prev => prev.map(req => 
      req.id === requestId 
        ? { ...req, status: role === 'SUPPLIER' ? 'SHIPPED_BY_SUPPLIER' : 'SHIPPED_BY_ADMIN', shipDate: new Date().toISOString() }
        : req
    ));
  };

  const handleVerifySupplier = (userId: string) => {
    setVerificationRequests(prev => prev.filter(u => u.id !== userId));
    setVerifiedUserIds(prev => [...prev, userId]);
    
    // Add notification for the user
    addNotification(userId, '认证通过', '恭喜！您的供应商认证申请已通过，现在可以发布材料并接收询价了。', 'AUDIT');
    
    // If the current user is the one being verified, update their state immediately
    if (user && user.id === userId) {
      setUser({ ...user, isVerified: true });
    }
    
    alert('供应商认证已通过！');
  };

  const handleRequestVerification = (phone: string, doc: string) => {
    if (!user) return;
    const updatedUser = { ...user, registeredPhone: phone, verificationDoc: doc };
    setVerificationRequests(prev => [...prev, updatedUser]);
    setUser(updatedUser);
    alert('感谢申请，请等待认证。');
  };

  if (sharedMaterialId) {
    const material = library.find(m => m.id === sharedMaterialId);
    if (material) {
      return (
        <div className="min-h-screen bg-white">
          <div className="p-6 border-b flex justify-between items-center bg-black text-white">
            <h1 className="text-xl font-black uppercase tracking-tighter">物见 | MATTER INSIGHT <span className="text-gray-400 font-light ml-2 text-sm italic">Sharing</span></h1>
            <button onClick={() => setSharedMaterialId(null)} className="text-sm font-bold opacity-70 hover:opacity-100">返回登录/注册</button>
          </div>
          <div className="p-4 md:p-10">
             <MaterialDetail 
              material={material} 
              user={user} // This might be null, MaterialDetail should handle it
              isPublicView={true}
              onBack={() => setSharedMaterialId(null)}
              onDeductPoints={() => alert('请先登录以使用积分')}
              onSampleRequest={() => alert('请先登录/注册以申请小样')}
              onInquiry={() => alert('请先登录/注册以申请报价')}
              inquiries={[]}
              sampleRequests={[]}
            />
          </div>
          <div className="p-10 bg-gray-50 text-center">
            <p className="text-gray-400 text-xs mb-4 uppercase tracking-widest font-black">发现更多顶级设计材料</p>
            <button 
              onClick={() => { setSharedMaterialId(null); setUser(null); }}
              className="bg-black text-white px-8 py-3 rounded-2xl font-bold uppercase tracking-widest text-xs hover:scale-105 transition-transform shadow-xl"
            >
              注册获取完整权限
            </button>
          </div>
        </div>
      );
    }
  }

  if (!user) {
    return <Auth onAuthSuccess={handleAuthSuccess} />;
  }

  const unreadQuotes = inquiries.filter(inq => inq.status === 'QUOTED' && inq.designerId === user.id).length;
  const unreadInquiries = inquiries.filter(inq => inq.status === 'PENDING' && inq.supplierId === user.id).length;
  const supplierNotifications = user.role === 'SUPPLIER' 
    ? library.filter(m => m.supplierId === user.id && m.isAcknowledged === false).length +
      pendingMaterials.filter(p => p.submitterId === user.id && p.status === MaterialStatus.REJECTED && p.isAcknowledged === false).length +
      unreadInquiries
    : 0;

  const totalNotifications = user.role === 'SUPPLIER' ? supplierNotifications : unreadQuotes;

  return (
    <ErrorBoundary>
      <div className="min-h-screen flex flex-col">
        <Navbar 
          user={user} 
          points={points} 
          onLogoClick={() => setCurrentView('HOME')} 
          onProfileClick={() => setCurrentView('DASHBOARD')}
          onMoodboardClick={() => setCurrentView('MOODBOARD')}
          onLogout={() => setUser(null)}
          onRechargeClick={() => setIsRechargeModalOpen(true)}
          notifications={totalNotifications}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
        
        <main className="flex-grow pt-20 px-4 md:px-8">
          {currentView === 'HOME' && (
            <div className="max-w-7xl mx-auto">
              <div className="mb-8 md:mb-10 mt-4 md:mt-6 bg-black text-white p-6 md:p-12 rounded-[30px] md:rounded-[40px] relative overflow-hidden group min-h-[14rem] md:h-64 flex items-center">
                <div className="absolute top-0 right-0 w-64 h-64 bg-white/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 group-hover:scale-110 transition-transform duration-700"></div>
                <div className="relative z-10 w-full">
                  <span className="text-[9px] md:text-[10px] font-black uppercase tracking-[0.2em] bg-white/20 px-3 py-1 rounded-full mb-4 md:mb-3 inline-block">Promoted / 推广</span>
                  <h2 className="text-3xl md:text-5xl font-black tracking-tighter uppercase mb-3 md:mb-2 leading-none">WHAT's NEW</h2>
                  <p className="text-gray-400 font-medium text-xs md:text-sm max-w-md leading-relaxed md:leading-tight opacity-70">
                    探索本季最受瞩目的创新材质。从可持续生物基材料到未来感金属涂层。
                  </p>
                  <button 
                    onClick={() => setShowFeatureModal(true)}
                    className="mt-6 md:mt-8 bg-white text-black px-6 py-3 rounded-xl text-xs md:text-sm font-bold hover:scale-105 transition-transform"
                  >
                    立即查看专题
                  </button>
                </div>
              </div>
              <CategoryBar 
                selected={selectedCategory} 
                onSelect={setSelectedCategory} 
              />
              <PinterestFeed 
                materials={library.filter(m => {
                  const matchesCategory = !selectedCategory || m.category === selectedCategory;
                  const matchesSearch = !searchTerm || 
                    m.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    m.brand.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    m.specifications.toLowerCase().includes(searchTerm.toLowerCase());
                  return matchesCategory && matchesSearch;
                })} 
                onSelect={(m) => { 
                  setSelectedMaterial(m); 
                  setCurrentView('DETAILS'); 
                  // Increment click count
                  setLibrary(prev => prev.map(mat => mat.id === m.id ? { ...mat, clicks: mat.clicks + 1 } : mat));
                }}
                onSave={handleSaveMaterial}
                savedIds={savedMaterialIds}
                moodboards={moodboards}
              />
            </div>
          )}

          {currentView === 'DETAILS' && selectedMaterial && (
            <MaterialDetail 
              material={selectedMaterial} 
              user={user}
              onBack={() => setCurrentView('HOME')}
              onDeductPoints={(amt) => handlePointChange(-amt, '申领材料小样')}
              onSampleRequest={handleSampleRequest}
              onInquiry={handleInquiry}
              inquiries={inquiries}
              sampleRequests={sampleRequests}
            />
          )}

          {currentView === 'MOODBOARD' && (
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
            />
          )}

          {currentView === 'DASHBOARD' && (
            user.role === 'ADMIN' ? (
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
            ) : (
              user.role === 'DESIGNER' 
                ? <DesignerDashboard 
                    user={user} 
                    savedIds={savedMaterialIds} 
                    setSavedIds={setSavedMaterialIds} 
                    moodboards={moodboards} 
                    setMoodboards={setMoodboards}
                    library={library} 
                    onRechargeClick={() => setIsRechargeModalOpen(true)}
                    onOpenMoodboard={(id) => { setActiveMoodboardId(id); setCurrentView('MOODBOARD'); }}
                    onViewMaterialDetail={(m) => { setSelectedMaterial(m); setCurrentView('DETAILS'); }}
                    inquiries={inquiries}
                    onInquiry={handleInquiry}
                    onSampleRequest={handleSampleRequest}
                    sampleRequests={sampleRequests}
                  />
                : <SupplierDashboard 
                    user={user} 
                    library={library}
                    setLibrary={setLibrary}
                    pendingList={pendingMaterials}
                    setPendingMaterials={setPendingMaterials}
                    onSubmitForReview={(mat) => setPendingMaterials(prev => [...prev, mat])} 
                    onRechargeClick={() => setIsRechargeModalOpen(true)}
                    inquiries={inquiries}
                    onQuote={handleQuote}
                    sampleRequests={sampleRequests}
                    onShipSample={(id) => handleShipSample(id, 'SUPPLIER')}
                    onRequestVerification={handleRequestVerification}
                  />
            )
          )}
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
              <h3 className="text-3xl font-black mb-4 tracking-tighter">感谢您的加入！</h3>
              <p className="text-gray-500 mb-8 leading-relaxed">
                恭喜您成为物见（Matter Insight）前 500 名注册设计师。
                我们已向您的账户存入 <span className="text-black font-black">1000 积分</span> 奖励，
                祝您在材质探索之旅中收获无限灵感。
              </p>
              <button 
                onClick={() => setShowWelcomeBonus(false)}
                className="w-full bg-black text-white py-5 rounded-2xl font-bold shadow-xl hover:scale-[1.02] transition-all"
              >
                开始探索
              </button>
            </div>
          </div>
        )}

        {showFeatureModal && (
          <div className="fixed inset-0 bg-black/90 backdrop-blur-xl z-[200] flex items-center justify-center p-6 overflow-y-auto">
            <div className="max-w-3xl w-full bg-white rounded-[40px] overflow-hidden relative my-10">
              <button 
                onClick={() => setShowFeatureModal(false)}
                className="absolute top-6 right-6 z-50 bg-black/50 text-white w-10 h-10 rounded-full flex items-center justify-center hover:bg-black transition-colors"
              >
                ✕
              </button>
              <div className="relative">
                <img 
                  src="https://picsum.photos/seed/material_feature/1200/2400" 
                  alt="Feature" 
                  className="w-full h-auto cursor-pointer"
                  onClick={() => {
                    const targetMat = library[0]; // Link to first material for demo
                    setSelectedMaterial(targetMat);
                    setCurrentView('DETAILS');
                    setShowFeatureModal(false);
                  }}
                />
                <div className="p-12 space-y-8">
                  <h2 className="text-4xl font-black tracking-tighter uppercase">2026 材质趋势：生物共生</h2>
                  <p className="text-gray-600 leading-relaxed text-lg">
                    在这一季的专题中，我们深入探讨了人类建筑与自然生态的边界。
                    从菌丝体砖块到透明木材，这些材料不仅是结构，更是生命。
                    点击上方图片，探索本专题推荐的核心单品。
                  </p>
                  <div className="grid grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="h-48 bg-gray-100 rounded-3xl overflow-hidden">
                        <img src="https://picsum.photos/seed/mat1/600/400" className="w-full h-full object-cover" />
                      </div>
                      <h4 className="font-bold">可持续循环</h4>
                      <p className="text-sm text-gray-400">所有材料均可实现 100% 生物降解。</p>
                    </div>
                    <div className="space-y-4">
                      <div className="h-48 bg-gray-100 rounded-3xl overflow-hidden">
                        <img src="https://picsum.photos/seed/mat2/600/400" className="w-full h-full object-cover" />
                      </div>
                      <h4 className="font-bold">未来感美学</h4>
                      <p className="text-sm text-gray-400">独特的纹理与光泽，定义下一代空间语言。</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {showAdminLogin && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-md z-[100] flex items-center justify-center p-6">
            <div className="bg-white p-10 rounded-[40px] w-full max-w-sm shadow-2xl">
              <h3 className="text-2xl font-black mb-6">运营控制中心</h3>
              <input 
                type="password" 
                autoComplete="off"
                placeholder="请输入管理员访问密码"
                className="w-full p-4 bg-gray-50 rounded-2xl mb-4 border-none outline-none focus:ring-2 focus:ring-black"
                value={adminPass}
                onChange={(e) => setAdminPass(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAdminAuth()}
              />
              <div className="flex gap-4">
                <button onClick={() => setShowAdminLogin(false)} className="flex-1 py-4 font-bold text-gray-400">取消</button>
                <button onClick={handleAdminAuth} className="flex-1 py-4 bg-black text-white rounded-2xl font-bold">进入后台</button>
              </div>
            </div>
          </div>
        )}

        <footer className="bg-white border-t py-6 text-center text-sm text-gray-500">
          &copy; 2026 物见 | Matter Insight. All Rights Reserved.
        </footer>
      </div>
    </ErrorBoundary>
  );
};

export default App;

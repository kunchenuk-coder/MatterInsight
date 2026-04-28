
import React from 'react';

interface RechargeModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (amount: number) => void;
}

const RechargeModal: React.FC<RechargeModalProps> = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  const rechargeOptions = [
    { points: 500, price: 50 },
    { points: 1000, price: 90 },
    { points: 2000, price: 160 },
    { points: 5000, price: 380 },
  ];

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[200] flex items-center justify-center p-6">
      <div className="bg-white p-10 rounded-[40px] w-full max-w-md shadow-2xl">
        <div className="flex justify-between items-center mb-8">
          <h3 className="text-2xl font-black">积分充值</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-black text-xl">✕</button>
        </div>
        
        <div className="grid grid-cols-2 gap-4 mb-8">
          {rechargeOptions.map((opt) => (
            <button 
              key={opt.points}
              onClick={() => {
                // In a real app, this would trigger payment
                // Here we just simulate success
                onConfirm(opt.points);
              }}
              className="p-6 bg-gray-50 rounded-3xl border-2 border-transparent hover:border-black hover:bg-white transition-all text-left group"
            >
              <p className="text-xs font-black text-gray-400 uppercase mb-1">获得</p>
              <p className="text-xl font-black mb-2">{opt.points} 点</p>
              <p className="text-sm font-bold text-gray-600">¥ {opt.price}</p>
            </button>
          ))}
        </div>

        <div className="bg-gray-50 p-6 rounded-3xl flex flex-col items-center justify-center">
          <p className="text-xs font-bold text-gray-400 uppercase mb-4">扫码支付 (模拟)</p>
          <div className="w-32 h-32 bg-white p-2 rounded-xl border-2 border-gray-100 mb-4">
            <img 
              src="https://api.qrserver.com/v1/create-qr-code/?size=150x150&data=MaterialMattersRecharge" 
              alt="QR Code" 
              className="w-full h-full"
            />
          </div>
          <p className="text-[10px] text-gray-400 text-center">支付成功后积分将自动实时到账</p>
        </div>
      </div>
    </div>
  );
};

export default RechargeModal;

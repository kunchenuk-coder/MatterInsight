import React from 'react';

interface AuthShellProps {
  children: React.ReactNode;
  subtitle?: string;
}

const AuthShell: React.FC<AuthShellProps> = ({ children, subtitle }) => (
  <div className="min-h-screen bg-[#111] flex items-center justify-center p-6 overflow-hidden relative">
    <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
    <div className="absolute bottom-0 left-0 w-[500px] h-[500px] bg-white/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

    <div className="w-full max-w-md bg-[#393939] p-10 rounded-[40px] shadow-2xl relative z-10">
      <div className="text-center mb-8">
        <div className="text-2xl font-black bg-black text-white inline-block px-5 py-2 mb-4 tracking-tighter">
          物见 <span className="text-gray-400 font-light">|</span> MATTER INSIGHT
        </div>
        {subtitle && (
          <p className="text-[#e7e7e7] text-sm font-bold tracking-wide opacity-90">{subtitle}</p>
        )}
        {!subtitle && (
          <div className="space-y-1.5 md:space-y-1 px-4">
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">
              material matters / 以材质之名赋予生命
            </p>
            <p className="text-[#e7e7e7] text-[10px] md:text-sm font-bold uppercase tracking-wider opacity-90">
              material matters not / 以设计之名定义重生
            </p>
          </div>
        )}
      </div>
      {children}
    </div>
  </div>
);

export default AuthShell;

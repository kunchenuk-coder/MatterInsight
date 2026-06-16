
console.log('[MatterInsight index] VITE_SUPABASE_URL:', import.meta.env.VITE_SUPABASE_URL);
console.log(
  '[MatterInsight index] VITE_SUPABASE_ANON_KEY:',
  import.meta.env.VITE_SUPABASE_ANON_KEY ? '已加载' : '未加载'
);

import { ensureRecoveryRoute } from './utils/authRoutes';

// 最早拦截：邮件 recovery 链接落在首页时，立即归一化路由并锁定 recovery 模式
ensureRecoveryRoute();

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

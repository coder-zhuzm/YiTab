import React from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from '@/components/Toast';
import App from './App';

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <ToastProvider>
        <App />
      </ToastProvider>
    </React.StrictMode>,
  );
}

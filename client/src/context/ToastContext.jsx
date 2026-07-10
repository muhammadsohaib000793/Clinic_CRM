import { createContext, useContext, useState, useCallback } from 'react';

const ToastCtx = createContext(null);
let nextId = 1;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((toast) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, ...toast }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), toast.duration || 5000);
  }, []);

  const api = {
    info: (title, message) => push({ type: 'info', title, message }),
    success: (title, message) => push({ type: 'success', title, message }),
    warning: (title, message) => push({ type: 'warning', title, message }),
    error: (title, message) => push({ type: 'error', title, message }),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.type}`}>
            {t.title && <div className="t-title">{t.title}</div>}
            {t.message && <div>{t.message}</div>}
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export const useToast = () => useContext(ToastCtx);

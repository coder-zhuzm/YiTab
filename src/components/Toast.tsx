import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

/** 016 Toast：状态型 / 操作型（撤销）/ 进度型，顶部居中、40px 高、16px 圆角。 */

export type ToastTone = 'neutral' | 'success' | 'warning' | 'error';

interface ToastBase {
  id: number;
  message: string;
  tone: ToastTone;
  /** 自动消失时间；0 表示常驻（进度型）。 */
  duration: number;
  leaving: boolean;
}

interface StatusToastItem extends ToastBase {
  kind: 'status';
}

interface ActionToastItem extends ToastBase {
  kind: 'action';
  actionLabel: string;
  onAction: () => void | Promise<void>;
}

interface ProgressToastItem extends ToastBase {
  kind: 'progress';
  progress: number;
}

type ToastItem = StatusToastItem | ActionToastItem | ProgressToastItem;

export interface StatusToastOptions {
  tone?: ToastTone;
  duration?: number;
}

export interface ActionToastOptions extends StatusToastOptions {
  actionLabel: string;
  onAction: () => void | Promise<void>;
}

export interface ToastApi {
  status(message: string, options?: StatusToastOptions): number;
  action(message: string, options: ActionToastOptions): number;
  progress(message: string, progress?: number): number;
  update(id: number, patch: { message?: string; progress?: number }): void;
  dismiss(id: number): void;
}

const ToastContext = createContext<ToastApi | null>(null);

const STATUS_DURATION_MS = 3200;
/** 撤销窗口：倒计时圆环与自动消失共用这个时长。 */
const UNDO_DURATION_MS = 6000;
/** 与 --dur-toast-out 保持一致（离场动画结束后再卸载）。 */
const TOAST_EXIT_MS = 220;
const MAX_VISIBLE_TOASTS = 3;

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function ToastView({ toast, onDismiss }: { toast: ToastItem; onDismiss: (id: number) => void }) {
  useEffect(() => {
    if (toast.leaving || toast.duration <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [toast.id, toast.duration, toast.leaving, onDismiss]);

  const handleAction = () => {
    if (toast.kind !== 'action') return;
    const action = toast.onAction;
    onDismiss(toast.id);
    void action();
  };

  return (
    <div
      className={`yt-toast${toast.leaving ? ' is-leaving' : ''}`}
      data-tone={toast.tone}
      data-kind={toast.kind}
      role="status"
      aria-live="polite"
    >
      <span className="yt-toast-dot" aria-hidden="true" />
      <span className="yt-toast-message">{toast.message}</span>

      {toast.kind === 'action' && toast.duration > 0 ? (
        <span
          className="yt-toast-ring"
          style={{ '--toast-duration': `${toast.duration}ms` } as React.CSSProperties}
          aria-hidden="true"
        >
          <svg viewBox="0 0 18 18">
            <circle className="track" cx="9" cy="9" r="7" />
            <circle className="meter" cx="9" cy="9" r="7" />
          </svg>
        </span>
      ) : null}

      {toast.kind === 'action' ? (
        <button type="button" className="yt-toast-action" onClick={handleAction}>
          {toast.actionLabel}
        </button>
      ) : null}

      {toast.kind === 'progress' ? (
        <span className="yt-toast-progress" aria-hidden="true">
          <span style={{ transform: `scaleX(${clampProgress(toast.progress)})` }} />
        </span>
      ) : null}
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextIdRef = useRef(0);
  const exitTimersRef = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  useEffect(() => {
    const timers = exitTimersRef.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) =>
      prev.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast)),
    );
    if (exitTimersRef.current.has(id)) return;
    const timer = setTimeout(() => {
      exitTimersRef.current.delete(id);
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_EXIT_MS);
    exitTimersRef.current.set(id, timer);
  }, []);

  const push = useCallback((toast: ToastItem) => {
    setToasts((prev) => [...prev.slice(-(MAX_VISIBLE_TOASTS - 1)), toast]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      status(message, options) {
        const id = ++nextIdRef.current;
        push({
          id,
          kind: 'status',
          message,
          tone: options?.tone ?? 'neutral',
          duration: options?.duration ?? STATUS_DURATION_MS,
          leaving: false,
        });
        return id;
      },
      action(message, options) {
        const id = ++nextIdRef.current;
        push({
          id,
          kind: 'action',
          message,
          tone: options.tone ?? 'neutral',
          duration: options.duration ?? UNDO_DURATION_MS,
          leaving: false,
          actionLabel: options.actionLabel,
          onAction: options.onAction,
        });
        return id;
      },
      progress(message, progress = 0) {
        const id = ++nextIdRef.current;
        push({
          id,
          kind: 'progress',
          message,
          tone: 'neutral',
          duration: 0,
          leaving: false,
          progress: clampProgress(progress),
        });
        return id;
      },
      update(id, patch) {
        setToasts((prev) =>
          prev.map((toast) => {
            if (toast.id !== id || toast.kind !== 'progress') return toast;
            return {
              ...toast,
              message: patch.message ?? toast.message,
              progress:
                typeof patch.progress === 'number'
                  ? clampProgress(patch.progress)
                  : toast.progress,
            };
          }),
        );
      },
      dismiss,
    }),
    [dismiss, push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="yt-toast-region" aria-live="polite" aria-atomic="false">
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast 必须在 ToastProvider 内使用');
  return api;
}
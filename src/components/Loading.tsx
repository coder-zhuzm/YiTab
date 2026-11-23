import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircleFilled, CloseCircleFilled, CloseOutlined, MinusCircleOutlined } from '@ant-design/icons';

/**
 * 017 加载状态：
 * - 300ms 内不显示加载器；
 * - 0.3-3s 原地小 spinner，延迟 300ms 出现、至少显示 500ms；
 * - 已知布局用贴合真实内容的骨架屏，1.2s shimmer；
 * - 超过 3s 在右上角显示 344px 进度卡片，可取消，完成后转为结果卡片。
 */

/** 延迟多久才允许出现加载器。 */
export const LOADER_DELAY_MS = 300;
/** 加载器出现后至少保留多久。 */
export const LOADER_MIN_VISIBLE_MS = 500;
/** 超过多久把进度提升为右上角卡片。 */
export const LONG_TASK_DELAY_MS = 3000;

/** 延迟显示 + 最短显示时长的加载器可见性。 */
export function useDelayedLoading(
  active: boolean,
  delay = LOADER_DELAY_MS,
  minVisible = LOADER_MIN_VISIBLE_MS,
): boolean {
  const [visible, setVisible] = useState(false);
  const shownAtRef = useRef(0);

  useEffect(() => {
    if (active) {
      if (visible) return;
      const timer = setTimeout(() => {
        shownAtRef.current = Date.now();
        setVisible(true);
      }, delay);
      return () => clearTimeout(timer);
    }

    if (!visible) return;
    const remaining = Math.max(0, minVisible - (Date.now() - shownAtRef.current));
    const timer = setTimeout(() => setVisible(false), remaining);
    return () => clearTimeout(timer);
  }, [active, delay, minVisible, visible]);

  return visible;
}

export function DelayedSpinner({
  active,
  label = '加载中',
  className,
}: {
  active: boolean;
  label?: string;
  className?: string;
}) {
  const visible = useDelayedLoading(active);
  if (!visible) return null;
  return (
    <span
      className={`yt-inline-spinner${className ? ` ${className}` : ''}`}
      role="status"
      aria-live="polite"
    >
      <span className="yt-spinner" aria-hidden="true" />
      <span>{label}</span>
    </span>
  );
}

/** 快捷方式网格骨架：形状与真实磁贴（42px 图标 + 两行标题）一致。 */
export function ShortcutGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="yt-tiles yt-tiles-skeleton" aria-hidden="true">
      {Array.from({ length: count }, (_, index) => (
        <div className="yt-tile yt-skeleton-tile" key={index}>
          <span className="yt-skel yt-skel-icon" />
          <span className="yt-skel yt-skel-label" />
        </div>
      ))}
    </div>
  );
}

/** 书签列表骨架：文件夹标题 + 双列书签行，贴合真实书签区布局。 */
export function BookmarkListSkeleton({ folders = 2, rowsPerFolder = 4 }: { folders?: number; rowsPerFolder?: number }) {
  return (
    <div className="yt-bm-skeleton" aria-hidden="true">
      {Array.from({ length: folders }, (_, folderIndex) => (
        <div className="yt-bm-skel-folder" key={folderIndex}>
          <div className="yt-bm-skel-head">
            <span className="yt-skel yt-skel-folder" />
            <span className="yt-skel yt-skel-count" />
          </div>
          <div className="yt-bm-skel-links">
            {Array.from({ length: rowsPerFolder }, (_, rowIndex) => (
              <div className="yt-bm-skel-row" key={rowIndex}>
                <span className="yt-skel yt-skel-favicon" />
                <span className="yt-skel yt-skel-title" />
                <span className="yt-skel yt-skel-domain" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ProgressTaskOptions {
  title: string;
  detail?: string;
  /** 已知总量时进度条为确定态，否则为不确定态。 */
  total?: number;
}

export interface ProgressTaskContext {
  readonly cancelled: boolean;
  update(done: number, total?: number, detail?: string): void;
}

export type ProgressTaskPhase = 'idle' | 'running' | 'success' | 'error' | 'cancelled';

export interface ProgressTaskState {
  phase: ProgressTaskPhase;
  /** 只有超过 3s 才为 true；取消时立即显示结果。 */
  visible: boolean;
  title: string;
  detail?: string;
  /** 0-1；null 表示不确定进度。 */
  progress: number | null;
}

export interface ProgressTaskController {
  state: ProgressTaskState;
  run<T>(
    options: ProgressTaskOptions,
    task: (context: ProgressTaskContext) => Promise<T>,
  ): Promise<T | undefined>;
  cancel(): void;
  close(): void;
}

const IDLE_STATE: ProgressTaskState = {
  phase: 'idle',
  visible: false,
  title: '',
  progress: null,
};

export function useProgressTask(): ProgressTaskController {
  const [state, setState] = useState<ProgressTaskState>(IDLE_STATE);
  const taskIdRef = useRef(0);
  const cancelRequestedRef = useRef(false);
  const cardVisibleRef = useRef(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearRevealTimer = useCallback(() => {
    if (revealTimerRef.current !== null) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      taskIdRef.current += 1;
      clearRevealTimer();
    },
    [clearRevealTimer],
  );

  const cancel = useCallback(() => {
    cancelRequestedRef.current = true;
    clearRevealTimer();
    cardVisibleRef.current = true;
    setState((prev) =>
      prev.phase === 'running'
        ? { ...prev, visible: true, phase: 'cancelled', detail: '已取消' }
        : prev,
    );
  }, [clearRevealTimer]);

  const close = useCallback(() => {
    taskIdRef.current += 1;
    cancelRequestedRef.current = true;
    cardVisibleRef.current = false;
    clearRevealTimer();
    setState(IDLE_STATE);
  }, [clearRevealTimer]);

  const run = useCallback(
    async <T,>(
      options: ProgressTaskOptions,
      task: (context: ProgressTaskContext) => Promise<T>,
    ): Promise<T | undefined> => {
      clearRevealTimer();
      const id = ++taskIdRef.current;
      cancelRequestedRef.current = false;
      cardVisibleRef.current = false;
      setState({
        phase: 'running',
        visible: false,
        title: options.title,
        detail: options.detail,
        progress: options.total ? 0 : null,
      });

      revealTimerRef.current = setTimeout(() => {
        revealTimerRef.current = null;
        if (taskIdRef.current !== id || cancelRequestedRef.current) return;
        cardVisibleRef.current = true;
        setState((prev) => (prev.phase === 'running' ? { ...prev, visible: true } : prev));
      }, LONG_TASK_DELAY_MS);

      const context: ProgressTaskContext = {
        get cancelled() {
          return cancelRequestedRef.current || taskIdRef.current !== id;
        },
        update(done, total, detail) {
          if (taskIdRef.current !== id) return;
          const progress = total && total > 0 ? Math.min(1, Math.max(0, done / total)) : null;
          setState((prev) =>
            prev.phase === 'running'
              ? { ...prev, progress, detail: detail ?? prev.detail }
              : prev,
          );
        },
      };

      try {
        const result = await task(context);
        if (taskIdRef.current !== id) return undefined;
        clearRevealTimer();

        if (cancelRequestedRef.current) {
          cardVisibleRef.current = true;
          setState((prev) => ({
            ...prev,
            visible: true,
            phase: 'cancelled',
            detail: '已取消',
          }));
          return undefined;
        }

        if (cardVisibleRef.current) {
          setState((prev) => ({
            ...prev,
            visible: true,
            phase: 'success',
            progress: prev.progress === null ? null : 1,
            detail: typeof result === 'string' && result ? result : '已完成',
          }));
        } else {
          setState(IDLE_STATE);
        }
        return result;
      } catch (error) {
        if (taskIdRef.current !== id) throw error;
        clearRevealTimer();
        if (cardVisibleRef.current) {
          setState((prev) => ({
            ...prev,
            visible: true,
            phase: 'error',
            detail: error instanceof Error ? error.message : '操作失败',
          }));
        } else {
          setState(IDLE_STATE);
        }
        throw error;
      }
    },
    [clearRevealTimer],
  );

  return useMemo(() => ({ state, run, cancel, close }), [state, run, cancel, close]);
}

/** 右上角进度 / 结果卡片：宽 344px，可取消，完成后原地变成结果卡片。 */
export function ProgressCard({ controller }: { controller: ProgressTaskController }) {
  const { state } = controller;
  if (!state.visible || state.phase === 'idle') return null;

  const running = state.phase === 'running';
  const percent = state.progress === null ? null : Math.round(state.progress * 100);
  const resultIcon =
    state.phase === 'success' ? (
      <CheckCircleFilled />
    ) : state.phase === 'error' ? (
      <CloseCircleFilled />
    ) : state.phase === 'cancelled' ? (
      <MinusCircleOutlined />
    ) : (
      <span className="yt-spinner" />
    );

  return (
    <div className={`yt-progress-card is-${state.phase}`} role="status" aria-live="polite">
      <div className="yt-progress-head">
        <span className="yt-progress-icon" aria-hidden="true">
          {resultIcon}
        </span>
        <div className="yt-progress-copy">
          <div className="yt-progress-title">{state.title}</div>
          {state.detail ? <div className="yt-progress-detail">{state.detail}</div> : null}
        </div>
        {running ? (
          <button type="button" className="yt-progress-cancel" onClick={controller.cancel}>
            取消
          </button>
        ) : (
          <button
            type="button"
            className="yt-progress-close"
            onClick={controller.close}
            aria-label="关闭"
          >
            <CloseOutlined />
          </button>
        )}
      </div>
      {running ? (
        <>
          <div
            className={`yt-progress-bar${state.progress === null ? ' is-indeterminate' : ''}`}
            aria-hidden="true"
          >
            <span
              style={
                state.progress === null ? undefined : { transform: `scaleX(${state.progress})` }
              }
            />
          </div>
          {percent !== null ? (
            <div className="yt-progress-pct" aria-hidden="true">
              {percent}%
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
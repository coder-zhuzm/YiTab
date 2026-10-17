/**
 * 跨标签导航并发协调器 (NavigationCoordinator)
 *
 * 解决 F01 缺陷：当两个相同 URL / matchKey 的标签几乎同时提交 (committed) 时，
 * 避免两端互相选定对方为目标并双向关闭自己，导致页面彻底丢失。
 *
 * 仲裁策略：
 * 1. 严格全序 (Strict Total Order)：针对同一 matchKey，强制以 min(tabId) 作为唯一保留者 (Keeper)。
 * 2. 保留者绝对不可关闭：min(tabId) 恒无法获得关闭权限。
 * 3. 挑战者关闭前置校验：仅当自身不是保留者，且目标存活且未处于关闭中时，才授予关闭权限。
 */

export interface NavigationSession {
  tabId: number;
  matchKey: string;
  url: string;
  startedAt: number;
  isClosing: boolean;
}

export class NavigationCoordinator {
  /** matchKey -> Set<tabId> */
  private activeKeys = new Map<string, Set<number>>();
  /** tabId -> NavigationSession */
  private sessions = new Map<number, NavigationSession>();

  /**
   * 注册导航会话
   */
  register(matchKey: string, tabId: number, url: string): void {
    // 若原先有该 tab 的旧会话，先清理
    this.unregister(tabId);

    const session: NavigationSession = {
      tabId,
      matchKey,
      url,
      startedAt: Date.now(),
      isClosing: false,
    };
    this.sessions.set(tabId, session);

    let keySet = this.activeKeys.get(matchKey);
    if (!keySet) {
      keySet = new Set<number>();
      this.activeKeys.set(matchKey, keySet);
    }
    keySet.add(tabId);
  }

  /**
   * 注销导航会话（导航完成、失败或标签关闭时触发）
   */
  unregister(tabId: number): void {
    const session = this.sessions.get(tabId);
    if (!session) return;

    this.sessions.delete(tabId);
    const keySet = this.activeKeys.get(session.matchKey);
    if (keySet) {
      keySet.delete(tabId);
      if (keySet.size === 0) {
        this.activeKeys.delete(session.matchKey);
      }
    }
  }

  /**
   * 获取指定 matchKey 的当前仲裁保留者 (Keeper)
   * 规则：优先取 tabId 最小的有效标签
   */
  getKeeperTabId(matchKey: string): number | null {
    const keySet = this.activeKeys.get(matchKey);
    if (!keySet || keySet.size === 0) return null;

    let minId: number | null = null;
    for (const id of keySet) {
      const sess = this.sessions.get(id);
      // 已在关闭中的不能作为保留者
      if (sess && sess.isClosing) continue;
      if (minId === null || id < minId) {
        minId = id;
      }
    }
    return minId;
  }

  /**
   * 裁定当前标签是否被允许执行关闭动作 (claimClosePermission)
   *
   * @param matchKey 匹配特征键
   * @param selfTabId 准备关闭的源标签 ID
   * @param targetTabId 准备切换并保留的目标标签 ID
   * @returns true: 允许关闭；false: 必须取消关闭（保留自身）
   */
  claimClosePermission(matchKey: string, selfTabId: number, targetTabId: number): boolean {
    const selfSession = this.sessions.get(selfTabId);
    if (!selfSession) {
      // 未注册的会话采取保守策略：不允许静默关闭
      return false;
    }

    // 1. 如果目标也在并发协调会话中（双方正在并发竞争）
    const targetSession = this.sessions.get(targetTabId);
    if (targetSession) {
      if (targetSession.isClosing) {
        // 目标正在关闭，自身不能再关，必须留下
        return false;
      }
      // 双方都在并发导航中，自身如果是指定保留者（min tabId），坚决不能关闭
      const keeperId = this.getKeeperTabId(matchKey);
      if (keeperId === selfTabId) {
        return false;
      }
    }

    // 2. 授予关闭权限，并立刻标记自身为关闭中，防止其他标签再将自身视为有效保留目标
    selfSession.isClosing = true;
    return true;
  }

  /**
   * 检查某个标签是否已被标记为正在关闭
   */
  isTabClosing(tabId: number): boolean {
    return this.sessions.get(tabId)?.isClosing ?? false;
  }
}

/** 单例导出，供后台 Service Worker 统一调度 */
export const navigationCoordinator = new NavigationCoordinator();

import test from 'node:test';
import assert from 'node:assert/strict';
import { NavigationCoordinator } from '../src/lib/coordinator.ts';

test('NavigationCoordinator: 并发双标签登记与保留者仲裁', () => {
  const coord = new NavigationCoordinator();
  const matchKey = 'smart:example.com/login';

  // Tab 101 与 Tab 102 同时到达
  coord.register(matchKey, 101, 'https://example.com/login');
  coord.register(matchKey, 102, 'https://example.com/login');

  // 保留者必须是 min(tabId) = 101
  assert.equal(coord.getKeeperTabId(matchKey), 101);

  // Tab 101 试图关闭自己以保留 102 -> 必须被拒绝！
  const can101Close = coord.claimClosePermission(matchKey, 101, 102);
  assert.equal(can101Close, false);
  assert.equal(coord.isTabClosing(101), false);

  // Tab 102 试图关闭自己以保留 101 -> 允许！
  const can102Close = coord.claimClosePermission(matchKey, 102, 101);
  assert.equal(can102Close, true);
  assert.equal(coord.isTabClosing(102), true);
});

test('NavigationCoordinator: 多标签并发竞争保证至少一份存活', () => {
  const coord = new NavigationCoordinator();
  const matchKey = 'smart:example.com/docs';

  // 103, 101, 102 三个标签并发到达
  coord.register(matchKey, 103, 'https://example.com/docs');
  coord.register(matchKey, 101, 'https://example.com/docs');
  coord.register(matchKey, 102, 'https://example.com/docs');

  // Keeper 必须是 101
  assert.equal(coord.getKeeperTabId(matchKey), 101);

  // 101 绝对不能关闭
  assert.equal(coord.claimClosePermission(matchKey, 101, 102), false);
  assert.equal(coord.claimClosePermission(matchKey, 101, 103), false);

  // 102 可以关闭（保留 101）
  assert.equal(coord.claimClosePermission(matchKey, 102, 101), true);

  // 103 试图把已在关闭中的 102 作为目标 -> 必须拒绝
  assert.equal(coord.claimClosePermission(matchKey, 103, 102), false);

  // 103 把存活的 101 作为目标 -> 允许
  assert.equal(coord.claimClosePermission(matchKey, 103, 101), true);
});

test('NavigationCoordinator: 保留者注销或离线后自动重选', () => {
  const coord = new NavigationCoordinator();
  const matchKey = 'smart:example.com/dashboard';

  coord.register(matchKey, 105, 'https://example.com/dashboard');
  coord.register(matchKey, 108, 'https://example.com/dashboard');

  assert.equal(coord.getKeeperTabId(matchKey), 105);

  // 105 发生错误或被关闭注销
  coord.unregister(105);

  // 此时新的 Keeper 应自动降临到 108
  assert.equal(coord.getKeeperTabId(matchKey), 108);

  // 108 与并发到达的 110 相比，108 作为 Keeper 依然不能关闭
  coord.register(matchKey, 110, 'https://example.com/dashboard');
  assert.equal(coord.claimClosePermission(matchKey, 108, 110), false);
  // 而 110 可以关闭以保留 108
  assert.equal(coord.claimClosePermission(matchKey, 110, 108), true);
});

test('NavigationCoordinator: 正常单标签导航切换到已存在的静默标签时允许正常关闭', () => {
  const coord = new NavigationCoordinator();
  const matchKey = 'smart:example.com/normal';

  // 只有新开的 Tab 200 处于导航注册中
  coord.register(matchKey, 200, 'https://example.com/normal');

  // 目标 Tab 10 是后台已存在的静止网页标签（不在并发会话中）
  // Tab 200 切换到 Tab 10 后必须允许关闭自身！
  const canClose = coord.claimClosePermission(matchKey, 200, 10);
  assert.equal(canClose, true);
  assert.equal(coord.isTabClosing(200), true);
});

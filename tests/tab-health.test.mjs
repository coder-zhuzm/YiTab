import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isEligibleForDiscard,
  analyzeTabHealth,
  ESTIMATED_MB_PER_TAB,
} from '../src/lib/tab-health.ts';

test('isEligibleForDiscard protects active, audible, pinned, and already discarded tabs', () => {
  // 1. Normal background tab -> eligible
  assert.equal(
    isEligibleForDiscard({
      id: 1,
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    }),
    true,
  );

  // 2. Active tab -> ineligible (user is looking at it)
  assert.equal(
    isEligibleForDiscard({
      id: 2,
      active: true,
      pinned: false,
      audible: false,
      discarded: false,
    }),
    false,
  );

  // 3. Audible tab (playing music/video) -> ineligible
  assert.equal(
    isEligibleForDiscard({
      id: 3,
      active: false,
      pinned: false,
      audible: true,
      discarded: false,
    }),
    false,
  );

  // 4. Pinned tab -> ineligible
  assert.equal(
    isEligibleForDiscard({
      id: 4,
      active: false,
      pinned: true,
      audible: false,
      discarded: false,
    }),
    false,
  );

  // 5. Already discarded -> ineligible (already freed)
  assert.equal(
    isEligibleForDiscard({
      id: 5,
      active: false,
      pinned: false,
      audible: false,
      discarded: true,
    }),
    false,
  );
});

test('analyzeTabHealth computes counts and estimated freed memory correctly', () => {
  const tabs = [
    {
      id: 101,
      windowId: 1,
      title: 'Active Work Tab',
      url: 'https://github.com/coder-zhuzm/YiTab',
      active: true,
      pinned: false,
      audible: false,
      discarded: false,
    },
    {
      id: 102,
      windowId: 1,
      title: 'YouTube Music',
      url: 'https://youtube.com',
      active: false,
      pinned: false,
      audible: true,
      discarded: false,
    },
    {
      id: 103,
      windowId: 1,
      title: 'Idle Documentation Tab 1',
      url: 'https://react.dev',
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    },
    {
      id: 104,
      windowId: 1,
      title: 'Idle Documentation Tab 2',
      url: 'https://vite.dev',
      active: false,
      pinned: false,
      audible: false,
      discarded: false,
    },
    {
      id: 105,
      windowId: 1,
      title: 'Already Discarded Tab',
      url: 'https://wxt.dev',
      active: false,
      pinned: false,
      audible: false,
      discarded: true,
    },
  ];

  const report = analyzeTabHealth(tabs);
  assert.equal(report.totalCount, 5);
  assert.equal(report.activeTabId, 101);
  assert.equal(report.audibleCount, 1);
  assert.equal(report.discardedCount, 1);
  assert.equal(report.eligibleDiscardCount, 2); // 103 and 104
  assert.equal(report.estimatedMemorySavedMb, 2 * ESTIMATED_MB_PER_TAB);
  assert.deepEqual(
    report.eligibleTabs.map((t) => t.id),
    [103, 104],
  );
});

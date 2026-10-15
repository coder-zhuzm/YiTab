import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isDeepRoute,
  sanitizeResumeUrl,
  cleanCapsuleTitle,
  computeRftScore,
  extractPrimaryUrl,
  aggregateHistoryRecommendations,
} from '../src/lib/recommendations.ts';

test('isDeepRoute accurately differentiates deep content routes from root dashboards', () => {
  // 浅层根路径不属于需恢复的深层工作页面
  assert.equal(isDeepRoute('https://github.com'), false);
  assert.equal(isDeepRoute('https://github.com/'), false);
  assert.equal(isDeepRoute('https://jira.corp.oa/dashboard'), false);
  assert.equal(isDeepRoute('https://oa.internal/home'), false);
  assert.equal(isDeepRoute('http://localhost:3000/index.html'), false);

  // 典型工单、代码仓、PR、文档等深层路由
  assert.equal(
    isDeepRoute('https://github.com/coder-zhuzm/YiTab/pull/82'),
    true,
  );
  assert.equal(
    isDeepRoute('https://jira.corp.internal/issues/PROJ-1024'),
    true,
  );
  assert.equal(
    isDeepRoute('https://gitlab.corp/devops/deploy/merge_requests/45'),
    true,
  );
  assert.equal(
    isDeepRoute('https://wiki.corp.internal/doc/payment-api-v2'),
    true,
  );

  // 带业务查询参数的页面
  assert.equal(isDeepRoute('https://portal.oa/task/view?id=9921'), true);
  assert.equal(isDeepRoute('http://192.168.1.100:8080/browse?ticket=8831'), true);
});

test('sanitizeResumeUrl strips tracking and sensitive credential parameters', () => {
  const dirty =
    'https://jira.corp/issues/1024?token=secret123&utm_source=slack&id=1024&auth=jwt.token&fbclid=x123#';
  const clean = sanitizeResumeUrl(dirty);

  const u = new URL(clean);
  assert.equal(u.searchParams.has('token'), false);
  assert.equal(u.searchParams.has('auth'), false);
  assert.equal(u.searchParams.has('utm_source'), false);
  assert.equal(u.searchParams.has('fbclid'), false);
  // 保留实际业务内容参数
  assert.equal(u.searchParams.get('id'), '1024');
  assert.equal(u.hash, '');
});

test('cleanCapsuleTitle extracts core ticket ID and concise task label', () => {
  // Jira 工单模式提取
  const title1 =
    'PROJ-1024: 结算超时优化与死链排查 - Jira - Powered by Atlassian';
  const clean1 = cleanCapsuleTitle(title1, 'https://jira.corp/issues/PROJ-1024');
  assert.match(clean1, /PROJ-1024/);
  assert.equal(clean1.includes('Atlassian'), false);
  assert.equal(clean1.includes('Jira'), false);

  // GitHub PR 编号提取
  const title2 = '#82 优化标签页去重算法与确认页 · coder-zhuzm/YiTab · GitHub';
  const clean2 = cleanCapsuleTitle(title2, 'https://github.com/coder-zhuzm/YiTab/pull/82');
  assert.match(clean2, /#82/);
  assert.equal(clean2.includes('GitHub'), false);

  // 纯长标题适度截断
  const longTitle = '非常长的前端微服务架构设计与落地实施方案全景指南规范';
  const cleanLong = cleanCapsuleTitle(longTitle, 'https://wiki.corp/design');
  assert.equal(cleanLong.length <= 15, true);
  assert.match(cleanLong, /…/);
});

test('computeRftScore applies time-decay and typing frequency bonuses', () => {
  const now = 1729000000000;
  const oneDayAgo = now - 24 * 60 * 60 * 1000;
  const fourteenDaysAgo = now - 14 * 24 * 60 * 60 * 1000;

  const scoreRecent = computeRftScore(
    { lastVisitTime: oneDayAgo, visitCount: 10, typedCount: 2 },
    now,
  );
  const scoreOld = computeRftScore(
    { lastVisitTime: fourteenDaysAgo, visitCount: 10, typedCount: 2 },
    now,
  );

  // 1天前访问得分明显高于14天前半衰期衰减后的得分
  assert.equal(scoreRecent > scoreOld * 3, true);

  // typedCount 地址栏主动输入享有更高权重
  const scoreTyped = computeRftScore(
    { lastVisitTime: oneDayAgo, visitCount: 5, typedCount: 5 },
    now,
  );
  const scoreUntyped = computeRftScore(
    { lastVisitTime: oneDayAgo, visitCount: 5, typedCount: 0 },
    now,
  );
  assert.equal(scoreTyped > scoreUntyped, true);
});

test('extractPrimaryUrl returns clean protocol and host root', () => {
  assert.deepEqual(
    extractPrimaryUrl('https://github.com/coder-zhuzm/YiTab/pull/82'),
    {
      domain: 'github.com',
      primaryUrl: 'https://github.com/',
    },
  );

  assert.deepEqual(
    extractPrimaryUrl('http://192.168.10.22:8080/portal/view?id=123'),
    {
      domain: '192.168.10.22',
      primaryUrl: 'http://192.168.10.22:8080/',
    },
  );
});

test('aggregateHistoryRecommendations groups by domain and generates capsule for deep routes', () => {
  const now = Date.now();
  const mockHistory = [
    {
      url: 'https://jira.corp.internal/issues/PROJ-1024?utm_source=mail',
      title: 'PROJ-1024 结算重构工单 - Jira',
      lastVisitTime: now - 3600 * 1000,
      visitCount: 12,
    },
    {
      url: 'https://jira.corp.internal/dashboard',
      title: 'Jira 看板首页',
      lastVisitTime: now - 7200 * 1000,
      visitCount: 8,
    },
    {
      url: 'https://github.com/coder-zhuzm/YiTab/pull/82',
      title: '#82 优化去重 · GitHub',
      lastVisitTime: now - 1800 * 1000,
      visitCount: 20,
    },
    {
      url: 'https://v2ex.com/t/10086',
      title: '程序员下班后在想什么 - V2EX',
      lastVisitTime: now - 86400 * 1000,
      visitCount: 5,
    },
  ];

  const recommendations = aggregateHistoryRecommendations(mockHistory, 5, now);
  assert.equal(recommendations.length, 3); // jira.corp.internal, github.com, v2ex.com

  const jiraRec = recommendations.find((r) => r.domain === 'jira.corp.internal');
  assert.ok(jiraRec);
  assert.equal(jiraRec.primaryUrl, 'https://jira.corp.internal/');
  assert.ok(jiraRec.capsule);
  assert.equal(
    jiraRec.capsule.url,
    'https://jira.corp.internal/issues/PROJ-1024',
  );
  assert.match(jiraRec.capsule.cleanTitle, /PROJ-1024/);

  const ghRec = recommendations.find((r) => r.domain === 'github.com');
  assert.ok(ghRec);
  assert.equal(ghRec.primaryUrl, 'https://github.com/');
  assert.ok(ghRec.capsule);
  assert.match(ghRec.capsule.cleanTitle, /#82/);
});

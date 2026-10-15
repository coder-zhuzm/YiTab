import test from 'node:test';
import assert from 'node:assert/strict';
import {
  groupBookmarksByFolders,
  filterBookmarkCards,
} from '../src/lib/bookmarks-matrix.ts';

test('groupBookmarksByFolders correctly clusters bookmarks by folder hierarchy and counts', () => {
  const mockBookmarks = [
    {
      id: 'b1',
      title: 'Kubernetes 官方文档',
      url: 'https://kubernetes.io/docs/',
      domain: 'kubernetes.io',
      folderPath: ['书签栏', '运维与容器'],
    },
    {
      id: 'b2',
      title: 'Docker 镜像速查表',
      url: 'https://docs.docker.com/',
      domain: 'docs.docker.com',
      folderPath: ['书签栏', '运维与容器'],
    },
    {
      id: 'b3',
      title: 'React 19 新特性一览',
      url: 'https://react.dev/blog/2024/04/25/react-19',
      domain: 'react.dev',
      folderPath: ['书签栏', '前端技术', 'React 生态'],
    },
    {
      id: 'b4',
      title: '无效死链',
      url: '',
      domain: '',
      folderPath: ['书签栏'],
      isInvalid: true,
    },
    {
      id: 'b5',
      title: '未分类直存项',
      url: 'https://v2ex.com',
      domain: 'v2ex.com',
      folderPath: [],
    },
  ];

  const cards = groupBookmarksByFolders(mockBookmarks, 5, 4);

  // 校验分类数量 (运维与容器、React 生态、未分类书签)
  assert.equal(cards.length, 3);

  // 数量多的排在前面
  const opsCard = cards.find((c) => c.name === '运维与容器');
  assert.ok(opsCard);
  assert.equal(opsCard.totalCount, 2);
  assert.equal(opsCard.items.length, 2);

  const reactCard = cards.find((c) => c.name === 'React 生态');
  assert.ok(reactCard);
  assert.equal(reactCard.totalCount, 1);

  const defaultCard = cards.find((c) => c.name === '未分类书签');
  assert.ok(defaultCard);
  assert.equal(defaultCard.totalCount, 1);
});

test('filterBookmarkCards accurately filters by item title, domain, or folder name', () => {
  const cards = [
    {
      id: 'fld_ops',
      name: '运维与容器',
      folderPath: ['书签栏', '运维与容器'],
      totalCount: 2,
      items: [
        {
          id: 'b1',
          title: 'Kubernetes 官方文档',
          url: 'https://kubernetes.io/docs/',
          domain: 'kubernetes.io',
          folderPath: ['运维与容器'],
        },
        {
          id: 'b2',
          title: 'Docker 镜像速查表',
          url: 'https://docs.docker.com/',
          domain: 'docs.docker.com',
          folderPath: ['运维与容器'],
        },
      ],
    },
    {
      id: 'fld_frontend',
      name: '前端参考',
      folderPath: ['书签栏', '前端参考'],
      totalCount: 1,
      items: [
        {
          id: 'b3',
          title: 'Ant Design 5 设计规范',
          url: 'https://ant.design',
          domain: 'ant.design',
          folderPath: ['前端参考'],
        },
      ],
    },
  ];

  // 搜 "docker"
  const res1 = filterBookmarkCards(cards, 'docker');
  assert.equal(res1.length, 1);
  assert.equal(res1[0].name, '运维与容器');
  assert.equal(res1[0].items.length, 1);
  assert.equal(res1[0].items[0].title, 'Docker 镜像速查表');

  // 搜 "前端" (按文件夹名字匹配)
  const res2 = filterBookmarkCards(cards, '前端');
  assert.equal(res2.length, 1);
  assert.equal(res2[0].name, '前端参考');

  // 空搜索返回全部
  assert.equal(filterBookmarkCards(cards, '').length, 2);
});

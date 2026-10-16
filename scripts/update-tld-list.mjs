/**
 * 从 IANA 官方快照重新生成 `src/lib/public-tlds.ts`。
 *
 * 用法：node scripts/update-tld-list.mjs
 *
 * 生成的数据用于**消除歧义**（判断某个后缀是不是真实存在的顶级域名），
 * 在本地判断，运行期不对用户输入发起任何联网探测。
 * 它**不是**拒绝所有未知后缀的白名单：不在表内的后缀仍走文件名启发式与结构判定。
 *
 * 数据来源：https://data.iana.org/TLD/tlds-alpha-by-domain.txt
 */
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const SOURCE_URL = 'https://data.iana.org/TLD/tlds-alpha-by-domain.txt';
const OUT_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../src/lib/public-tlds.ts');

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`fetch failed: ${res.status} ${res.statusText}`);
const text = await res.text();

const versionLine = text.split('\n')[0].trim();
const version = versionLine.match(/Version\s+(\d+)/)?.[1] ?? 'unknown';
const updated = versionLine.match(/Last Updated\s+(.+?)\s+UTC/)?.[1] ?? 'unknown';
const sha256 = createHash('sha256').update(text).digest('hex');

const tlds = text
  .split('\n')
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith('#'))
  .map((l) => l.toLowerCase())
  .sort();

if (tlds.length < 1000) throw new Error(`suspiciously few TLDs: ${tlds.length}`);

const body = tlds.map((t) => `  '${t}',`).join('\n');

const out = `/**
 * 真实存在的顶级域名（IANA 官方快照，本地数据）。
 *
 * ⚠️ 本文件由 \`scripts/update-tld-list.mjs\` 生成，请勿手工编辑。
 *
 * - 来源：${SOURCE_URL}
 * - 版本：${version}
 * - 更新：${updated} UTC
 * - SHA-256：${sha256}
 *
 * 用途：判断某个后缀是不是**真实存在**的顶级域名，用于消除歧义
 * （如 \`.ai\`、\`.md\` 既是真实 TLD 也像文件扩展名）。
 * 它**不是**拒绝未知后缀的白名单 —— 不在表内的后缀仍按文件名启发式与结构判定处理，
 * 因此新增 TLD 不会让已能识别的地址失效。
 *
 * 运行期只查这份本地数据，不对用户输入发起任何联网探测。
 */
export const PUBLIC_TLDS: ReadonlySet<string> = new Set([
${body}
]);
`;

writeFileSync(OUT_PATH, out, 'utf8');
console.log(`wrote ${tlds.length} TLDs (version ${version}, sha256 ${sha256.slice(0, 12)}…) to ${OUT_PATH}`);

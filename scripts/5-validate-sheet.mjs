// CLI: node scripts/5-validate-sheet.mjs <dump.json>
// dump.json = mảng object của tab `words`. Thoát code 1 nếu có dòng bị chặn.
import { readFile } from 'node:fs/promises';
import { validateRows } from '../src/data/validate-rows.mjs';

const OUT = new URL('../data/', import.meta.url).pathname;
const file = process.argv[2];
if (!file) {
  console.error('dùng: node scripts/5-validate-sheet.mjs <dump.json>');
  process.exit(2);
}

const rows = JSON.parse(await readFile(file, 'utf8'));
const seed = JSON.parse(await readFile(OUT + 'seed.hsk1-4.json', 'utf8'));
let overrides = {};
try {
  overrides = JSON.parse(await readFile(OUT + 'overrides.pinyin.json', 'utf8'));
} catch {}

const { accepted, blocked, warnings } = validateRows(rows, seed, overrides);
console.log(`Đọc ${rows.length} dòng → nạp được ${accepted.length}`);
console.log(`\nBị chặn: ${blocked.length}`);
for (const b of blocked) console.log(`  ✗ ${b.at}  ${b.reason}`);
console.log(`Cảnh báo: ${warnings.length}`);
for (const w of warnings.slice(0, 20)) console.log(`  ! ${w.at}  ${w.reason}`);
if (warnings.length > 20) console.log(`  … còn ${warnings.length - 20}`);
process.exit(blocked.length ? 1 : 0);

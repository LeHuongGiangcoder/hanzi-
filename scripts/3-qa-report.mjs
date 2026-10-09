// Kiểm tra tính toàn vẹn của seed trước khi đẩy lên Sheet / nạp vào app.
// Thoát code 1 nếu có lỗi chặn (blocking), để cắm được vào CI sau này.
import { readFile, writeFile } from 'node:fs/promises';
import { pinyin } from 'pinyin-pro';
import { toneless } from './lib/py.mjs';

const OUT = new URL('../data/', import.meta.url).pathname;
const words = JSON.parse(await readFile(OUT + 'seed.hsk1-4.json', 'utf8'));

const errors = [];
const warns = [];
const intended = []; // lệch có chủ ý vì đã override bằng tay

// 1. Trùng hán tự
const seen = new Map();
for (const w of words) {
  if (seen.has(w.hanzi)) errors.push(`trùng hán tự: ${w.hanzi} (HSK${seen.get(w.hanzi)} và HSK${w.hsk_level})`);
  else seen.set(w.hanzi, w.hsk_level);
}

// 2. Trường bắt buộc
for (const w of words) {
  if (!w.hanzi) errors.push('thiếu hanzi');
  if (!w.pinyin) errors.push(`thiếu pinyin: ${w.hanzi}`);
  if (![1, 2, 3, 4].includes(w.hsk_level)) errors.push(`hsk_level lạ: ${w.hanzi}`);
}

// 3. Hán tự lạ (không phải CJK) — bắt lỗi copy/paste, BOM, ký tự Latin lẫn vào
const CJK = /^[㐀-䶿一-鿿豈-﫿]+$/;
for (const w of words) if (!CJK.test(w.hanzi)) errors.push(`hanzi chứa ký tự không phải CJK: "${w.hanzi}"`);

// 4. Âm (bỏ thanh) của pinyin phải khớp pinyin-pro — bắt lỗi gõ sai / lệch hàng
for (const w of words) {
  const expect = toneless(pinyin(w.hanzi, { toneType: 'none' }));
  if (toneless(w.pinyin) !== expect) {
    const msg = `${w.hanzi} = "${w.pinyin}" ≠ pinyin-pro "${expect}"`;
    if (w.flags.includes('override')) intended.push(`${msg} — ${w.note}`);
    else warns.push(`âm lệch pinyin-pro: ${msg}`);
  }
}

// 5. Số âm tiết phải bằng số hán tự
for (const w of words) {
  const syl = w.pinyin.trim().split(/\s+/).length;
  if (syl !== w.hanzi.length && !/r$/.test(w.pinyin) && !w.flags.includes('override'))
    warns.push(`số âm tiết ≠ số chữ: ${w.hanzi} (${w.hanzi.length} chữ) = "${w.pinyin}" (${syl} âm)`);
}

// 6. Tiến độ nội dung
const noVi = words.filter((w) => !w.meaning_vi).length;
const noEx = words.filter((w) => !w.example_zh).length;

// 7. Whitelist hán tự cho validator i+1 của câu ví dụ
const charSet = {};
for (const lvl of [1, 2, 3, 4]) {
  const chars = new Set();
  for (const w of words) if (w.hsk_level <= lvl) for (const c of w.hanzi) chars.add(c);
  charSet[lvl] = [...chars].sort();
}
await writeFile(OUT + 'char-whitelist.json', JSON.stringify(charSet), 'utf8');

// 8. Nhóm đồng âm → file riêng cho app dùng làm distractor
const groups = {};
for (const w of words) (groups[w.homophone_key] ??= []).push(w.hanzi);
const homo = Object.fromEntries(Object.entries(groups).filter(([, v]) => v.length > 1));
await writeFile(OUT + 'homophones.json', JSON.stringify(homo, null, 1), 'utf8');

console.log(`Từ                     : ${words.length}`);
console.log(`Hán tự whitelist       : ` + [1, 2, 3, 4].map((l) => `HSK≤${l}:${charSet[l].length}`).join('  '));
console.log(`Nhóm đồng âm           : ${Object.keys(homo).length}  → data/homophones.json`);
console.log(`Chưa có nghĩa tiếng Việt: ${noVi}`);
console.log(`Chưa có câu ví dụ       : ${noEx}`);
console.log(`\nLỗi chặn   : ${errors.length}`);
for (const e of errors.slice(0, 20)) console.log('  ✗ ' + e);
console.log(`Lệch có chủ ý (override): ${intended.length}`);
for (const i of intended) console.log('  ~ ' + i);
console.log(`Cảnh báo   : ${warns.length}`);
for (const w of warns.slice(0, 15)) console.log('  ! ' + w);
if (warns.length > 15) console.log(`  … còn ${warns.length - 15} cảnh báo nữa`);
process.exit(errors.length ? 1 : 0);

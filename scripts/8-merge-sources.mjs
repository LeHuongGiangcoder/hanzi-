// Hợp nhất 3 nguồn thành kho từ cuối cùng.
//
// Chuẩn: HSK 3.0 cấp 1-4 (sheet của bạn) + các từ HSK 2.0 mà sheet không có.
//
// Nguồn tốt nhất cho từng cột — rút ra từ việc đối chiếu thật, không phải giả định:
//
//   danh sách, level, câu ví dụ, Hán-Việt  ← SHEET của bạn
//     Sheet đủ 100% các trường, câu ví dụ chứa từ khoá ở 3234/3245 dòng, và
//     Hán-Việt nhiều chỗ đúng hơn bản tôi soạn (办法 Biện pháp, 错 Thác).
//     NHƯNG 94% câu ví dụ là PHỒN THỂ → phải quy về giản thể.
//
//   nghĩa tiếng Việt  ← bản tôi soạn cho các từ trùng, sheet cho phần còn lại
//     Nghĩa của sheet cô đọng kiểu từ điển, dùng làm PROMPT thì yếu: 把 ghi
//     "Cầm nắm, để" trong khi HSK3 dùng nó làm giới từ; 张 ghi "Mở ra" trong khi
//     nó gần như luôn là lượng từ. Bản tôi soạn giải thích chức năng ngữ pháp,
//     hợp với việc bắt tạo ra chữ từ nghĩa. Nghĩa của sheet giữ ở meaning_vi_alt.
//
//   pinyin  ← bản đã vet của tôi cho các từ trùng, sheet cho phần còn lại
//     Đối chiếu 1045 từ trùng: 0 ca lệch âm, chỉ 45 ca lệch thanh nhẹ (thanh nhẹ
//     kiểu giáo trình: xué sheng, so với thanh gốc xuéshēng của sheet).
//     Sheet lại ĐÚNG HƠN ở vần hoá -r (hǎowánr, nǎr) nên phần sheet-only giữ nguyên.
//
//   bộ thủ, tần suất, phồn thể  ← complete-hsk-vocabulary
//     Luật gợi ý rơi về bộ thủ sẽ hỏng nếu 2111 từ mới thiếu cột này.
import { readFileSync, writeFileSync } from 'node:fs';
import * as OpenCC from 'opencc-js';
import { pinyin } from 'pinyin-pro';
import { toneless } from './lib/py.mjs';

// from:'t' là chuyển đổi THUẦN MẶT CHỮ. from:'tw' còn đổi cả từ vựng kiểu Đài
// Loan và chuyển quá tay: nó biến 显著 (vốn đúng giản thể) thành 显着.
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });

/**
 * Chuẩn hoá pinyin về một dạng duy nhất.
 *
 * Hai nguồn viết khác nhau: bộ đã vet tách âm tiết bằng dấu cách ("méi yǒu"),
 * sheet viết liền ("méiyǒu"). Viết liền mới đúng chính tả pinyin cho một TỪ,
 * và cũng là dạng của 2315/3304 mục, nên quy hết về đó.
 * Đồng thời bỏ chú thích lọt vào ô pinyin, ví dụ "yuán (fúwùyuán)".
 */
function cleanPinyin(p) {
  return String(p ?? '')
    .replace(/[（(][^)）]*[)）]/g, '')
    .normalize('NFC')
    .replace(/\s+/g, '')
    .trim();
}
const SRC = 'data/source/';
const OUT = 'data/';

/* ---------- đọc sheet của user ---------- */
// Mỗi tab một layout khác nhau. Index 0-based.
const TABS = {
  HSK1: { hanzi: 0, pinyin: 1, hv: 2, vi: 3, ex: 4, exPy: 5, exVi: 6 },
  HSK2: { hanzi: 0, pinyin: 1, hv: 2, vi: 3, ex: 4, exPy: 5, exVi: 6 },
  HSK3: { hanzi: 1, pinyin: 2, hv: 3, vi: 4, ex: 5, exPy: 6, exVi: 7 },
  HSK4: { hanzi: 0, pinyin: 1, hv: 2, vi: 4, ex: 5, exPy: 6, exVi: 7 },
};

function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

const sheet = new Map();          // hanzi -> bản ghi, giữ bản ở level THẤP nhất
let sheetRows = 0, tradFixed = 0;
for (const [tab, m] of Object.entries(TABS)) {
  const level = Number(tab.slice(3));
  for (const r of parseCsv(readFileSync(SRC + 'user-sheet/' + tab + '.csv', 'utf8')).slice(1)) {
    const hanzi = (r[m.hanzi] ?? '').trim();
    if (!hanzi) continue;
    sheetRows++;
    const prev = sheet.get(hanzi);
    if (prev && prev.hsk_level <= level) continue;
    const exRaw = (r[m.ex] ?? '').trim();
    const ex = t2s(exRaw);
    if (ex !== exRaw) tradFixed++;
    sheet.set(hanzi, {
      hanzi,
      hsk_level: level,
      standard: 'hsk3',
      pinyin: (r[m.pinyin] ?? '').trim(),
      hanviet: (r[m.hv] ?? '').trim().toLowerCase(),
      meaning_vi: (r[m.vi] ?? '').trim(),
      example_zh: ex,
      example_pinyin: (r[m.exPy] ?? '').trim(),
      example_vi: (r[m.exVi] ?? '').trim(),
    });
  }
}

/* ---------- từ loại tiếng Việt từ mã CC-CEDICT ---------- */
// Chỉ dùng cho các từ mới (sheet không có cột từ loại). Mã của CC-CEDICT.
const POS_VI = {
  n: 'danh từ', v: 'động từ', a: 'tính từ', d: 'phó từ', m: 'số từ', q: 'lượng từ',
  r: 'đại từ', p: 'giới từ', c: 'liên từ', cc: 'liên từ', u: 'trợ từ', y: 'trợ từ',
  e: 'thán từ', o: 'từ tượng thanh', t: 'danh từ chỉ thời gian', f: 'danh từ chỉ vị trí',
  s: 'danh từ chỉ nơi chốn', ns: 'danh từ riêng', nr: 'danh từ riêng', nz: 'danh từ riêng',
  vn: 'động từ / danh từ', an: 'tính từ / danh từ', ad: 'tính từ / phó từ',
  qt: 'lượng từ', qv: 'lượng từ', b: 'tính từ', k: 'hậu tố', h: 'tiền tố',
  i: 'thành ngữ', l: 'cụm từ', g: '', z: 'tính từ', j: 'từ viết tắt',
};
function posVi(codes) {
  const seen = [];
  for (const c of codes ?? []) {
    const vi = POS_VI[c];
    if (vi && !seen.includes(vi)) seen.push(vi);
  }
  return seen.slice(0, 2).join(' / ');
}

/* ---------- nguồn tham chiếu ---------- */
const ref = new Map();
const refChars = new Set();   // mọi hán tự từng xuất hiện trong 11470 mục
for (const e of JSON.parse(readFileSync(SRC + 'kameleon-complete.min.json', 'utf8'))) {
  if (!ref.has(e.s)) ref.set(e.s, e);
  for (const c of e.s) refChars.add(c);
}

/* ---------- kho từ HSK 2.0 đã vet trước đây ---------- */
const old = new Map(
  JSON.parse(readFileSync(OUT + 'seed.hsk2-vetted.json', 'utf8')).map((w) => [w.hanzi, w])
);

/* ---------- hợp nhất ---------- */
const out = [];
const conflicts = [];

for (const w of sheet.values()) {
  const o = old.get(w.hanzi);
  const r = ref.get(w.hanzi);

  // pinyin: bản đã vet thắng ở các từ trùng (giữ thanh nhẹ kiểu giáo trình)
  let py = cleanPinyin(w.pinyin);
  if (o?.pinyin) {
    if (toneless(o.pinyin) === toneless(w.pinyin)) py = cleanPinyin(o.pinyin);
    else conflicts.push({ hanzi: w.hanzi, kind: 'pinyin_sound', mine: o.pinyin, sheet: w.pinyin });
  }

  if (o?.meaning_vi && o.meaning_vi !== w.meaning_vi) {
    // Khác cách diễn đạt thì bỏ qua; chỉ ghi lại khi hai bản KHÔNG chia sẻ
    // một từ thực nào — đó mới là dấu hiệu một trong hai bản sai nghĩa.
    const words = (s) => new Set(
      s.toLowerCase().replace(/[(),;.…]/g, ' ').split(/\s+/).filter((t) => t.length > 1)
    );
    const a = words(o.meaning_vi), b = words(w.meaning_vi);
    const shared = [...a].filter((t) => b.has(t));
    if (!shared.length)
      conflicts.push({ hanzi: w.hanzi, kind: 'meaning_diverges', mine: o.meaning_vi, sheet: w.meaning_vi });
  }

  out.push({
    ...w,
    pinyin: py,
    meaning_vi: o?.meaning_vi || w.meaning_vi,
    meaning_vi_alt: o?.meaning_vi && o.meaning_vi !== w.meaning_vi ? w.meaning_vi : '',
    hanviet: w.hanviet || o?.hanviet || '',
    pos_vi: o?.pos_vi || posVi(r?.p),
    radical: r?.r ?? o?.radical ?? ref.get([...w.hanzi][0])?.r ?? '',
    frequency: r?.q ?? o?.frequency ?? null,
    traditional: r?.f?.[0]?.t && r.f[0].t !== w.hanzi ? r.f[0].t : '',
    note: o?.note ?? '',
    homophone_key: toneless(py),
    lesson: '',
    active: true,
    quarantined: false,
    // Dấu vết nguồn: mỗi cột đến từ đâu, để sau này audit lại được.
    flags: [
      o?.pinyin ? 'pinyin:vetted' : 'pinyin:sheet',
      o?.meaning_vi ? 'meaning:mine' : 'meaning:sheet',
      ...(o?.note ? ['override'] : []),
    ],
  });
}

// Từ chỉ có trong kho HSK 2.0 — giữ lại, đánh dấu rõ nguồn.
let extras = 0;
for (const o of old.values()) {
  if (sheet.has(o.hanzi)) continue;
  extras++;
  const r = ref.get(o.hanzi);
  out.push({
    hanzi: o.hanzi, hsk_level: o.hsk_level, standard: 'hsk2-extra',
    pinyin: cleanPinyin(o.pinyin), hanviet: o.hanviet ?? '', meaning_vi: o.meaning_vi ?? '',
    pos_vi: o.pos_vi || posVi(r?.p), example_zh: '', example_pinyin: '', example_vi: '',
    radical: r?.r ?? o.radical ?? ref.get([...o.hanzi][0])?.r ?? '', frequency: r?.q ?? o.frequency ?? null,
    traditional: o.traditional ?? '', note: o.note ?? '',
    homophone_key: toneless(cleanPinyin(o.pinyin)), lesson: '', active: true, quarantined: false,
    flags: ['hsk2-extra', 'pinyin:vetted', 'meaning:mine', ...(o.note ? ['override'] : [])],
  });
}

out.sort((a, b) =>
  a.hsk_level - b.hsk_level ||
  (a.frequency ?? 1e9) - (b.frequency ?? 1e9) ||
  a.hanzi.localeCompare(b.hanzi)
);

writeFileSync(OUT + 'seed.hsk1-4.json', JSON.stringify(out, null, 1));
// Từ không có trong từ điển tham chiếu 11470 mục VÀ cũng không có trong kho cũ
// → nhiều khả năng là lỗi gõ trong sheet. Đây đúng loại lỗi câm app này sợ nhất.
const suspect = out
  .filter((w) => !ref.has(w.hanzi) && !old.has(w.hanzi))
  .map((w) => {
    // Chữ KHÔNG xuất hiện trong bất kỳ mục nào của 11470 từ → gần như chắc chắn
    // gõ sai. Chữ có xuất hiện nhưng từ ghép thì không có → chỉ đáng ngờ.
    const unknownChars = [...w.hanzi].filter((c) => !refChars.has(c));
    return {
      hanzi: w.hanzi, hsk_level: w.hsk_level, pinyin: w.pinyin,
      meaning_vi: w.meaning_vi, unknownChars,
      severity: unknownChars.length ? 'chữ không tồn tại' : 'từ ghép không có trong từ điển',
    };
  });
// Tự cách ly: từ đáng ngờ không được vào deck cho tới khi bạn xác nhận với sách.
// Chữ ĐƠN không phải mục từ điển vẫn là chữ thật (桌, 阳, 航…) — không cách ly,
// chỉ ghi chú. Chỉ cách ly TỪ GHÉP không tra được: đó mới là dấu hiệu gõ nhầm chữ.
const KNOWN_OK = new Set(['不是', '娇小', '孔儿']);   // đã tra tay: là từ thật
const FIXES = {                                        // đề xuất sửa, cần bạn đối chiếu sách
  '阳天': '晴天', '里米': '厘米', '拨脱': '摆脱', '播动': '拨动', '补子': '补丁',
};
for (const x of suspect) {
  x.suggest = FIXES[x.hanzi] ?? '';
  x.quarantine = [...x.hanzi].length > 1 && !KNOWN_OK.has(x.hanzi);
}
const suspectSet = new Set(suspect.filter((x) => x.quarantine).map((x) => x.hanzi));
for (const w of out) if (suspectSet.has(w.hanzi)) { w.quarantined = true; w.flags.push('suspect'); }
writeFileSync(OUT + 'suspect-words.json', JSON.stringify(suspect, null, 1));
// Ghi seed SAU khi đã áp cách ly, nếu không cờ quarantined không vào được file.
writeFileSync(OUT + 'seed.hsk1-4.json', JSON.stringify(out, null, 1));
writeFileSync(OUT + 'merge-conflicts.json', JSON.stringify(conflicts, null, 1));

/* ---------- thống kê ---------- */
const byLvl = {};
for (const w of out) byLvl[`HSK${w.hsk_level}`] = (byLvl[`HSK${w.hsk_level}`] ?? 0) + 1;
const missing = (k) => out.filter((w) => !w[k]).length;

console.log(`Sheet: ${sheetRows} dòng → ${sheet.size} từ sau khi bỏ trùng`);
console.log(`Câu ví dụ quy phồn thể → giản thể: ${tradFixed}`);
console.log(`Từ chỉ có ở kho HSK 2.0, giữ lại : ${extras}`);
console.log(`\nTỔNG: ${out.length} từ`, byLvl);
console.log(`Thiếu: ` + JSON.stringify({
  pinyin: missing('pinyin'), hanviet: missing('hanviet'), nghĩa: missing('meaning_vi'),
  bộ_thủ: missing('radical'), ví_dụ: missing('example_zh'), từ_loại: missing('pos_vi'),
}));
console.log(`Đáng ngờ → tự cách ly: ${suspect.length} → data/suspect-words.json`);
console.log(`  trong đó bị cách ly: ${suspect.filter((x) => x.quarantine).length}` +
            ` (chữ đơn hợp lệ chỉ ghi chú, không cách ly)`);
console.log(`Xung đột cần soi: ${conflicts.length} → data/merge-conflicts.json`);
const byKind = {};
for (const c of conflicts) byKind[c.kind] = (byKind[c.kind] ?? 0) + 1;
console.log(' ', byKind);

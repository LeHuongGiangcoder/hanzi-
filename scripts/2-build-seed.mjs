// Gộp 3 nguồn pinyin, chọn âm đọc, gom nhóm đồng âm, xuất seed + danh sách cần review.
//
// Quy tắc chọn pinyin (rút ra từ việc đối chiếu thật 1193 từ HSK 1-4):
//
//   1. overrides.pinyin.json      — quyết định tay, cao nhất
//   2. Hán tự ĐƠN  → pinyin-pro   — A và B sắp âm đọc theo alphabet nên forms[0] hay sai
//                                   (看→kān, 读→dòu, 吗→má); pinyin-pro chọn theo tần suất.
//   3. Từ NHIỀU ÂM → nguồn A      — A/B (CC-CEDICT) ghi đúng thanh nhẹ như sách giáo trình
//                                   (名字 míng zi, 朋友 péng you, 谢谢 xiè xie); pinyin-pro
//                                   trả thanh gốc từng chữ. Chỉ nhận form nào trùng âm với
//                                   pinyin-pro, để không kéo theo lỗi thứ tự alphabet của A.
//
// Chỉ đẩy vào review-pinyin.md những ca thật sự mơ hồ, không phải mọi từ đa âm.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { pinyin } from 'pinyin-pro';
import { toneless, tonal, splitAlts } from './lib/py.mjs';

const SRC = new URL('../data/source/', import.meta.url).pathname;
const OUT = new URL('../data/', import.meta.url).pathname;
const read = async (f) => JSON.parse(await readFile(SRC + f, 'utf8'));

// CC-CEDICT viết hoa pinyin cho tên riêng (Tāng = họ Thang) và có nhiều nhánh
// "surname …" / "old variant of …". Nếu chọn trúng nhánh đó thì cột nghĩa thành rác.
const JUNK =
  /^(surname |old variant of|variant of|erhua variant of|see [^ ]|used in |\(onom\.\)|abbr\. for [^ ]*$)/i;
const isProperNoun = (p) => /^[A-Z]/.test(p.trim());
const hasJunkMeaning = (f) =>
  (f.meanings ?? []).length === 0 || (f.meanings ?? []).every((m) => JUNK.test(m));
// Dùng để *ưu tiên* form: tránh nhánh tên riêng và nhánh nghĩa rác.
const isJunkForm = (f) => isProperNoun(f.transcriptions.pinyin) || hasJunkMeaning(f);

/** Chọn form "dùng được" trước, chỉ rơi về form rác khi không còn gì khác. */
function preferUsable(forms) {
  const usable = forms.filter((f) => !isJunkForm(f));
  return usable.length ? usable : forms;
}

let overrides = {};
try {
  overrides = JSON.parse(await readFile(OUT + 'overrides.pinyin.json', 'utf8'));
  delete overrides.$schema;
  delete overrides.$note;
} catch {
  console.log('(chưa có data/overrides.pinyin.json — bỏ qua)');
}

const srcB = await read('hskinfinite-vocab.json');

// Nghĩa tiếng Việt + âm Hán-Việt do Claude soạn. Google Sheet là nguồn CHÍNH khi
// bạn đã sửa trên đó; file này chỉ là bản soạn ban đầu để bơm lên Sheet lần đầu.
let vi = {};
try {
  vi = JSON.parse(await readFile(OUT + 'meanings.vi.json', 'utf8'));
  delete vi.$note;
} catch {
  console.log('(chưa có data/meanings.vi.json — bỏ qua nghĩa tiếng Việt)');
}

const entries = [];
for (const lvl of [1, 2, 3, 4]) {
  for (const e of await read(`kameleon-hsk${lvl}.json`)) entries.push({ lvl, e });
}

const words = [];
for (const { lvl, e } of entries) {
  const hanzi = e.simplified;
  const formsA = e.forms.map((f) => f.transcriptions.pinyin);
  const altsB = srcB[hanzi] ? splitAlts(srcB[hanzi][1]) : [];
  const pp = pinyin(hanzi, { toneType: 'symbol' });
  const overrideRaw = overrides[hanzi];
  const override =
    typeof overrideRaw === 'string' ? overrideRaw : overrideRaw?.pinyin ?? undefined;
  const overrideWhy = typeof overrideRaw === 'object' ? overrideRaw.why : '';
  const multiSyllable = hanzi.length > 1;
  const flags = [];

  // Các form của A trùng âm (bỏ thanh) với pinyin-pro: ứng viên hợp lệ.
  const usableForms = preferUsable(e.forms);
  const sameSound = preferUsable(
    e.forms.filter((f) => toneless(f.transcriptions.pinyin) === toneless(pp))
  ).filter((f) => toneless(f.transcriptions.pinyin) === toneless(pp));
  // Trong số đó, ưu tiên form có âm tiết thanh nhẹ (东西 → "dōng xi", 告诉 → "gào su").
  const neutralish = sameSound.filter((f) =>
    f.transcriptions.pinyin
      .split(/\s+/)
      .slice(1)
      .some((syl) => !/[\u0300-\u036f]/.test(syl.normalize('NFD')))
  );

  let chosen, form;
  if (override) {
    chosen = override;
    flags.push('override');
    form =
      preferUsable(e.forms.filter((f) => tonal(f.transcriptions.pinyin) === tonal(chosen)))[0] ??
      preferUsable(e.forms.filter((f) => toneless(f.transcriptions.pinyin) === toneless(chosen)))[0] ??
      usableForms[0];
  } else if (multiSyllable && sameSound.length) {
    form = neutralish[0] ?? sameSound[0];
    chosen = form.transcriptions.pinyin;
    if (isProperNoun(chosen) && !isProperNoun(pp)) chosen = pp;
    // Nhiều ứng viên cùng âm mà khác thanh → máy không quyết được, cần mắt người.
    const distinct = new Set(sameSound.map((f) => tonal(f.transcriptions.pinyin)));
    if (distinct.size > 1) flags.push('ambiguous_tone');
  } else {
    chosen = pp;
    form =
      preferUsable(e.forms.filter((f) => tonal(f.transcriptions.pinyin) === tonal(pp)))[0] ??
      sameSound[0] ??
      usableForms[0];
    if (!sameSound.length) flags.push('pp_outside_sourceA');
  }

  if (altsB.length && !altsB.some((p) => toneless(p) === toneless(chosen)))
    flags.push('conflict_sourceB');
  if (!srcB[hanzi]) flags.push('absent_sourceB');
  if (e.forms.length > 1 || altsB.length > 1) flags.push('multi_reading');
  if (hasJunkMeaning(form)) flags.push('junk_meaning');
  // Hán tự đơn nhiều âm đọc khác nhau: vùng pinyin-pro có thể chọn sai ngữ cảnh HSK.
  if (!multiSyllable && !override) {
    const sounds = new Set(
      preferUsable(e.forms).map((f) => toneless(f.transcriptions.pinyin))
    );
    if (sounds.size > 1) flags.push('single_char_multi_sound');
    // Cùng âm khác thanh (只 zhī/zhǐ, 教 jiāo/jiào, 干 gān/gàn): đúng vùng hay lẫn nhất.
    const tones = new Set(
      preferUsable(e.forms).map((f) => tonal(f.transcriptions.pinyin))
    );
    if (sounds.size === 1 && tones.size > 1) flags.push('single_char_multi_tone');
  }

  words.push({
    hanzi,
    traditional: form.traditional === hanzi ? '' : form.traditional,
    pinyin: chosen,
    hsk_level: lvl,
    radical: e.radical ?? '',
    pos: (e.pos ?? []).join(','),
    frequency: e.frequency ?? null,
    meanings_en: (form.meanings ?? []).slice(0, 3),
    meaning_vi: vi[hanzi]?.vi ?? '',
    hanviet: vi[hanzi]?.hv ?? '',
    pos_vi: vi[hanzi]?.pos ?? '',
    example_zh: '',
    example_vi: '',
    note: overrideWhy ?? '',
    homophone_key: toneless(chosen),
    needs_review: flags.some((f) =>
      ['ambiguous_tone', 'pp_outside_sourceA', 'conflict_sourceB', 'junk_meaning'].includes(f)
    ),
    flags,
    _sources: { pinyin_pro: pp, source_a: formsA, source_b: altsB },
  });
}

// ---- nhóm đồng âm ----
const groups = new Map();
for (const w of words) {
  if (!groups.has(w.homophone_key)) groups.set(w.homophone_key, []);
  groups.get(w.homophone_key).push(w);
}
const homoGroups = [...groups.entries()].filter(([, v]) => v.length > 1);
for (const [, v] of homoGroups) for (const w of v) w.homophone_group_size = v.length;

await mkdir(OUT, { recursive: true });
await writeFile(OUT + 'seed.hsk1-4.json', JSON.stringify(words, null, 1), 'utf8');

// ---- báo cáo review ----
const review = words.filter((w) => w.needs_review);
const lines = [
  '# Pinyin cần review',
  '',
  `Sinh tự động bởi \`scripts/2-build-seed.mjs\`. ${review.length}/${words.length} từ.`,
  '',
  'Sửa bằng cách thêm vào `data/overrides.pinyin.json`, rồi chạy lại `npm run data:build`.',
  '',
  '| HSK | Hán tự | Đang chọn (pinyin-pro) | Nguồn A (forms) | Nguồn B | Cờ |',
  '|---|---|---|---|---|---|',
];
for (const w of review) {
  lines.push(
    `| ${w.hsk_level} | ${w.hanzi} | \`${w.pinyin}\` | ${w._sources.source_a.join(', ')} | ${
      w._sources.source_b.join(', ') || '—'
    } | ${w.flags.join(' ')} |`
  );
}
await writeFile(OUT + 'review-pinyin.md', lines.join('\n') + '\n', 'utf8');

// ---- thống kê ----
const byFlag = {};
for (const w of words) for (const f of w.flags) byFlag[f] = (byFlag[f] ?? 0) + 1;
const inHomo = homoGroups.reduce((n, [, v]) => n + v.length, 0);
console.log(`Tổng từ HSK 1-4        : ${words.length}`);
console.log(`Cần review pinyin      : ${review.length}  → data/review-pinyin.md`);
console.log(`Cờ                     :`, byFlag);
console.log(`Nhóm đồng âm           : ${homoGroups.length} nhóm / ${inHomo} từ (${Math.round((inHomo / words.length) * 100)}%)`);
const h12 = [...groups.entries()].filter(([, v]) => v.filter((w) => w.hsk_level <= 2).length > 1);
console.log(`  riêng HSK 1-2        : ${h12.length} nhóm`);
const withVi = words.filter((w) => w.meaning_vi).length;
const withHv = words.filter((w) => w.hanviet).length;
console.log(`Có nghĩa tiếng Việt    : ${withVi}/${words.length}`);
console.log(`Có âm Hán-Việt         : ${withHv}/${withVi} (trên số từ đã có nghĩa)`);
console.log(`Đã ghi                 : data/seed.hsk1-4.json`);

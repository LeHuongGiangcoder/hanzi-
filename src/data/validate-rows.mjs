// Validator cho dòng đọc từ Google Sheet, chạy mỗi lần sync Sheet → SQLite.
// Hàm thuần, không I/O, để test được.
//
// blocked[] = KHÔNG nạp vào deck. warnings[] = nạp nhưng cần xem lại.
import { pinyin } from 'pinyin-pro';
import { toneless, tonal } from '../../scripts/lib/py.mjs';

const CJK = /^[㐀-䶿一-鿿豈-﫿]+$/;

/**
 * @param {Array<object>} rows   dòng từ tab `words` (đã map theo tên cột)
 * @param {Array<object>} seed   data/seed.hsk1-4.json
 * @param {object} overrides     data/overrides.pinyin.json
 */
export function validateRows(rows, seed, overrides = {}) {
  const known = new Map(seed.map((w) => [w.hanzi, w]));
  const charsByLevel = {};
  for (const lvl of [1, 2, 3, 4]) {
    charsByLevel[lvl] = new Set();
    for (const w of seed) if (w.hsk_level <= lvl) for (const c of w.hanzi) charsByLevel[lvl].add(c);
  }

  const blocked = [];
  const warnings = [];
  const accepted = [];
  const seenHanzi = new Set();

  rows.forEach((row, i) => {
    const at = `dòng ${i + 2}`; // +2 vì có header và Sheet đếm từ 1
    const h = (row.hanzi ?? '').trim();
    const block = (reason) => blocked.push({ at, hanzi: h, reason });
    const warn = (reason) => warnings.push({ at, hanzi: h, reason });

    if (!h) return block('thiếu hán tự');
    if (!CJK.test(h)) return block(`hán tự chứa ký tự không phải CJK: "${h}"`);
    if (seenHanzi.has(h)) return block(`trùng với dòng trước: ${h}`);
    seenHanzi.add(h);

    // Lưới chính: hán tự phải có trong seed đã kiểm.
    // Đây là lưới bắt được ca 晚上 bị gõ thành 晥上 khi bơm dữ liệu lần đầu.
    const ref = known.get(h);
    if (!ref) return block(`"${h}" không có trong seed HSK 1-4 — có thể gõ sai chữ`);

    const py = (row.pinyin ?? '').trim();
    if (!py) block(`thiếu pinyin: ${h}`);
    else {
      // So với seed (đã qua 3 nguồn + override) và so CÓ DẤU.
      // So bỏ dấu là không đủ: 买 bị sửa thành "mài" vẫn lọt, mà đó đúng là
      // kiểu lẫn trong cùng âm mà app này sinh ra để chống.
      if (tonal(py) !== tonal(ref.pinyin))
        warn(`pinyin "${py}" khác seed đã kiểm ("${ref.pinyin}") — nếu bạn sửa có ý thì đưa vào overrides.pinyin.json`);
      else {
        const expect = toneless(pinyin(h, { toneType: 'none' }));
        if (toneless(py) !== expect && !overrides[h])
          warn(`pinyin "${py}" lệch âm so với pinyin-pro ("${expect}") mà không có override`);
      }
      // Pinyin được chuẩn hoá về viết liền ("méiyǒu"), nên không còn đếm âm
      // tiết theo dấu cách được nữa. Kiểm định dạng thay cho kiểm số âm tiết.
      if (!/^[a-zA-ZüÜ\u00C0-\u024F\u1E00-\u1EFF'\u2019-]+$/.test(py))
        warn(`pinyin sai định dạng: "${py}"`);
    }

    if (String(row.active).toUpperCase() === 'FALSE') return; // bạn tự tắt, bỏ qua im lặng
    if (!(row.meaning_vi ?? '').trim()) {
      warn('chưa có nghĩa tiếng Việt — chưa đưa vào deck');
      return;
    }

    // Kiểm nguyên tắc i+1 của câu ví dụ
    const ex = (row.example_zh ?? '').trim();
    if (ex) {
      const allowed = charsByLevel[ref.hsk_level];
      const outside = [...new Set([...ex])].filter((c) => CJK.test(c) && !allowed.has(c));
      if (outside.length)
        warn(`câu ví dụ chứa ${outside.length} chữ ngoài HSK≤${ref.hsk_level}: ${outside.join(' ')}`);
    }

    accepted.push({ ...row, hanzi: h, pinyin: py, hsk_level: ref.hsk_level });
  });

  return { accepted, blocked, warnings };
}

// Tiện ích chuẩn hoá pinyin dùng chung cho pipeline.

/** Bỏ dấu thanh + khoảng trắng + hoa/thường → so sánh "cùng âm, khác thanh". */
export function toneless(p) {
  return p
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
}

/** Giữ dấu thanh, chỉ bỏ khoảng trắng + hoa/thường → so sánh chính xác âm đọc. */
export function tonal(p) {
  return p.normalize('NFC').toLowerCase().replace(/\s+/g, '');
}

/** Tách chuỗi kiểu "dōu / dū" của nguồn B thành mảng. */
export function splitAlts(p) {
  return String(p || '')
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean);
}

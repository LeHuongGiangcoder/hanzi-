// Đồng bộ Google Sheet bằng service account — code ghi, không ai gõ tay.
//
// Dùng google-auth-library + REST trực tiếp thay vì gói googleapis: chỉ cần 3
// endpoint, và tránh kéo về một dependency rất nặng.
import { GoogleAuth } from 'google-auth-library';
import { readFileSync, existsSync } from 'node:fs';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

export const WORD_COLS = [
  'hanzi', 'pinyin', 'hanviet', 'meaning_vi', 'hsk', 'lesson',
  'example_zh', 'example_vi', 'note', 'verified', 'active',
];
export const REPORT_COLS = [
  'report_id', 'created_at', 'hanzi', 'field', 'app_value', 'my_correction',
  'reason', 'session_id', 'status', 'resolved_at', 'resolution_note',
];

export class SheetsClient {
  constructor({ keyFile, spreadsheetId }) {
    if (!existsSync(keyFile)) throw new Error(`Không thấy file key service account: ${keyFile}`);
    this.spreadsheetId = spreadsheetId;
    this.auth = new GoogleAuth({ credentials: JSON.parse(readFileSync(keyFile, 'utf8')), scopes: SCOPES });
  }
  async client() {
    this._c ??= await this.auth.getClient();
    return this._c;
  }
  async req(url, init = {}) {
    const c = await this.client();
    const res = await c.request({ url, method: init.method ?? 'GET', data: init.body });
    return res.data;
  }
  get(range) {
    return this.req(`${API}/${this.spreadsheetId}/values/${encodeURIComponent(range)}`);
  }
  update(range, values) {
    return this.req(
      `${API}/${this.spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      { method: 'PUT', body: { values } }
    );
  }
  append(range, values) {
    return this.req(
      `${API}/${this.spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', body: { values } }
    );
  }
}

const col = (n) => String.fromCharCode(64 + n);

export function wordRow(w) {
  return [
    w.hanzi, w.pinyin, w.hanviet ?? '', w.meaning_vi ?? '', w.hsk_level,
    w.lesson ?? '', w.example_zh ?? '', w.example_vi ?? '', w.note ?? '',
    w.verified ? 'TRUE' : 'FALSE', w.active === 0 ? 'FALSE' : 'TRUE',
  ];
}

/**
 * Ghi đè toàn bộ tab `words` từ seed cục bộ.
 *
 * KHÔNG ghi đè các cột người dùng tự nhập (lesson, verified) nếu Sheet đã có —
 * những cột đó là của bạn, không phải của pipeline.
 */
export async function pushWords(sheets, words, { tab = 'words', preserve = ['lesson', 'verified'] } = {}) {
  const existing = await sheets.get(`${tab}!A1:K`).catch(() => ({ values: [] }));
  const rows = existing.values ?? [];
  const header = rows[0] ?? WORD_COLS;
  const idx = Object.fromEntries(WORD_COLS.map((c) => [c, header.indexOf(c)]));
  const keep = new Map();
  for (const r of rows.slice(1)) {
    if (!r[0]) continue;
    keep.set(r[0], Object.fromEntries(preserve.map((c) => [c, idx[c] >= 0 ? (r[idx[c]] ?? '') : ''])));
  }

  const out = words.map((w) => {
    const row = wordRow(w);
    const k = keep.get(w.hanzi);
    if (k) for (const c of preserve) {
      const at = WORD_COLS.indexOf(c);
      if (at >= 0 && k[c] !== '') row[at] = k[c];
    }
    return row;
  });

  await sheets.update(`${tab}!A1:${col(WORD_COLS.length)}1`, [WORD_COLS]);
  await sheets.update(`${tab}!A2:${col(WORD_COLS.length)}${out.length + 1}`, out);
  return { written: out.length, preserved: keep.size };
}

/** Đọc tab `words` về dạng object để validator kiểm trước khi nạp vào deck. */
export async function pullWords(sheets, { tab = 'words' } = {}) {
  const { values = [] } = await sheets.get(`${tab}!A1:K`);
  const header = values[0] ?? [];
  return values.slice(1)
    .filter((r) => r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

/** Đẩy các báo lỗi chưa sync lên tab _reports. */
export async function pushReports(sheets, reports, { tab = '_reports' } = {}) {
  if (!reports.length) return { appended: 0 };
  await sheets.append(`${tab}!A1`, reports.map((r) => [
    r.report_id, r.created_at, r.hanzi, r.field, r.app_value,
    r.my_correction, r.reason, r.session_id ?? '', r.status, '', '',
  ]));
  return { appended: reports.length };
}

/** Đọc ngược trạng thái xử lý báo lỗi để app biết từ nào được bỏ cách ly. */
export async function pullReportStatus(sheets, { tab = '_reports' } = {}) {
  const { values = [] } = await sheets.get(`${tab}!A1:K`);
  const header = values[0] ?? [];
  return values.slice(1)
    .filter((r) => r[0])
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// CLI đồng bộ Google Sheet. Code ghi — không ai gõ tay dòng nào.
//
//   node scripts/7-sync-sheet.mjs push      đẩy seed cục bộ lên tab words
//   node scripts/7-sync-sheet.mjs pull      kéo Sheet về, chạy validator, in kết quả
//   node scripts/7-sync-sheet.mjs reports   kéo trạng thái báo lỗi về
//
// Cấu hình bằng biến môi trường (hoặc file .env.local cạnh package.json):
//   HANZI_SHEET_ID=<id trên URL>
//   HANZI_SA_KEY=<đường dẫn tới file JSON service account>
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { SheetsClient, pushWords, pullWords, pullReportStatus } from '../src/core/sheets.mjs';
import { validateRows } from '../src/data/validate-rows.mjs';

const ROOT = new URL('../', import.meta.url).pathname;

// .env.local: KEY=value mỗi dòng, bỏ qua dòng trống và dòng bắt đầu bằng #
if (existsSync(ROOT + '.env.local')) {
  for (const line of readFileSync(ROOT + '.env.local', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const { HANZI_SHEET_ID: spreadsheetId, HANZI_SA_KEY: keyFile } = process.env;
if (!spreadsheetId || !keyFile) {
  console.error(`Thiếu cấu hình. Tạo file .env.local cạnh package.json:

  HANZI_SHEET_ID=1nXjE2TOoU_tggH8JRNw-zjX3CcGjMfY4XUVZgITudsk
  HANZI_SA_KEY=/đường/dẫn/tới/service-account.json

Cách lấy service account — xem mục "Đồng bộ Google Sheet" trong README.`);
  process.exit(2);
}

const sheets = new SheetsClient({ keyFile, spreadsheetId });
const cmd = process.argv[2] ?? 'push';
const seed = JSON.parse(readFileSync(ROOT + 'data/seed.hsk1-4.json', 'utf8'));

if (cmd === 'push') {
  const r = await pushWords(sheets, seed);
  console.log(`Đã ghi ${r.written} dòng lên tab words.`);
  console.log(`Giữ nguyên cột lesson/verified của ${r.preserved} dòng bạn đã nhập.`);
} else if (cmd === 'pull') {
  const rows = await pullWords(sheets);
  let overrides = {};
  try { overrides = JSON.parse(readFileSync(ROOT + 'data/overrides.pinyin.json', 'utf8')); } catch {}
  const { accepted, blocked, warnings } = validateRows(rows, seed, overrides);
  writeFileSync(ROOT + 'data/sheet-pull.json', JSON.stringify(rows, null, 1));
  console.log(`Đọc ${rows.length} dòng → nạp được ${accepted.length}  (data/sheet-pull.json)`);
  console.log(`Bị chặn: ${blocked.length}`);
  for (const b of blocked) console.log(`  ✗ ${b.at}  ${b.reason}`);
  console.log(`Cảnh báo: ${warnings.length}`);
  for (const w of warnings.slice(0, 20)) console.log(`  ! ${w.at}  ${w.reason}`);
  if (blocked.length) process.exit(1);
} else if (cmd === 'reports') {
  const rows = await pullReportStatus(sheets);
  writeFileSync(ROOT + 'data/reports-pull.json', JSON.stringify(rows, null, 1));
  const n = rows.filter((r) => (r.status ?? 'new') === 'new').length;
  console.log(`${rows.length} báo lỗi, ${n} chưa xử lý → data/reports-pull.json`);
  console.log(`Xử lý bằng: npm run data:reports -- data/reports-pull.json`);
} else {
  console.error(`Lệnh lạ: ${cmd}. Dùng: push | pull | reports`);
  process.exit(2);
}

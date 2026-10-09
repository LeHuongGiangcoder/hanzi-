// Xử lý báo lỗi từ tab _reports và đưa chúng về kho từ.
//   node scripts/6-apply-reports.mjs <reports.json> [--dry]
//
// Chỉ TỰ ĐỘNG được lỗi pinyin (ghi vào overrides.pinyin.json). Các loại khác cần
// sửa trên Sheet hoặc sửa seed — script in ra việc cần làm chứ không tự đoán.
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/', import.meta.url).pathname;
const file = process.argv[2];
const dry = process.argv.includes('--dry');
if (!file) {
  console.error('dùng: node scripts/6-apply-reports.mjs <reports.json> [--dry]');
  process.exit(2);
}

const reports = JSON.parse(await readFile(file, 'utf8')).filter(
  (r) => (r.status ?? 'new') === 'new'
);
const seed = JSON.parse(await readFile(OUT + 'seed.hsk1-4.json', 'utf8'));
const known = new Map(seed.map((w) => [w.hanzi, w]));
const overrides = JSON.parse(await readFile(OUT + 'overrides.pinyin.json', 'utf8'));

const applied = [];
const manual = [];
const rejected = [];

for (const r of reports) {
  const h = (r.hanzi ?? '').trim();
  const fix = (r.my_correction ?? '').trim();
  const why = (r.reason ?? '').trim();
  const tag = `${r.report_id ?? '?'} ${h}`;

  if (!known.has(h)) {
    rejected.push([tag, `"${h}" không có trong seed — kiểm lại khoá hanzi của báo lỗi`]);
    continue;
  }

  switch (r.field) {
    case 'grading':
      // Dữ liệu đúng, chỉ khâu chấm sai. Không sửa kho từ.
      applied.push([tag, 'app chấm sai — không đổi dữ liệu, card đã được pass tại chỗ']);
      break;

    case 'pinyin':
      if (!fix) {
        manual.push([tag, `báo pinyin sai mà không ghi "sửa thành" — cần hỏi lại. App đang để "${known.get(h).pinyin}"`]);
        break;
      }
      if (fix === known.get(h).pinyin) {
        const shown = (r.app_value ?? '').trim();
        if (shown && shown !== known.get(h).pinyin) {
          // Bạn báo đúng, seed cũng đúng — nhưng app lại hiện khác seed.
          // Lỗi nằm ở khâu Sheet/sync, không phải ở kho từ. Đây là loại lỗi
          // đã xảy ra thật khi bơm dữ liệu lên Sheet lần đầu (晚上 → 晥上).
          manual.push([
            tag,
            `LỖI SYNC: seed có "${known.get(h).pinyin}" đúng như bạn báo, nhưng app hiện "${shown}". Kiểm ô pinyin của ${h} trên tab words — kho từ không sai`,
          ]);
        } else {
          rejected.push([tag, `"${fix}" trùng với giá trị hiện tại — không có gì để sửa`]);
        }
        break;
      }
      overrides[h] = {
        pinyin: fix,
        why: `Báo lỗi ${r.report_id ?? ''} (${r.created_at ?? ''}): ${why || 'không ghi lý do'}. App từng để "${known.get(h).pinyin}".`,
      };
      applied.push([tag, `overrides.pinyin.json: "${known.get(h).pinyin}" → "${fix}"  — chạy lại npm run data:build`]);
      break;

    case 'hanzi':
      // Không tự sửa: seed là nguồn đã kiểm, lệch ở đây nghĩa là Sheet bị gõ sai.
      manual.push([tag, `sửa ô hanzi trên Sheet về "${h}" (seed có từ này). Nếu chính seed sai thì phải sửa nguồn, không sửa bằng override`]);
      break;

    case 'meaning_vi':
    case 'example':
      manual.push([tag, `sửa trực tiếp trên tab words, cột ${r.field}${fix ? ` → "${fix}"` : ''}`]);
      break;

    default:
      manual.push([tag, `field "${r.field}" không nhận ra — xử lý tay`]);
  }
}

if (!dry && applied.some(([, m]) => m.includes('overrides'))) {
  await writeFile(OUT + 'overrides.pinyin.json', JSON.stringify(overrides, null, 2) + '\n', 'utf8');
}

const show = (title, rows) => {
  console.log(`\n${title}: ${rows.length}`);
  for (const [tag, msg] of rows) console.log(`  ${tag.padEnd(14)} ${msg}`);
};
console.log(`Báo lỗi status=new: ${reports.length}${dry ? '  (DRY RUN, không ghi file)' : ''}`);
show('Đã áp dụng', applied);
show('Cần làm tay', manual);
show('Từ chối', rejected);

// Cột status/resolution_note để dán ngược lên tab _reports
console.log('\n--- dán ngược vào _reports (status, resolution_note) ---');
for (const [tag, msg] of applied) console.log(`applied\t${tag}\t${msg}`);
for (const [tag, msg] of manual) console.log(`new\t${tag}\tcần làm tay: ${msg}`);
for (const [tag, msg] of rejected) console.log(`rejected\t${tag}\t${msg}`);

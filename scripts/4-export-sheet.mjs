// Xuất CSV đúng thứ tự cột của Google Sheet.
//   node scripts/4-export-sheet.mjs          → cả HSK 1-4
//   node scripts/4-export-sheet.mjs 1 2      → chỉ HSK 1 và 2
import { readFile, writeFile } from 'node:fs/promises';

const OUT = new URL('../data/', import.meta.url).pathname;
const levels = process.argv.slice(2).map(Number).filter(Boolean);
const all = JSON.parse(await readFile(OUT + 'seed.hsk1-4.json', 'utf8'));
const rows = levels.length ? all.filter((w) => levels.includes(w.hsk_level)) : all;

// Cột trái = vùng bạn làm việc. Cột phải = dữ liệu tham chiếu, chỉ đọc.
const COLS = [
  'hanzi', 'pinyin', 'meaning_vi', 'hsk', 'lesson', 'pos',
  'example_zh', 'example_vi', 'note', 'verified', 'active',
  'traditional', 'radical', 'frequency', 'homophone_key', 'meanings_en', 'flags',
];

const cell = (v) => {
  const s = Array.isArray(v) ? v.join('; ') : v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

const lines = [COLS.join(',')];
for (const w of rows) {
  lines.push(
    [
      w.hanzi, w.pinyin, w.meaning_vi, w.hsk_level, '', w.pos,
      w.example_zh, w.example_vi, w.note,
      w.flags.includes('override') ? 'TRUE' : 'FALSE', // override = tôi đã soi tay
      'TRUE',
      w.traditional, w.radical, w.frequency, w.homophone_key,
      w.meanings_en, w.flags,
    ].map(cell).join(',')
  );
}

const name = levels.length ? `sheet-hsk${levels.join('')}.csv` : 'sheet-hsk1-4.csv';
await writeFile(OUT + name, lines.join('\n') + '\n', 'utf8');
console.log(`${rows.length} dòng → data/${name}`);
console.log(`Cột: ${COLS.join(' | ')}`);

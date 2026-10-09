// Tải dữ liệu nguồn về data/source/. Chạy lại được, idempotent.
import { mkdir, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const SRC = new URL('../data/source/', import.meta.url).pathname;

const FILES = [
  // Nguồn A — backbone: hanzi / traditional / hsk level / radical / pos / frequency / nghĩa EN
  ...[1, 2, 3, 4].map((n) => ({
    url: `https://raw.githubusercontent.com/drkameleon/complete-hsk-vocabulary/HEAD/wordlists/exclusive/old/${n}.json`,
    out: `kameleon-hsk${n}.json`,
  })),
  // Nguồn B — chỉ dùng để cross-check pinyin (cùng gốc CC-CEDICT, KHÔNG độc lập)
  {
    url: 'https://raw.githubusercontent.com/lxaw/hsk-infinite/HEAD/site/vocab.json',
    out: 'hskinfinite-vocab.json',
  },
];

await mkdir(SRC, { recursive: true });

for (const { url, out } of FILES) {
  const dest = join(SRC, out);
  try {
    const s = await stat(dest);
    if (s.size > 0) {
      console.log(`skip  ${out} (đã có, ${s.size} bytes)`);
      continue;
    }
  } catch {}
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  JSON.parse(buf.toString('utf8')); // fail sớm nếu không phải JSON hợp lệ
  await writeFile(dest, buf);
  console.log(`fetch ${out} (${buf.length} bytes)`);
}
console.log('\nXong. Nguồn nằm ở data/source/');

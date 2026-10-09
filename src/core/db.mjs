// Lớp dữ liệu: mở DB, nạp seed, và các truy vấn app dùng.
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.mjs';
import { stagesFor } from './stages.mjs';

export function openDb(file) {
  const db = new Database(file);
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS không thêm cột vào bảng đã tồn tại, nên DB cũ sẽ
 * thiếu cột mới. SQLite không có ADD COLUMN IF NOT EXISTS → phải tự kiểm.
 */
function migrate(db) {
  const have = new Set(db.prepare('PRAGMA table_info(words)').all().map((c) => c.name));
  const want = {
    example_pinyin: "TEXT NOT NULL DEFAULT ''",
    meaning_vi_alt: "TEXT NOT NULL DEFAULT ''",
    standard: "TEXT NOT NULL DEFAULT 'hsk3'",
    stages: `TEXT NOT NULL DEFAULT '["production"]'`,
    anchor: "TEXT NOT NULL DEFAULT 'production'",
  };
  for (const [col, decl] of Object.entries(want))
    if (!have.has(col)) db.exec(`ALTER TABLE words ADD COLUMN ${col} ${decl}`);

  const dq = new Set(db.prepare('PRAGMA table_info(daily_queue)').all().map((c) => c.name));
  if (!dq.has('stage_idx'))
    db.exec('ALTER TABLE daily_queue ADD COLUMN stage_idx INTEGER NOT NULL DEFAULT 0');
}

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string|null} [fallback]
 * @returns {string|null}
 */
export function getSetting(db, key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function setSetting(db, key, value) {
  db.prepare(
    'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(key, String(value));
}

/**
 * Nạp/cập nhật kho từ. KHÔNG đụng tới cards, nên lịch học được giữ nguyên
 * qua mỗi lần sync — trừ khi chính nội dung từ đổi (xem resetCardsForWords).
 */
export function upsertWords(db, rows) {
  const stmt = db.prepare(`
    INSERT INTO words (hanzi,pinyin,hanviet,meaning_vi,meaning_vi_alt,pos_vi,hsk_level,standard,
                       lesson,radical,example_zh,example_pinyin,example_vi,note,
                       homophone_key,frequency,active,quarantined,stages,anchor)
    VALUES (@hanzi,@pinyin,@hanviet,@meaning_vi,@meaning_vi_alt,@pos_vi,@hsk_level,@standard,
            @lesson,@radical,@example_zh,@example_pinyin,@example_vi,@note,
            @homophone_key,@frequency,@active,@quarantined,@stages,@anchor)
    ON CONFLICT(hanzi) DO UPDATE SET
      pinyin=excluded.pinyin, hanviet=excluded.hanviet, meaning_vi=excluded.meaning_vi,
      meaning_vi_alt=excluded.meaning_vi_alt, pos_vi=excluded.pos_vi,
      hsk_level=excluded.hsk_level, standard=excluded.standard, lesson=excluded.lesson,
      radical=excluded.radical, example_zh=excluded.example_zh,
      example_pinyin=excluded.example_pinyin, example_vi=excluded.example_vi,
      note=excluded.note, homophone_key=excluded.homophone_key, frequency=excluded.frequency,
      active=excluded.active, stages=excluded.stages, anchor=excluded.anchor,
      updated_at=datetime('now')
  `);
  const tx = db.transaction((list) => {
    for (const r of list)
      stmt.run({
        hanzi: r.hanzi,
        pinyin: r.pinyin,
        hanviet: r.hanviet ?? '',
        meaning_vi: r.meaning_vi ?? '',
        meaning_vi_alt: r.meaning_vi_alt ?? '',
        standard: r.standard ?? 'hsk3',
        example_pinyin: r.example_pinyin ?? '',
        // Cách ly chỉ áp lúc INSERT: sync lại không được tự bỏ hoặc tự bật lại
        // cách ly mà bạn đã xử lý bằng tay.
        quarantined: r.quarantined ? 1 : 0,
        // Cổng áp dụng cho từ này, tính một lần lúc nạp. anchor = cổng đầu tiên,
        // dùng làm card lên lịch FSRS cho cả từ.
        stages: JSON.stringify(stagesFor(r)),
        anchor: stagesFor(r)[0],
        pos_vi: r.pos_vi ?? '',
        hsk_level: r.hsk_level,
        lesson: r.lesson ?? '',
        radical: r.radical ?? '',
        example_zh: r.example_zh ?? '',
        example_vi: r.example_vi ?? '',
        note: r.note ?? '',
        homophone_key: r.homophone_key ?? '',
        frequency: r.frequency ?? null,
        active: r.active === false ? 0 : 1,
      });
  });
  tx(rows);
  return rows.length;
}

/**
 * Tạo card còn thiếu — MỘT card cho mỗi cổng của mỗi từ.
 * FSRS giữ lịch riêng cho từng cổng vì chúng kiểm những kỹ năng khác nhau.
 */
export function ensureCards(db, today = isoDate()) {
  const rows = db.prepare(
    `SELECT id, stages FROM words
     WHERE active = 1 AND quarantined = 0 AND meaning_vi <> ''`
  ).all();
  const ins = db.prepare(
    `INSERT OR IGNORE INTO cards (word_id, direction, due, state) VALUES (?,?,?,0)`
  );
  let n = 0;
  db.transaction(() => {
    for (const w of rows)
      for (const st of JSON.parse(w.stages)) n += ins.run(w.id, st, today).changes;
  })();
  return n;
}

/**
 * Dữ liệu của từ đã đổi (sửa lỗi) → lịch cũ được tích trên dữ liệu SAI,
 * nên card quay về trạng thái new thay vì giữ stability.
 */
export function resetCardsForWords(db, hanziList) {
  if (!hanziList.length) return 0;
  const q = hanziList.map(() => '?').join(',');
  return db
    .prepare(
      `UPDATE cards SET stability=0, difficulty=0, reps=0, lapses=0, state=0,
                        last_review=NULL, due=date('now','localtime')
       WHERE word_id IN (SELECT id FROM words WHERE hanzi IN (${q}))`
    )
    .run(...hanziList).changes;
}

export function isoDate(d = new Date()) {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

export function wordByHanzi(db, hanzi) {
  return db.prepare('SELECT * FROM words WHERE hanzi = ?').get(hanzi);
}

/** Các từ cùng âm (bỏ dấu) — dùng làm bẫy đồng âm và làm distractor. */
export function homophonesOf(db, wordId) {
  return db
    .prepare(
      `SELECT w2.* FROM words w1 JOIN words w2
         ON w2.homophone_key = w1.homophone_key AND w2.id <> w1.id
       WHERE w1.id = ? AND w2.active = 1 AND w2.quarantined = 0`
    )
    .all(wordId);
}

export function quarantineWord(db, wordId, on = true) {
  return db.prepare('UPDATE words SET quarantined = ? WHERE id = ?').run(on ? 1 : 0, wordId).changes;
}

export function stats(db) {
  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const total = one('SELECT COUNT(*) n FROM reviews').n;
  const homo = one("SELECT COUNT(*) n FROM reviews WHERE error_type='homophone_wrong_char'").n;
  return {
    reviews: total,
    homophoneErrors: homo,
    // Thước đo chính của app: tỷ lệ "pinyin đúng, hán tự sai".
    pinyinDependency: total ? homo / total : 0,
    words: one('SELECT COUNT(*) n FROM words').n,
    ready: one("SELECT COUNT(*) n FROM words WHERE active=1 AND quarantined=0 AND meaning_vi<>''").n,
    quarantined: one('SELECT COUNT(*) n FROM words WHERE quarantined=1').n,
  };
}

/**
 * Nguồn mồi nhử cho cổng đọc hiểu, xếp theo mức dễ lẫn giảm dần.
 *
 * Mồi ngẫu nhiên thì loại trừ là đoán ra; mồi cùng âm mới ép nhận mặt chữ.
 * NHƯNG chỉ lấy từ đồng âm mà bạn ĐÃ THUỘC — cùng lý do với bẫy đồng âm ở
 * hàng đợi: bày một loạt chữ lạ cùng âm ra trước mắt người mới học thì không
 * tạo ra sự phân biệt, nó tạo ra nhiễu.
 */
export function distractorPools(db, word, limit = 8) {
  const ready = `w.active=1 AND w.quarantined=0 AND w.meaning_vi<>'' AND w.id<>@id`;
  const q = (extra, params, join = '') =>
    db.prepare(
      `SELECT w.hanzi, w.meaning_vi, w.pinyin FROM words w ${join}
       WHERE ${ready} AND ${extra} LIMIT ${limit}`
    ).all({ id: word.id, ...params });

  const establishedHomophones = word.homophone_key
    ? q(
        'w.homophone_key=@k AND c.state=2 AND c.stability>=7',
        { k: word.homophone_key },
        'JOIN cards c ON c.word_id=w.id AND c.direction=w.anchor'
      )
    : [];

  return {
    homophones: establishedHomophones,
    sameRadical: word.radical
      ? q('w.radical=@r AND w.hsk_level<=@l', { r: word.radical, l: word.hsk_level })
      : [],
    sameLevel: q('w.hsk_level=@l ORDER BY RANDOM()', { l: word.hsk_level }),
  };
}

// Lớp dữ liệu: mở DB, nạp seed, và các truy vấn app dùng.
import Database from 'better-sqlite3';
import { SCHEMA } from './schema.mjs';

export function openDb(file) {
  const db = new Database(file);
  db.exec(SCHEMA);
  return db;
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
    INSERT INTO words (hanzi,pinyin,hanviet,meaning_vi,pos_vi,hsk_level,lesson,radical,
                       example_zh,example_vi,note,homophone_key,frequency,active)
    VALUES (@hanzi,@pinyin,@hanviet,@meaning_vi,@pos_vi,@hsk_level,@lesson,@radical,
            @example_zh,@example_vi,@note,@homophone_key,@frequency,@active)
    ON CONFLICT(hanzi) DO UPDATE SET
      pinyin=excluded.pinyin, hanviet=excluded.hanviet, meaning_vi=excluded.meaning_vi,
      pos_vi=excluded.pos_vi, hsk_level=excluded.hsk_level, lesson=excluded.lesson,
      radical=excluded.radical, example_zh=excluded.example_zh, example_vi=excluded.example_vi,
      note=excluded.note, homophone_key=excluded.homophone_key, frequency=excluded.frequency,
      active=excluded.active, updated_at=datetime('now')
  `);
  const tx = db.transaction((list) => {
    for (const r of list)
      stmt.run({
        hanzi: r.hanzi,
        pinyin: r.pinyin,
        hanviet: r.hanviet ?? '',
        meaning_vi: r.meaning_vi ?? '',
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

/** Tạo card còn thiếu cho mọi từ đã sẵn sàng học (có nghĩa tiếng Việt, không bị cách ly). */
export function ensureCards(db, direction = 'production', today = isoDate()) {
  return db
    .prepare(
      `INSERT INTO cards (word_id, direction, due, state)
       SELECT w.id, ?, ?, 0 FROM words w
       WHERE w.active = 1 AND w.quarantined = 0 AND w.meaning_vi <> ''
         AND NOT EXISTS (SELECT 1 FROM cards c WHERE c.word_id = w.id AND c.direction = ?)`
    )
    .run(direction, today, direction).changes;
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

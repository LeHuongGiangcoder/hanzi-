// Lên lịch bằng FSRS và dựng hàng đợi 20 từ mỗi ngày.
import { fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import { isoDate } from './db.mjs';

const f = fsrs(generatorParameters({ enable_fuzz: true }));

export const DEFAULT_MIX = { due: 12, fresh: 5, leech: 3, target: 20 };

function cardToFsrs(row) {
  return {
    due: new Date(row.due),
    stability: row.stability,
    difficulty: row.difficulty,
    elapsed_days: 0,
    scheduled_days: 0,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
    last_review: row.last_review ? new Date(row.last_review) : undefined,
  };
}

/** Ghi một lượt review và đẩy lịch của card đi tiếp. */
export function applyReview(db, cardRow, { grade, latencyMs, answerRaw, errorType, sessionId }, now = new Date()) {
  const next = f.repeat(cardToFsrs(cardRow), now)[grade].card;
  db.prepare(
    `UPDATE cards SET stability=?, difficulty=?, due=?, reps=?, lapses=?, state=?, last_review=?
     WHERE id=?`
  ).run(
    next.stability, next.difficulty, isoDate(next.due),
    next.reps, next.lapses, next.state, now.toISOString(), cardRow.id
  );
  db.prepare(
    `INSERT INTO reviews (card_id, session_id, grade, latency_ms, answer_raw, error_type)
     VALUES (?,?,?,?,?,?)`
  ).run(cardRow.id, sessionId ?? null, grade, latencyMs | 0, answerRaw ?? '', errorType ?? 'none');
  return next;
}

/**
 * Chọn 20 từ cho hôm nay.
 *
 * Trộn: từ đến hạn > từ hay sai > từ mới. Sau đó CỐ Ý kéo thêm các từ cùng âm
 * của những từ đã chọn vào — đó là bẫy đồng âm: nếu chỉ nhớ âm thì sẽ trượt.
 */
export function buildQueue(db, { date = isoDate(), mix = DEFAULT_MIX } = {}) {
  const pick = (sql, n, ...args) => (n > 0 ? db.prepare(sql).all(...args, n) : []);
  const READY = `w.active=1 AND w.quarantined=0 AND w.meaning_vi<>''`;

  // Lên lịch theo CỔNG NEO (cổng đầu tiên của từ), không cố định 'production':
  // trợ từ không có cổng production.
  const due = pick(
    `SELECT w.*, c.id card_id FROM cards c JOIN words w ON w.id=c.word_id AND c.direction=w.anchor
     WHERE c.due<=? AND c.state<>0 AND ${READY}
     ORDER BY c.due ASC, w.frequency IS NULL, w.frequency ASC LIMIT ?`,
    mix.due, date
  );

  // "Leech" = từ hay mắc đúng lỗi phụ thuộc pinyin. Ưu tiên bất kể lịch.
  const leech = pick(
    `SELECT w.*, MIN(c.id) card_id, COUNT(r.id) bad
     FROM cards c JOIN words w ON w.id=c.word_id
     JOIN reviews r ON r.card_id=c.id AND r.error_type='homophone_wrong_char'
     WHERE ${READY}
     GROUP BY w.id HAVING bad>0 ORDER BY bad DESC LIMIT ?`,
    mix.leech
  );

  const taken = new Set([...due, ...leech].map((r) => r.id));
  const fresh = pick(
    `SELECT w.*, c.id card_id FROM cards c JOIN words w ON w.id=c.word_id AND c.direction=w.anchor
     WHERE c.state=0 AND ${READY}
     ORDER BY w.hsk_level ASC, w.lesson ASC, w.frequency IS NULL, w.frequency ASC LIMIT ?`,
    mix.fresh + taken.size
  );

  const out = [];
  const add = (row, reason) => {
    if (out.length >= mix.target || taken2.has(row.id)) return false;
    taken2.add(row.id);
    out.push({ ...row, reason });
    return true;
  };
  const taken2 = new Set();
  for (const r of due) add(r, 'due');
  for (const r of leech) add(r, 'leech');
  for (const r of fresh) add(r, 'new');

  // Bẫy đồng âm: kéo anh em cùng âm vào, chiếm chỗ của từ mới.
  const siblings = db.prepare(
    `SELECT w.*, c.id card_id FROM words w JOIN cards c ON c.word_id=w.id AND c.direction=w.anchor
     WHERE w.homophone_key=? AND w.id<>? AND ${READY}`
  );
  for (const seed of [...out]) {
    if (out.length >= mix.target) break;
    if (!seed.homophone_key) continue;
    for (const s of siblings.all(seed.homophone_key, seed.id)) {
      if (!add(s, 'homophone_sibling')) break;
    }
  }

  // Còn thiếu thì bù thêm từ mới cho đủ chỉ tiêu.
  if (out.length < mix.target) {
    for (const r of pick(
      `SELECT w.*, c.id card_id FROM cards c JOIN words w ON w.id=c.word_id AND c.direction=w.anchor
       WHERE ${READY} ORDER BY c.due ASC LIMIT ?`,
      mix.target * 3
    )) {
      if (!add(r, 'replacement')) continue;
      if (out.length >= mix.target) break;
    }
  }
  return out;
}

/** Mở (hoặc lấy lại) phiên học của hôm nay. */
export function startSession(db, { date = isoDate(), mix = DEFAULT_MIX } = {}) {
  const existing = db.prepare('SELECT * FROM sessions WHERE date=?').get(date);
  if (existing) {
    const items = db.prepare(
      `SELECT w.*, c.id card_id, q.reason, q.passed_at FROM daily_queue q
       JOIN words w ON w.id=q.word_id JOIN cards c ON c.word_id=w.id AND c.direction=w.anchor
       WHERE q.session_id=? ORDER BY q.position`
    ).all(existing.id);
    return { session: existing, items, resumed: true };
  }

  const picked = buildQueue(db, { date, mix });
  const info = db.prepare('INSERT INTO sessions (date,target_count) VALUES (?,?)').run(date, picked.length);
  const sid = info.lastInsertRowid;
  const ins = db.prepare('INSERT INTO daily_queue (session_id,word_id,position,reason) VALUES (?,?,?,?)');
  db.transaction(() => picked.forEach((w, i) => ins.run(sid, w.id, i, w.reason)))();
  return { session: db.prepare('SELECT * FROM sessions WHERE id=?').get(sid), items: picked, resumed: false };
}

/** Đánh dấu một từ đã pass trong phiên. */
export function markPassed(db, sessionId, wordId) {
  db.prepare(`UPDATE daily_queue SET passed_at=datetime('now') WHERE session_id=? AND word_id=? AND passed_at IS NULL`)
    .run(sessionId, wordId);
  const n = db.prepare('SELECT COUNT(*) n FROM daily_queue WHERE session_id=? AND passed_at IS NOT NULL').get(sessionId).n;
  const t = db.prepare('SELECT target_count FROM sessions WHERE id=?').get(sessionId).target_count;
  db.prepare('UPDATE sessions SET passed_count=? WHERE id=?').run(n, sessionId);
  if (n >= t) db.prepare(`UPDATE sessions SET finished_at=datetime('now') WHERE id=? AND finished_at IS NULL`).run(sessionId);
  return { passed: n, target: t, done: n >= t };
}

/**
 * Thay một từ bị cách ly giữa phiên bằng từ khác, để chỉ tiêu 20 không đổi.
 * Báo lỗi dữ liệu không được làm bạn mất chỉ tiêu của ngày hôm đó.
 */
export function replaceInQueue(db, sessionId, wordId) {
  const row = db.prepare('SELECT position FROM daily_queue WHERE session_id=? AND word_id=?').get(sessionId, wordId);
  if (!row) return null;
  const repl = db.prepare(
    `SELECT w.*, c.id card_id FROM cards c JOIN words w ON w.id=c.word_id AND c.direction=w.anchor
     WHERE w.active=1 AND w.quarantined=0 AND w.meaning_vi<>''
       AND w.id NOT IN (SELECT word_id FROM daily_queue WHERE session_id=?)
     ORDER BY c.due ASC LIMIT 1`
  ).get(sessionId);
  db.prepare('DELETE FROM daily_queue WHERE session_id=? AND word_id=?').run(sessionId, wordId);
  if (!repl) {
    db.prepare('UPDATE sessions SET target_count=target_count-1 WHERE id=?').run(sessionId);
    return null;
  }
  db.prepare('INSERT INTO daily_queue (session_id,word_id,position,reason) VALUES (?,?,?,?)')
    .run(sessionId, repl.id, row.position, 'replacement');
  return repl;
}

export { Rating, State };

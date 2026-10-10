// Lên lịch bằng FSRS và dựng hàng đợi 20 từ mỗi ngày.
import { fsrs, generatorParameters, Rating, State } from 'ts-fsrs';
import { isoDate } from './db.mjs';
import { SessionRunner } from './session-runner.mjs';

const f = fsrs(generatorParameters({ enable_fuzz: true }));

export const DEFAULT_TARGET = 20;

// Tỷ lệ trộn, giữ nguyên khi đổi chỉ tiêu: 60% từ đến hạn ôn, 15% từ hay sai,
// phần còn lại là từ mới. Ôn phải nhiều hơn học mới, nếu không thì mỗi ngày
// nạp thêm một đống từ rồi quên sạch đống hôm trước.
const RATIO = { due: 0.6, leech: 0.15 };

/** Dựng bộ trộn cho một chỉ tiêu bất kỳ. 20 → 12/5/3 như trước. */
export function mixForTarget(target = DEFAULT_TARGET, maxConfusableGroups = 2) {
  const t = Math.max(1, Math.round(target));
  const due = Math.round(t * RATIO.due);
  const leech = Math.round(t * RATIO.leech);
  return { target: t, due, leech, fresh: Math.max(0, t - due - leech), maxConfusableGroups };
}

export const DEFAULT_MIX = mixForTarget(DEFAULT_TARGET);

// Một từ được coi là ĐÃ THUỘC — đủ vững để đem ra đối chiếu với từ đồng âm.
//
// Ngưỡng cũ (rời trạng thái "mới" + ôn 2 lần) quá lỏng: trả lời đúng vài lần
// trong CÙNG MỘT BUỔI là đạt, dù stability mới 0.1 ngày. Thực tế đã cho ra một
// phiên ghép 是 với 时 khi cả hai còn chưa qua nổi một đêm.
//
// Ngưỡng hiện tại: card phải tốt nghiệp sang trạng thái ôn tập (state = 2) VÀ
// giữ được ít nhất một tuần — tức đã sống qua những khoảng nghỉ thật, không
// phải trí nhớ tức thời trong buổi học.
const MIN_STABILITY_DAYS = 7;
const STATE_REVIEW = 2;
const ESTABLISHED_SQL = `c.state = ${STATE_REVIEW} AND c.stability >= ${MIN_STABILITY_DAYS}`;

export function isEstablished(row) {
  return (row?.card_state ?? 0) === STATE_REVIEW && (row?.card_stability ?? 0) >= MIN_STABILITY_DAYS;
}

const maxConfusable = (mix) => mix.maxConfusableGroups ?? 2;

/**
 * Có được xếp `row` vào cùng phiên với các từ đồng âm đã có không?
 *
 * Bẫy đồng âm chỉ có tác dụng khi bạn ĐÃ THUỘC từng từ rồi mới đem ra đối chiếu.
 * Đặt hai từ cùng âm cạnh nhau lúc cả hai còn mới thì không tạo ra sự phân biệt,
 * nó tạo ra nhiễu — đo thực tế từng cho ra một phiên có 10 từ cùng đọc "shi"
 * (是 事 十 试 市 时 使 室 湿 诗), tất cả đều chưa học bao giờ.
 *
 * Luật: hai từ cùng âm chỉ được gặp nhau khi CẢ HAI đã thuộc, và mỗi phiên chỉ
 * cho tối đa `maxConfusableGroups` cặp như vậy — nó là gia vị, không phải món chính.
 */
export function canPair(row, siblingsInSession, confusableGroups, mix = DEFAULT_MIX) {
  if (!row.homophone_key) return true;
  const sibs = siblingsInSession ?? [];
  if (!sibs.length) return true;
  if (sibs.length >= 2) return false;                       // tối đa 2 từ mỗi nhóm
  if (confusableGroups >= maxConfusable(mix)) return false;
  return isEstablished(row) && sibs.every(isEstablished);
}

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
  const ANCHOR = 'c.direction=w.anchor';
  const COLS = 'w.*, c.id card_id, c.state card_state, c.reps card_reps, c.stability card_stability';

  const due = pick(
    `SELECT ${COLS} FROM cards c JOIN words w ON w.id=c.word_id AND ${ANCHOR}
     WHERE c.due<=? AND c.state<>0 AND ${READY}
     ORDER BY c.due ASC, w.frequency IS NULL, w.frequency ASC LIMIT ?`,
    mix.due, date
  );

  // "Leech" = từ hay mắc đúng lỗi phụ thuộc pinyin. Ưu tiên bất kể lịch.
  const leech = pick(
    `SELECT ${COLS}, COUNT(r.id) bad
     FROM cards c JOIN words w ON w.id=c.word_id AND ${ANCHOR}
     JOIN reviews r ON r.card_id=c.id AND r.error_type='homophone_wrong_char'
     WHERE ${READY}
     GROUP BY w.id HAVING bad>0 ORDER BY bad DESC LIMIT ?`,
    mix.leech
  );

  const fresh = pick(
    `SELECT ${COLS} FROM cards c JOIN words w ON w.id=c.word_id AND ${ANCHOR}
     WHERE c.state=0 AND ${READY}
     ORDER BY w.hsk_level ASC, w.lesson ASC, w.frequency IS NULL, w.frequency ASC LIMIT ?`,
    mix.target * 4
  );

  const out = [];
  const taken = new Set();
  const byKey = new Map();          // homophone_key → các từ đã xếp vào phiên
  let confusableGroups = 0;

  const add = (row, reason) => {
    if (out.length >= mix.target || taken.has(row.id)) return false;
    if (!canPair(row, byKey.get(row.homophone_key), confusableGroups, mix)) return false;
    const siblings = byKey.get(row.homophone_key);
    if (row.homophone_key && siblings?.length === 1) confusableGroups++;
    taken.add(row.id);
    out.push({ ...row, reason });
    if (row.homophone_key) byKey.set(row.homophone_key, [...(siblings ?? []), row]);
    return true;
  };

  for (const r of due) add(r, 'due');
  for (const r of leech) add(r, 'leech');
  for (const r of fresh) add(r, 'new');

  // Bẫy đồng âm — CHỈ giữa những từ đã thuộc.
  if (confusableGroups < maxConfusable(mix)) {
    const siblings = db.prepare(
      `SELECT ${COLS} FROM words w JOIN cards c ON c.word_id=w.id AND ${ANCHOR}
       WHERE w.homophone_key=? AND w.id<>? AND ${READY} AND ${ESTABLISHED_SQL}
       ORDER BY c.due ASC`
    );
    for (const seed of [...out]) {
      if (out.length >= mix.target || confusableGroups >= maxConfusable(mix)) break;
      if (!seed.homophone_key || !isEstablished(seed)) continue;
      for (const s of siblings.all(seed.homophone_key, seed.id)) {
        if (add(s, 'homophone_sibling')) break;   // mỗi lần chỉ thêm MỘT từ đối chiếu
      }
    }
  }

  // Còn thiếu thì bù thêm, vẫn tôn trọng luật trên.
  //
  // Thứ tự phải theo CẤP trước, không phải theo ngày đến hạn. Với kho từ mới
  // thì mọi card đều đến hạn cùng ngày, nên sắp theo c.due là sắp theo thứ tự
  // ngẫu nhiên của rowid — đường này có thể lôi từ HSK 4 vào trong khi HSK 1
  // còn chưa học xong.
  if (out.length < mix.target) {
    for (const r of pick(
      `SELECT ${COLS} FROM cards c JOIN words w ON w.id=c.word_id AND ${ANCHOR}
       WHERE ${READY}
       ORDER BY c.due ASC, w.hsk_level ASC, w.frequency IS NULL, w.frequency ASC LIMIT ?`,
      mix.target * 6
    )) {
      add(r, 'replacement');
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
      `SELECT w.*, c.id card_id, q.reason, q.passed_at, q.stage_idx FROM daily_queue q
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

/**
 * Mở phiên hôm nay và dựng lại đúng trạng thái đang dở.
 *
 * Đóng app giữa chừng không được làm mất gì: từ đã pass thì cho qua hết cổng,
 * từ đang dở thì nhảy tới đúng cổng đã lưu trong daily_queue.stage_idx.
 */
export function resumeSession(db, opts = {}) {
  const r = startSession(db, opts);
  const items = r.items.map((it) => ({ ...it, stages: JSON.parse(it.stages) }));
  const runner = new SessionRunner(items);
  for (const it of items) {
    if (it.passed_at) { for (const _ of it.stages) runner.answer(it.id, true); continue; }
    const st = runner.state.get(it.id);
    if (st && it.stage_idx > 0) st.stageIdx = Math.min(it.stage_idx, st.stages.length - 1);
  }
  return { ...r, items, runner };
}

/**
 * Ghi lại đang ở cổng thứ mấy.
 * Không có cái này thì đóng app giữa chừng sẽ mất phần cổng đã qua của từ đang dở.
 */
export function saveStageIdx(db, sessionId, wordId, stageIdx) {
  return db.prepare('UPDATE daily_queue SET stage_idx=? WHERE session_id=? AND word_id=?')
    .run(stageIdx, sessionId, wordId).changes;
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

// Thống kê tiến độ so với mục tiêu HSK 4.
//
// Mốc "đã thuộc" = khoảng ôn đạt 21 ngày. Đây là ngưỡng quen thuộc trong SRS
// (Anki gọi là "mature"): tới đó thì từ đã nằm ở trí nhớ dài hạn chứ không còn
// là thứ vừa nhồi xong. Lấy theo card YẾU NHẤT của từ — gõ ra được chữ bao giờ
// cũng chậm hơn đọc hiểu nó, và từ chỉ thật sự thuộc khi cả ba cổng đều vững.

export const MATURE_DAYS = 21;

export function progressStats(db, { matureDays = MATURE_DAYS } = {}) {
  const rows = db.prepare(`
    SELECT w.hsk_level lvl,
           SUM(CASE WHEN c.state = 0 THEN 1 ELSE 0 END) new_cards,
           COUNT(c.id) total_cards,
           MIN(c.stability) min_stab
    FROM words w JOIN cards c ON c.word_id = w.id
    WHERE w.active = 1 AND w.quarantined = 0 AND w.meaning_vi <> ''
    GROUP BY w.id
  `).all();

  const blank = () => ({ mature: 0, learning: 0, fresh: 0, total: 0 });
  const byLevel = { 1: blank(), 2: blank(), 3: blank(), 4: blank() };
  const all = blank();

  for (const r of rows) {
    const bucket =
      r.new_cards === r.total_cards ? 'fresh'
      : r.min_stab >= matureDays ? 'mature'
      : 'learning';
    const lv = byLevel[r.lvl] ?? (byLevel[r.lvl] = blank());
    lv[bucket]++; lv.total++;
    all[bucket]++; all.total++;
  }

  const one = (sql, ...a) => db.prepare(sql).get(...a);
  const reviews = one('SELECT COUNT(*) n FROM reviews').n;
  const homo = one("SELECT COUNT(*) n FROM reviews WHERE error_type='homophone_wrong_char'").n;
  const recent = one(`
    SELECT COUNT(*) n, SUM(error_type='homophone_wrong_char') h
    FROM reviews WHERE ts >= datetime('now','-7 day')`);

  return {
    all,
    byLevel,
    // Thước đo chính của app: tỷ lệ "pinyin đúng, hán tự sai".
    pinyinDependency: reviews ? homo / reviews : null,
    pinyinDependency7d: recent.n ? (recent.h ?? 0) / recent.n : null,
    reviews,
    streak: streakDays(db),
    pace: pacePerDay(db),
    matureDays,
  };
}

/** Số ngày liên tiếp hoàn thành chỉ tiêu, tính lùi từ hôm nay (hoặc hôm qua). */
export function streakDays(db) {
  const done = new Set(
    db.prepare("SELECT date FROM sessions WHERE finished_at IS NOT NULL").all().map((r) => r.date)
  );
  const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const today = new Date();
  // Chưa học hôm nay thì chuỗi vẫn còn nếu hôm qua đã xong — ngày hôm nay chưa kết thúc.
  let cur = new Date(today);
  if (!done.has(iso(cur))) cur.setDate(cur.getDate() - 1);
  let n = 0;
  while (done.has(iso(cur))) { n++; cur.setDate(cur.getDate() - 1); }
  return n;
}

// Dưới ngần này ngày học thì nhịp chưa có nghĩa: một buổi học gấp đôi là đủ
// thổi phồng con số. Thà hiện "chưa đủ dữ liệu" còn hơn đưa ra một dự báo sai.
export const MIN_DAYS_FOR_PACE = 3;

/** Số từ mới bắt đầu học mỗi ngày, lấy trung bình 14 ngày gần nhất. */
export function pacePerDay(db, days = 14) {
  const r = db.prepare(`
    SELECT COUNT(*) n FROM (
      SELECT c.word_id FROM reviews r JOIN cards c ON c.id = r.card_id
      GROUP BY c.word_id
      HAVING MIN(r.ts) >= datetime('now', ?)
    )`).get(`-${days} day`);
  const activeDays = db.prepare(`
    SELECT COUNT(DISTINCT date(ts)) n FROM reviews WHERE ts >= datetime('now', ?)`
  ).get(`-${days} day`).n;
  if (activeDays < MIN_DAYS_FOR_PACE) return null;
  return r.n / activeDays;
}

/** Ước lượng thô: còn bao nhiêu ngày nữa tới mục tiêu, theo nhịp hiện tại. */
export function daysToGoal(stats) {
  const remaining = stats.all.total - stats.all.mature;
  if (!stats.pace || stats.pace <= 0) return null;
  return Math.ceil(remaining / stats.pace);
}

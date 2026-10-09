import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as OpenCC from 'opencc-js';
const t2s = OpenCC.Converter({ from: 't', to: 'cn' });
import { gradeAnswer, normalizeAnswer } from '../src/core/grading.mjs';
import { pickHint, buildComparison } from '../src/core/hints.mjs';
import { SessionRunner } from '../src/core/session-runner.mjs';
import { openDb, upsertWords, ensureCards, homophonesOf, stats, quarantineWord, resetCardsForWords } from '../src/core/db.mjs';
import { buildQueue, startSession, applyReview, markPassed, replaceInQueue } from '../src/core/scheduler.mjs';

const seed = JSON.parse(readFileSync(new URL('../data/seed.hsk1-4.json', import.meta.url), 'utf8'));
const freshDb = () => {
  const db = openDb(':memory:');
  upsertWords(db, seed);
  ensureCards(db);
  return db;
};

// ---------- chấm bài ----------
test('gõ đúng thì pass', () => {
  const r = gradeAnswer('买', '买', 1200);
  assert.equal(r.correct, true);
  assert.equal(r.errorType, 'none');
  assert.equal(r.grade, 3);
});

test('đúng nhưng chậm → vẫn pass, nhưng hạ xuống Hard', () => {
  const r = gradeAnswer('买', '买', 12000);
  assert.equal(r.correct, true);
  assert.equal(r.shaky, true);
  assert.equal(r.grade, 2);
});

test('LỖI CỐT LÕI: gõ nhầm sang chữ đồng âm được đếm riêng', () => {
  const r = gradeAnswer('卖', '买', 1000);   // mài vs mǎi
  assert.equal(r.correct, false);
  assert.equal(r.errorType, 'homophone_wrong_char');
  assert.equal(r.sameSound, true);
});

test('cặp 在/再 cũng bị bắt là lỗi đồng âm', () => {
  assert.equal(gradeAnswer('再', '在').errorType, 'homophone_wrong_char');
  assert.equal(gradeAnswer('做', '坐').errorType, 'homophone_wrong_char');
  assert.equal(gradeAnswer('晴', '请').errorType, 'homophone_wrong_char');
});

test('sai hẳn chữ thì KHÔNG bị tính là lỗi đồng âm', () => {
  const r = gradeAnswer('狗', '买');
  assert.equal(r.errorType, 'wrong_char');
  assert.equal(r.sameSound, false);
});

test('chưa bật IME (gõ ra chữ Latin) tách riêng, không tính là sai kiến thức', () => {
  const r = gradeAnswer('mai', '买');
  assert.equal(r.errorType, 'ime_off');
  assert.equal(r.imeOff, true);
});

test('bỏ trống', () => assert.equal(gradeAnswer('   ', '买').errorType, 'blank'));

test('chuẩn hoá: khoảng trắng toàn rộng và NFD đều không làm sai đáp án', () => {
  assert.equal(normalizeAnswer(' 买　'), '买');
  assert.equal(gradeAnswer('学　习'.normalize('NFD'), '学习').correct, true);
});

// ---------- gợi ý ----------
test('gợi ý ưu tiên Hán-Việt khi nhóm đồng âm phân biệt được', () => {
  const db = freshDb();
  const mai = db.prepare('SELECT * FROM words WHERE hanzi=?').get('买');
  const h = pickHint(mai, homophonesOf(db, mai.id));
  assert.equal(h.kind, 'hanviet');
  assert.equal(h.value, 'mãi');
});

test('nhóm 他/她/它 Hán-Việt trùng → rơi về bộ thủ', () => {
  const db = freshDb();
  const ta = db.prepare('SELECT * FROM words WHERE hanzi=?').get('他');
  const sibs = homophonesOf(db, ta.id).filter((w) => ['她', '它'].includes(w.hanzi));
  const h = pickHint(ta, sibs);
  assert.equal(h.kind, 'radical');
  assert.equal(h.value, '亻');
});

test('màn hình đối chiếu nói rõ hai chữ khác nhau ở đâu', () => {
  const db = freshDb();
  const g = (h) => db.prepare('SELECT * FROM words WHERE hanzi=?').get(h);
  assert.equal(buildComparison(g('买'), g('卖')).differsBy, 'hanviet');
  assert.equal(buildComparison(g('他'), g('她')).differsBy, 'radical');
});

// ---------- luật pass-20 ----------
const items = (n) => Array.from({ length: n }, (_, i) => ({ id: i + 1, hanzi: `w${i + 1}` }));

test('trả lời đúng ngay thì pass luôn', () => {
  const r = new SessionRunner(items(3));
  assert.equal(r.answer(1, true).justPassed, true);
  assert.equal(r.passedCount, 1);
});

test('sai thì phải đúng thêm 2 lần nữa mới pass', () => {
  const r = new SessionRunner(items(8));
  r.answer(1, false);
  assert.equal(r.state.get(1).needed, 2);
  r.answer(1, true);
  assert.equal(r.state.get(1).passed, false, 'một lần đúng chưa đủ sau khi sai');
  r.answer(1, true);
  assert.equal(r.state.get(1).passed, true);
});

test('từ vừa sai không được hỏi lại ngay: phải có ít nhất 3 từ khác chen vào', () => {
  const r = new SessionRunner(items(8));
  r.answer(1, false);
  const seen = [];
  for (let i = 0; i < 3; i++) { const w = r.next(); seen.push(w.id); r.answer(w.id, true); }
  assert.ok(!seen.includes(1), `từ vừa sai bị hỏi lại quá sớm: ${seen}`);
});

test('hết giãn cách thì từ đã sai được ưu tiên quay lại, không bị đẩy xuống cuối', () => {
  const r = new SessionRunner(items(8));
  r.answer(1, false);
  for (let i = 0; i < 3; i++) { const w = r.next(); r.answer(w.id, true); }
  assert.equal(r.next().id, 1, 'phải gặp lại ngay khi vừa đủ giãn cách');
});

test('nhiều từ sai cùng lúc vẫn được quay vòng, không từ nào bị bỏ quên', () => {
  const r = new SessionRunner(items(10));
  r.answer(1, false); r.answer(2, false); r.answer(3, false);
  for (let i = 0; i < 300 && !r.done; i++) { const w = r.next(); r.answer(w.id, true); }
  assert.equal(r.done, true, 'phiên phải kết thúc được');
  assert.equal(r.passedCount, 10);
});

test('phiên chỉ xong khi TẤT CẢ từ đã pass', () => {
  const r = new SessionRunner(items(5));
  for (let i = 1; i <= 4; i++) r.answer(i, true);
  assert.equal(r.done, false);
  r.answer(5, true);
  assert.equal(r.done, true);
});

test('phiên không bao giờ tự kết thúc khi còn từ chưa pass, dù trả lời bao nhiêu lượt', () => {
  const r = new SessionRunner(items(4));
  for (let i = 0; i < 200 && !r.done; i++) {
    const w = r.next();
    assert.ok(w, 'luôn phải có từ tiếp theo khi chưa xong');
    r.answer(w.id, w.id !== 3);   // từ số 3 luôn trả lời sai
  }
  assert.equal(r.done, false, 'một từ luôn sai thì phiên phải còn mở');
  assert.equal(r.passedCount, 3);
});

test('báo lỗi dữ liệu: rút từ ra và bù từ khác, chỉ tiêu không đổi', () => {
  const r = new SessionRunner(items(5));
  const before = r.total;
  r.removeAndReplace(2, { id: 99, hanzi: 'w99' });
  assert.equal(r.total, before, 'tổng chỉ tiêu phải giữ nguyên');
  assert.ok(r.queue.includes(99));
  assert.ok(!r.queue.includes(2));
});

// ---------- lịch + hàng đợi ----------
test('kho từ nạp đủ và sẵn sàng học', () => {
  const db = freshDb();
  const s = stats(db);
  assert.equal(s.words, seed.length);
  // Các từ đáng ngờ phát hiện lúc merge phải vào DB ở trạng thái đã cách ly.
  assert.ok(s.quarantined > 0, 'phải có từ bị cách ly sẵn từ seed');
  assert.equal(s.ready, s.words - s.quarantined);
});

test('từ đáng ngờ không lọt vào hàng đợi ngay từ đầu', () => {
  const db = freshDb();
  const bad = db.prepare('SELECT hanzi FROM words WHERE quarantined=1').all().map((r) => r.hanzi);
  assert.ok(bad.length);
  for (let i = 0; i < 5; i++)
    assert.ok(buildQueue(db).every((w) => !bad.includes(w.hanzi)));
});

test('câu ví dụ đã quy về giản thể, không còn phồn thể', () => {
  const db = freshDb();
  const rows = db.prepare("SELECT hanzi, example_zh FROM words WHERE example_zh <> ''").all();
  assert.ok(rows.length > 3000, 'phải có đủ câu ví dụ để kiểm');
  // Dùng chính bộ chuyển đổi để kiểm: nếu câu đã là giản thể thì chuyển đổi
  // không đổi gì. Liệt kê tay vài chữ phồn thể là không đủ chặt.
  const bad = rows.filter((r) => t2s(r.example_zh) !== r.example_zh);
  assert.equal(bad.length, 0, 'còn phồn thể: ' + bad.slice(0, 3).map((r) => r.example_zh).join(' | '));
});

test('hàng đợi ngày đúng 20 từ, không trùng', () => {
  const db = freshDb();
  const q = buildQueue(db);
  assert.equal(q.length, 20);
  assert.equal(new Set(q.map((w) => w.id)).size, 20);
});

test('hàng đợi có kéo từ đồng âm vào làm bẫy', () => {
  const db = freshDb();
  const q = buildQueue(db);
  const keys = q.filter((w) => w.homophone_key).map((w) => w.homophone_key);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.ok(dup.length > 0, 'phải có ít nhất một cặp cùng âm trong phiên');
});

test('từ bị cách ly không bao giờ lọt vào hàng đợi', () => {
  const db = freshDb();
  const ids = buildQueue(db).map((w) => w.id);
  ids.forEach((id) => quarantineWord(db, id, true));
  assert.ok(buildQueue(db).every((w) => !ids.includes(w.id)));
});

test('mở lại phiên trong ngày thì lấy lại đúng hàng đợi cũ, không dựng mới', () => {
  const db = freshDb();
  const a = startSession(db);
  const b = startSession(db);
  assert.equal(b.resumed, true);
  assert.deepEqual(a.items.map((w) => w.id).sort(), b.items.map((w) => w.id).sort());
});

test('ghi review thì lịch card tiến lên và lỗi được lưu đúng loại', () => {
  const db = freshDb();
  const { session, items } = startSession(db);
  const w = items[0];
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(w.card_id);
  applyReview(db, card, { grade: 1, latencyMs: 2000, answerRaw: '卖', errorType: 'homophone_wrong_char', sessionId: session.id });
  const after = db.prepare('SELECT * FROM cards WHERE id=?').get(w.card_id);
  assert.equal(after.reps, 1);
  assert.notEqual(after.state, 0);
  assert.equal(stats(db).homophoneErrors, 1);
  assert.ok(stats(db).pinyinDependency > 0);
});

test('đếm pass và đóng phiên khi đủ chỉ tiêu', () => {
  const db = freshDb();
  const { session, items } = startSession(db);
  let last;
  for (const w of items) last = markPassed(db, session.id, w.id);
  assert.equal(last.done, true);
  assert.ok(db.prepare('SELECT finished_at FROM sessions WHERE id=?').get(session.id).finished_at);
});

test('thay từ bị cách ly giữa phiên: vẫn đủ 20 từ', () => {
  const db = freshDb();
  const { session, items } = startSession(db);
  const victim = items[0];
  quarantineWord(db, victim.id, true);
  const repl = replaceInQueue(db, session.id, victim.id);
  assert.ok(repl, 'phải tìm được từ thay thế');
  const n = db.prepare('SELECT COUNT(*) n FROM daily_queue WHERE session_id=?').get(session.id).n;
  assert.equal(n, 20);
  assert.notEqual(repl.id, victim.id);
});

test('sửa lỗi xong thì card reset về new, không giữ lịch đã nhiễm', () => {
  const db = freshDb();
  const { session, items } = startSession(db);
  const w = items[0];
  const card = db.prepare('SELECT * FROM cards WHERE id=?').get(w.card_id);
  applyReview(db, card, { grade: 3, latencyMs: 900, answerRaw: w.hanzi, errorType: 'none', sessionId: session.id });
  assert.notEqual(db.prepare('SELECT state FROM cards WHERE id=?').get(w.card_id).state, 0);
  resetCardsForWords(db, [w.hanzi]);
  const after = db.prepare('SELECT * FROM cards WHERE id=?').get(w.card_id);
  assert.equal(after.state, 0);
  assert.equal(after.stability, 0);
  assert.equal(after.reps, 0);
});

// ---------- ba cổng ----------
import { stagesFor, isFunctionWord, hasCloze, buildCloze, buildChoices } from '../src/core/stages.mjs';

test('từ thường đi đủ ba cổng, production trước', () => {
  const w = { hanzi: '买', meaning_vi: 'mua', pos_vi: 'động từ', example_zh: '我买了一本书' };
  assert.deepEqual(stagesFor(w), ['production', 'reading', 'cloze']);
});

test('từ không có câu ví dụ thì chỉ hai cổng', () => {
  assert.deepEqual(stagesFor({ hanzi: '踢', meaning_vi: 'đá', pos_vi: 'động từ', example_zh: '' }),
                   ['production', 'reading']);
});

test('TRỢ TỪ bỏ cổng production, vào thẳng cloze', () => {
  const ba = { hanzi: '吧', meaning_vi: 'trợ từ đề nghị', pos_vi: 'trợ từ', example_zh: '我们走吧' };
  assert.equal(isFunctionWord(ba), true);
  assert.deepEqual(stagesFor(ba), ['cloze', 'reading']);
});

test('trợ từ KHÔNG có câu ví dụ thì vẫn phải dùng production (không còn cách nào khác)', () => {
  const de = { hanzi: '的', meaning_vi: 'trợ từ sở hữu', pos_vi: 'trợ từ', example_zh: '' };
  assert.deepEqual(stagesFor(de), ['production', 'reading']);
});

test('cloze khoét đúng chỗ và giữ phần còn lại của câu', () => {
  const c = buildCloze({ hanzi: '买', example_zh: '我买了一本书', example_vi: 'Tôi đã mua một quyển sách' });
  assert.equal(c.before, '我');
  assert.equal(c.after, '了一本书');
  assert.equal(c.blankLength, 1);
  assert.equal(c.answer, '买');
});

test('cloze với từ hai chữ đếm đúng số ô trống', () => {
  const c = buildCloze({ hanzi: '学习', example_zh: '我喜欢学习中文' });
  assert.equal(c.blankLength, 2);
  assert.equal(c.before, '我喜欢');
  assert.equal(c.after, '中文');
});

test('câu ví dụ không chứa từ khoá thì không dựng được cloze', () => {
  assert.equal(hasCloze({ hanzi: '买', example_zh: '他卖东西' }), false);
  assert.equal(buildCloze({ hanzi: '买', example_zh: '他卖东西' }), null);
});

test('mồi nhử ưu tiên từ CÙNG ÂM, không lấy ngẫu nhiên', () => {
  const word = { hanzi: '买', meaning_vi: 'mua' };
  const opts = buildChoices(word, {
    homophones: [{ hanzi: '卖', meaning_vi: 'bán' }, { hanzi: '迈', meaning_vi: 'bước' }],
    sameRadical: [{ hanzi: '头', meaning_vi: 'đầu' }],
    sameLevel: [{ hanzi: '狗', meaning_vi: 'con chó' }],
  }, { rand: () => 0 });
  assert.equal(opts.length, 4);
  assert.equal(opts.filter((o) => o.correct).length, 1);
  const set = new Set(opts.map((o) => o.hanzi));
  assert.ok(set.has('卖') && set.has('迈'), 'phải dùng hết từ cùng âm trước');
  assert.ok(!set.has('狗'), 'chưa cần tới mồi cùng cấp khi còn từ cùng âm');
});

test('mồi nhử không trùng nghĩa với đáp án', () => {
  const opts = buildChoices({ hanzi: '买', meaning_vi: 'mua' },
    { homophones: [{ hanzi: '沶', meaning_vi: 'mua' }, { hanzi: '卖', meaning_vi: 'bán' }] },
    { rand: () => 0 });
  assert.equal(opts.filter((o) => o.meaning_vi === 'mua').length, 1);
});

test('một từ ba cổng phải trả lời đúng CẢ BA mới pass', () => {
  const r = new SessionRunner([{ id: 1, hanzi: '买', stages: ['production', 'reading', 'cloze'] }]);
  assert.equal(r.stageOf(1), 'production');
  assert.equal(r.answer(1, true).justPassed, false);
  assert.equal(r.stageOf(1), 'reading');
  assert.equal(r.answer(1, true).justPassed, false);
  assert.equal(r.stageOf(1), 'cloze');
  assert.equal(r.answer(1, true).justPassed, true);
  assert.equal(r.done, true);
});

test('sai ở cổng giữa thì phải làm lại ĐÚNG CỔNG ĐÓ 2 lần, không tụt về cổng đầu', () => {
  const r = new SessionRunner([
    { id: 1, hanzi: '买', stages: ['production', 'reading', 'cloze'] },
    { id: 2, hanzi: '卖', stages: ['production'] },
    { id: 3, hanzi: '狗', stages: ['production'] },
    { id: 4, hanzi: '猫', stages: ['production'] },
    { id: 5, hanzi: '鱼', stages: ['production'] },
  ]);
  r.answer(1, true);                       // qua production
  assert.equal(r.stageOf(1), 'reading');
  r.answer(1, false);                      // sai ở reading
  assert.equal(r.stageOf(1), 'reading', 'không được tụt về production');
  assert.equal(r.state.get(1).needed, 2);
  r.answer(1, true); r.answer(1, true);
  assert.equal(r.stageOf(1), 'cloze');
});

test('next() cho biết đang ở cổng nào và tiến độ cổng', () => {
  const r = new SessionRunner([{ id: 1, hanzi: '买', stages: ['production', 'reading', 'cloze'] }]);
  const q = r.next();
  assert.equal(q.stage, 'production');
  assert.equal(q.stageIndex, 0);
  assert.equal(q.stageCount, 3);
});

test('kho từ thật: trợ từ được định tuyến sang cloze, không bắt gõ từ nghĩa', () => {
  const db = freshDb();
  const rows = db.prepare("SELECT * FROM words WHERE pos_vi LIKE '%trợ từ%' AND example_zh <> ''").all();
  assert.ok(rows.length > 5, 'phải có trợ từ có câu ví dụ trong kho');
  for (const w of rows) assert.equal(stagesFor(w)[0], 'cloze', `${w.hanzi} vẫn bị hỏi production`);
});

test('mỗi cổng của một từ có card riêng, lịch FSRS riêng', () => {
  const db = freshDb();
  const w = db.prepare("SELECT * FROM words WHERE hanzi='买'").get();
  const dirs = db.prepare('SELECT direction FROM cards WHERE word_id=? ORDER BY direction').all(w.id)
    .map((r) => r.direction);
  assert.deepEqual(dirs, ['cloze', 'production', 'reading']);
});

test('trợ từ có cổng neo là cloze, nên lên lịch không qua production', () => {
  const db = freshDb();
  const rows = db.prepare("SELECT hanzi, anchor FROM words WHERE pos_vi LIKE '%trợ từ%' AND example_zh <> ''").all();
  assert.ok(rows.length > 5);
  for (const r of rows) assert.equal(r.anchor, 'cloze', r.hanzi);
});

test('hàng đợi vẫn đủ 20 từ sau khi chuyển sang nhiều cổng', () => {
  const db = freshDb();
  const q = buildQueue(db);
  assert.equal(q.length, 20);
  assert.equal(new Set(q.map((w) => w.id)).size, 20);
  for (const w of q) assert.ok(w.card_id, `${w.hanzi} thiếu card neo`);
});

// ---------- tách phím chốt chữ khỏi phím nộp bài ----------
import { decideEnter, COMPOSITION_GUARD_MS } from '../src/core/ime-submit.mjs';

const enter = (p) => decideEnter({
  isComposing: false, composingState: false, msSinceCompositionEnd: -1,
  withModifier: false, value: '在', ...p,
});

test('đang ghép chữ thì Enter là của IME, không nộp bài', () => {
  assert.equal(enter({ isComposing: true }).submit, false);
  assert.equal(enter({ composingState: true }).submit, false);
});

test('BUG ĐÃ GẶP: Enter ngay sau khi IME chốt chữ KHÔNG được nộp bài', () => {
  // macOS bắn compositionend trước keydown, nên isComposing đã false.
  // Nếu nộp luôn thì chữ IME tự chọn (phổ biến nhất) bị tính là đáp án.
  const r = enter({ isComposing: false, composingState: false, msSinceCompositionEnd: 5 });
  assert.equal(r.submit, false);
  assert.equal(r.reason, 'just_committed');
});

test('sau khi đã kịp nhìn chữ thì Enter mới nộp', () => {
  assert.equal(enter({ msSinceCompositionEnd: COMPOSITION_GUARD_MS + 10 }).submit, true);
});

test('⌘Enter luôn nộp, kể cả ngay sau khi chốt chữ — IME không nuốt tổ hợp này', () => {
  assert.equal(enter({ msSinceCompositionEnd: 0, withModifier: true }).submit, true);
});

test('ô trống thì Enter không làm gì', () => {
  assert.equal(enter({ value: '   ' }).submit, false);
  assert.equal(enter({ value: '', withModifier: true }).submit, false);
});

test('gõ không qua IME (dán sẵn chữ) vẫn nộp được bằng Enter', () => {
  assert.equal(enter({ msSinceCompositionEnd: -1 }).submit, true);
});

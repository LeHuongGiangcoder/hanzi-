import { app, BrowserWindow, Tray, nativeImage, ipcMain, powerMonitor, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
// @ts-ignore — lõi viết bằng .mjs để test được bằng node mà không cần Electron
import { openDb, upsertWords, ensureCards, isoDate, homophonesOf, quarantineWord, stats, getSetting, setSetting, wordByHanzi, distractorPools } from '../core/db.mjs';
// @ts-ignore
import { buildCloze, buildChoices } from '../core/stages.mjs';
// @ts-ignore
import { startSession, applyReview, markPassed, replaceInQueue } from '../core/scheduler.mjs';
// @ts-ignore
import { gradeAnswer } from '../core/grading.mjs';
// @ts-ignore
import { pickHint, buildComparison } from '../core/hints.mjs';
// @ts-ignore
import { SessionRunner } from '../core/session-runner.mjs';

// Bundle main chạy ở chế độ ESM nên không có __dirname sẵn.
const HERE = dirname(fileURLToPath(import.meta.url));

const DRILL_TIME_DEFAULT = '20:30';
const MAX_SNOOZE = 3;

let db: any;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let runner: any = null;
let session: any = null;
let questionShownAt = 0;
let snoozeUntil = 0;
let allowQuit = false;

/* ---------------- dữ liệu ---------------- */

function seedPath() {
  const packaged = join(process.resourcesPath ?? '', 'data', 'seed.hsk1-4.json');
  if (existsSync(packaged)) return packaged;
  return join(app.getAppPath(), 'data', 'seed.hsk1-4.json');
}

function loadSeed() {
  const file = seedPath();
  if (!existsSync(file)) return 0;
  const rows = JSON.parse(readFileSync(file, 'utf8'));
  const n = upsertWords(db, rows);
  ensureCards(db);
  setSetting(db, 'seed_loaded_at', new Date().toISOString());
  return n;
}

/* ---------------- cửa sổ ---------------- */

function createWindow() {
  if (win && !win.isDestroyed()) { win.show(); win.focus(); return win; }
  win = new BrowserWindow({
    width: 980,
    height: 720,
    show: false,
    // Khó bỏ qua, nhưng không khoá cứng máy: ép tới mức không thể thoát sẽ chỉ
    // khiến app bị gỡ sau một tuần.
    alwaysOnTop: true,
    fullscreenable: true,
    closable: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#11131a',
    webPreferences: { preload: join(HERE, '../preload/index.mjs'), sandbox: false },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('close', (e) => { if (!allowQuit) { e.preventDefault(); win?.hide(); } });

  if (process.env.ELECTRON_RENDERER_URL) win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else win.loadFile(join(HERE, '../renderer/index.html'));

  win.once('ready-to-show', () => { win?.show(); win?.focus(); });

  if (process.env.HANZI_DEBUG) {
    win.webContents.on('console-message', (_e, lvl, msg) => console.log(`[renderer:${lvl}] ${msg}`));
    win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer GONE]', JSON.stringify(d)));
    win.webContents.on('did-finish-load', async () => {
      // Kiểm phía renderer: React mount được chưa, IPC gọi được chưa, có rò đáp án không.
      const out = await win!.webContents.executeJavaScript(`(async () => {
        const sleep = (ms) => new Promise(r => setTimeout(r, ms));
        const root = document.getElementById('root');
        const res = { steps: [], learned: 0 };
        // Nhớ đáp án nhìn thấy ở màn hình reveal, để lượt sau trả lời ĐÚNG và
        // đẩy từ sang cổng kế — nếu luôn sai thì không bao giờ tới cổng 2.
        const known = new Map();
        const keyOf = () =>
          (document.querySelector('.sentence')?.innerText
            || document.querySelector('.meaning')?.innerText
            || document.querySelector('.hz.big')?.innerText || '').trim();

        for (let turn = 0; turn < 24; turn++) {
          await sleep(90);
          const stage = document.querySelector('.stagename')?.textContent || '?';
          const key = keyOf();
          const choiceBtns = [...document.querySelectorAll('.choices button')];
          const step = { stage, key: key.slice(0, 18) };

          if (choiceBtns.length) {
            step.kind = 'reading';
            step.choices = choiceBtns.length;
            step.showsBigHanzi = !!document.querySelector('.hz.big');
            step.showsPinyinInPrompt = !!document.querySelector('.prompt .py');
            choiceBtns[0].click();
          } else {
            const input = document.querySelector('input.ime');
            if (!input) { step.kind = 'none'; res.steps.push(step); break; }
            step.kind = document.querySelector('.sentence') ? 'cloze' : 'production';
            const answer = known.get(key) || '狗';
            step.answeredKnown = known.has(key);
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
            setter.call(input, answer);
            input.dispatchEvent(new Event('input', { bubbles: true }));
            input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          }

          await sleep(220);
          const card = document.querySelector('.card');
          step.resultCard = !!card;
          if (card) {
            const hz = card.querySelector('.hz:not(.big)')?.innerText?.trim();
            if (hz && key) { known.set(key, hz); res.learned = known.size; }
            step.passedAll = card.innerText.includes('pass đủ các cổng');
            card.querySelector('button.primary')?.click();
          } else break;
          res.steps.push(step);
        }
        res.crashed = root.children.length === 0;
        res.stageKinds = [...new Set(res.steps.map(s => s.kind))];
        return res;
      })()`);
      console.log('\n===RENDERER===\n' + JSON.stringify(out, null, 1) + '\n===END===');
      const reading = out.steps.filter((s: any) => s.kind === 'reading');
      const bad = out.crashed
        || out.steps.length < 10
        || out.steps.some((s: any) => s.resultCard === false)
        || !out.stageKinds.includes('reading')
        || reading.some((s: any) => s.choices !== 4 || !s.showsBigHanzi || s.showsPinyinInPrompt);
      app.exit(bad ? 1 : 0);
    });
  }
  return win;
}

/* ---------------- lịch nhắc ---------------- */

function sessionDoneToday() {
  const row = db.prepare('SELECT finished_at FROM sessions WHERE date=?').get(isoDate());
  return !!row?.finished_at;
}

function shouldDrillNow() {
  if (sessionDoneToday()) return false;
  if (Date.now() < snoozeUntil) return false;
  const [h, m] = (getSetting(db, 'drill_time', DRILL_TIME_DEFAULT) as string).split(':').map(Number);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

function tick() {
  if (shouldDrillNow() && !win?.isVisible()) createWindow();
}

/* ---------------- phiên học ---------------- */

function ensureRunner() {
  if (runner && session && session.date === isoDate()) return;
  const r = startSession(db);
  session = r.session;
  runner = new SessionRunner(
    r.items.map((it: any) => ({ ...it, stages: JSON.parse(it.stages) }))
  );
  // Khôi phục tiến độ nếu hôm nay đã học dở: từ đã pass thì cho qua hết các cổng.
  for (const it of r.items)
    if (it.passed_at) for (const _ of JSON.parse(it.stages)) runner.answer(it.id, true);
}

/** Lựa chọn của cổng đọc hiểu, giữ ở main để đáp án không nằm sẵn trong renderer. */
let readingChoices: { hanzi: string; meaning_vi: string; correct: boolean }[] = [];

function currentQuestion() {
  ensureRunner();
  const w = runner.next();
  if (!w) return { done: true, progress: runner.progress() };
  questionShownAt = Date.now();

  const base = {
    id: w.id, stage: w.stage, stageIndex: w.stageIndex, stageCount: w.stageCount,
    hsk_level: w.hsk_level,
  };

  // Mỗi cổng chỉ gửi xuống renderer đúng thứ nó cần hiển thị. Hán tự đáp án
  // không bao giờ đi kèm ở cổng production và cloze.
  if (w.stage === 'production') {
    return {
      done: false, progress: runner.progress(),
      word: { ...base, hanzi_len: [...String(w.hanzi)].length, meaning_vi: w.meaning_vi, pos_vi: w.pos_vi },
    };
  }

  if (w.stage === 'reading') {
    // Ở cổng này hán tự CHÍNH LÀ câu hỏi, nên gửi xuống là đúng — nhưng vẫn
    // không gửi pinyin: pinyin chỉ hiện ở màn hình reveal.
    readingChoices = buildChoices(w, distractorPools(db, w));
    return {
      done: false, progress: runner.progress(),
      word: {
        ...base, hanzi: w.hanzi,
        choices: readingChoices.map((c, i) => ({ i, meaning_vi: c.meaning_vi })),
      },
    };
  }

  const cz = buildCloze(w);
  return {
    done: false, progress: runner.progress(),
    word: {
      ...base, hanzi_len: [...String(w.hanzi)].length,
      meaning_vi: w.meaning_vi,
      cloze: cz ? { before: cz.before, after: cz.after, blankLength: cz.blankLength, translation: cz.translation } : null,
    },
  };
}

function reveal(w: any) {
  return {
    hanzi: w.hanzi, pinyin: w.pinyin, hanviet: w.hanviet,
    meaning_vi: w.meaning_vi, pos_vi: w.pos_vi, radical: w.radical,
    example_zh: w.example_zh, example_vi: w.example_vi, note: w.note,
  };
}

/* ---------------- IPC ---------------- */

function registerIpc() {
  ipcMain.handle('session:question', () => currentQuestion());

  ipcMain.handle('session:answer', (_e, { wordId, raw, choice }) => {
    ensureRunner();
    const w = db.prepare('SELECT * FROM words WHERE id=?').get(wordId);
    const stage = runner.stageOf(wordId);
    const card = db.prepare('SELECT * FROM cards WHERE word_id=? AND direction=?').get(wordId, stage);
    const latency = Date.now() - questionShownAt;

    // Cổng đọc hiểu chấm theo lựa chọn, hai cổng còn lại chấm chuỗi gõ bằng IME.
    const g =
      stage === 'reading'
        ? {
            correct: !!readingChoices[choice]?.correct,
            errorType: readingChoices[choice]?.correct ? 'none' : 'meaning_wrong',
            grade: readingChoices[choice]?.correct ? (latency > 8000 ? 2 : 3) : 1,
            shaky: latency > 8000, answer: readingChoices[choice]?.meaning_vi ?? '',
            answerPinyin: '', sameSound: false, imeOff: false,
          }
        : gradeAnswer(raw, w.hanzi, latency);

    // Chưa bật IME không phải lỗi kiến thức: không ghi review, không phạt lịch.
    if (g.imeOff) return { imeOff: true, progress: runner.progress() };

    applyReview(db, card, {
      grade: g.grade, latencyMs: latency, answerRaw: g.answer,
      errorType: g.errorType, sessionId: session.id,
    });

    const res = runner.answer(wordId, g.correct);
    if (g.correct && res?.justPassed) markPassed(db, session.id, wordId);

    const sibs = homophonesOf(db, wordId);
    const typed = g.sameSound ? wordByHanzi(db, g.answer) : null;

    return {
      correct: g.correct,
      errorType: g.errorType,
      stage,
      shaky: g.shaky,
      latencyMs: latency,
      justPassed: !!res?.justPassed,
      clearedStage: !!res?.clearedStage,
      nextStage: res?.justPassed ? null : (runner.stageOf(wordId) ?? null),
      stillNeeded: res?.needed ?? 0,
      reveal: reveal(w),
      hint: g.correct ? null : pickHint(w, sibs),
      comparison: typed ? buildComparison(w, typed) : null,
      typedPinyin: g.answerPinyin,
      progress: runner.progress(),
    };
  });

  ipcMain.handle('session:report', (_e, { wordId, field, appValue, correction, reason }) => {
    const w = db.prepare('SELECT * FROM words WHERE id=?').get(wordId);
    const id = randomUUID();
    db.prepare(
      `INSERT INTO reports (report_id, word_id, hanzi, field, app_value, my_correction, reason, session_id)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(id, wordId, w.hanzi, field, appValue ?? '', correction ?? '', reason ?? '', session?.id ?? null);

    if (field === 'grading') {
      // Dữ liệu đúng, app chấm sai → cho qua tại chỗ, KHÔNG tính lapse.
      const card = db.prepare('SELECT * FROM cards WHERE word_id=? AND direction=?')
        .get(wordId, runner.stageOf(wordId) ?? 'production');
      applyReview(db, card, { grade: 3, latencyMs: 0, answerRaw: '', errorType: 'none', sessionId: session.id });
      const st = runner.state.get(wordId);
      if (st) { st.needed = 1; st.stageIdx = st.stages.length - 1; }
      runner.answer(wordId, true);
      markPassed(db, session.id, wordId);
      return { kind: 'grading', progress: runner.progress() };
    }

    // Mọi loại khác: cách ly NGAY và bù từ khác, để chỉ tiêu 20 không đổi.
    quarantineWord(db, wordId, true);
    const repl = replaceInQueue(db, session.id, wordId);
    runner.removeAndReplace(wordId, repl);
    return { kind: 'quarantine', replaced: !!repl, progress: runner.progress() };
  });

  ipcMain.handle('session:snooze', () => {
    const used = db.prepare('SELECT snoozes_used FROM sessions WHERE id=?').get(session?.id)?.snoozes_used ?? 0;
    if (used >= MAX_SNOOZE) return { ok: false, used, max: MAX_SNOOZE };
    db.prepare('UPDATE sessions SET snoozes_used=snoozes_used+1 WHERE id=?').run(session.id);
    snoozeUntil = Date.now() + 10 * 60 * 1000;
    win?.hide();
    return { ok: true, used: used + 1, max: MAX_SNOOZE };
  });

  // Thoát giữa chừng phải gõ đúng 我放弃 bằng IME — đầu hàng cũng phải học.
  ipcMain.handle('session:surrender', (_e, { typed }) => {
    if (String(typed ?? '').normalize('NFC').replace(/\s+/g, '') !== '我放弃') return { ok: false };
    win?.hide();
    return { ok: true };
  });

  ipcMain.handle('stats:get', () => ({
    ...stats(db),
    today: db.prepare('SELECT * FROM sessions WHERE date=?').get(isoDate()) ?? null,
    streak: db.prepare(
      `SELECT COUNT(*) n FROM sessions WHERE finished_at IS NOT NULL AND date >= date('now','localtime','-30 day')`
    ).get().n,
  }));

  ipcMain.handle('settings:get', () => ({
    drillTime: getSetting(db, 'drill_time', DRILL_TIME_DEFAULT),
  }));
  ipcMain.handle('settings:set', (_e, { key, value }) => { setSetting(db, key, value); return true; });
}

/* ---------------- vòng đời ---------------- */

app.whenReady().then(() => {
  db = openDb(join(app.getPath('userData'), 'hanzi-drill.db'));
  if (!getSetting(db, 'seed_loaded_at')) loadSeed();
  ensureCards(db);
  registerIpc();

  tray = new Tray(nativeImage.createEmpty());
  tray.setTitle('汉');
  tray.setToolTip('hanzi-drill');
  tray.on('click', () => createWindow());

  app.setLoginItemSettings({ openAtLogin: true, openAsHidden: true });
  setInterval(tick, 60_000);
  powerMonitor.on('resume', tick);   // laptop ngủ qua giờ hẹn thì bắt lại khi mở nắp
  tick();

  if (process.env.HANZI_SMOKE) { runSmoke(); return; }
  if (process.env.HANZI_SHOW_ON_START) createWindow();
});

/**
 * Kiểm tra nhanh toàn bộ đường dây phía main (SQLite dưới ABI Electron, nạp seed,
 * dựng phiên, chấm bài, cách ly) rồi thoát. Chạy: HANZI_SMOKE=1 npx electron .
 */
function runSmoke() {
  const out: string[] = [];
  const ok = (label: string, cond: unknown, extra = '') =>
    out.push(`${cond ? 'PASS' : 'FAIL'}  ${label}${extra ? '  — ' + extra : ''}`);
  try {
    const s = stats(db);
    ok('nạp kho từ', s.words > 3000 && s.ready > 3000,
       `${s.words} từ, ${s.ready} sẵn sàng, ${s.quarantined} bị cách ly`);
    ok('từ đáng ngờ đã bị cách ly sẵn', s.quarantined > 0);

    ensureRunner();
    ok('dựng phiên hôm nay', session && runner.total > 0, `${runner.total} từ`);

    const q1: any = currentQuestion();
    ok('sinh được câu hỏi', !q1.done && q1.word?.meaning_vi, q1.word?.meaning_vi);
    ok('câu hỏi KHÔNG rò hán tự/pinyin xuống renderer',
       !('hanzi' in (q1.word ?? {})) && !('pinyin' in (q1.word ?? {})));

    const w: any = db.prepare('SELECT * FROM words WHERE id=?').get(q1.word.id);
    const card: any = db.prepare('SELECT * FROM cards WHERE word_id=? AND direction=?')
      .get(w.id, runner.stageOf(w.id));
    const g = gradeAnswer(w.hanzi, w.hanzi, 1000);
    applyReview(db, card, { grade: g.grade, latencyMs: 1000, answerRaw: w.hanzi, errorType: g.errorType, sessionId: session.id });
    const nStages = JSON.parse(w.stages).length;
    for (let i = 0; i < nStages; i++) runner.answer(w.id, true);
    markPassed(db, session.id, w.id);
    ok('vượt đủ cổng mới pass', runner.progress().passed === 1,
       `${w.hanzi} có ${nStages} cổng → ${runner.progress().passed}/${runner.progress().total}`);

    const q2: any = currentQuestion();
    const before = runner.total;
    quarantineWord(db, q2.word.id, true);
    const repl = replaceInQueue(db, session.id, q2.word.id);
    runner.removeAndReplace(q2.word.id, repl);
    ok('báo lỗi → cách ly + bù từ, chỉ tiêu giữ nguyên', runner.total === before, `${runner.total} từ`);

    const withEx: any = db.prepare(
      "SELECT COUNT(*) n FROM words WHERE example_zh <> ''").get();
    ok('có câu ví dụ', withEx.n > 3000, `${withEx.n} câu`);

    // --- đi qua cả ba cổng của một từ, kiểm payload từng cổng ---
    const target: any = db.prepare(
      `SELECT * FROM words WHERE stages = '["production","reading","cloze"]'
         AND quarantined = 0 LIMIT 1`).get();
    const st = runner.state.get(target.id)
      ?? (runner.state.set(target.id, {
            word: { ...target, stages: JSON.parse(target.stages) },
            stages: JSON.parse(target.stages), stageIdx: 0, needed: 1, wrongCount: 0,
            passed: false, removed: false, notBefore: 0,
          }), runner.queue.unshift(target.id), runner.state.get(target.id));
    st.stageIdx = 0; st.passed = false; st.removed = false; st.notBefore = 0;
    if (!runner.queue.includes(target.id)) runner.queue.unshift(target.id);

    const seen: string[] = [];
    for (let i = 0; i < 3; i++) {
      runner.queue = [target.id, ...runner.queue.filter((x: number) => x !== target.id)];
      const q: any = currentQuestion();
      seen.push(q.word.stage);
      if (q.word.stage === 'production') {
        ok('cổng 1 production: có nghĩa, KHÔNG có hán tự',
           !!q.word.meaning_vi && !('hanzi' in q.word));
      } else if (q.word.stage === 'reading') {
        ok('cổng 2 reading: có hán tự + 4 lựa chọn, KHÔNG có pinyin',
           q.word.hanzi === target.hanzi && q.word.choices?.length === 4 && !('pinyin' in q.word),
           q.word.choices?.map((c: any) => c.meaning_vi).join(' | ').slice(0, 70));
        ok('đúng một lựa chọn là đáp án',
           readingChoices.filter((c) => c.correct).length === 1);
        ok('mồi nhử không lặp nghĩa',
           new Set(readingChoices.map((c) => c.meaning_vi)).size === readingChoices.length);
      } else {
        ok('cổng 3 cloze: có câu khoét trống, KHÔNG có hán tự đáp án',
           !!q.word.cloze && !('hanzi' in q.word),
           q.word.cloze ? `${q.word.cloze.before}[${q.word.cloze.blankLength} ô]${q.word.cloze.after}` : '');
      }
      runner.answer(target.id, true);
    }
    ok('thứ tự cổng: tạo chữ → đọc hiểu → dùng trong câu',
       seen.join('>') === 'production>reading>cloze', seen.join(' > '));

    const particle: any = db.prepare(
      "SELECT hanzi, anchor FROM words WHERE pos_vi LIKE '%trợ từ%' AND example_zh <> '' LIMIT 1").get();
    ok('trợ từ vào thẳng cloze, không bị bắt gõ từ nghĩa',
       particle?.anchor === 'cloze', `${particle?.hanzi} → ${particle?.anchor}`);

    const mai: any = wordByHanzi(db, '买');
    const h = pickHint(mai, homophonesOf(db, mai.id));
    ok('gợi ý Hán-Việt cho 买', h.kind === 'hanviet' && h.value === 'mãi', `${h.kind}=${h.value}`);
  } catch (e: any) {
    out.push('FAIL  ngoại lệ — ' + e.message + '\n' + e.stack);
  }
  console.log('\n===SMOKE===\n' + out.join('\n') + '\n===END===');
  app.exit(out.some((l) => l.startsWith('FAIL')) ? 1 : 0);
}

app.on('before-quit', (e) => {
  if (allowQuit || sessionDoneToday()) return;
  e.preventDefault();
  dialog.showMessageBox({
    type: 'warning',
    message: 'Hôm nay chưa pass đủ 20 từ.',
    detail: 'Thoát bây giờ sẽ mất streak của ngày hôm nay.',
    buttons: ['Học tiếp', 'Vẫn thoát'],
    defaultId: 0,
    cancelId: 0,
  }).then(({ response }) => { if (response === 1) { allowQuit = true; app.quit(); } else createWindow(); });
});

app.on('window-all-closed', () => { /* ở lại trên tray */ });

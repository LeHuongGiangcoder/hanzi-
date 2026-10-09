import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, powerMonitor, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
// @ts-ignore — lõi viết bằng .mjs để test được bằng node mà không cần Electron
import { openDb, upsertWords, ensureCards, isoDate, homophonesOf, quarantineWord, stats, getSetting, setSetting, wordByHanzi, distractorPools } from '../core/db.mjs';
// @ts-ignore
import { buildCloze, buildChoices } from '../core/stages.mjs';
// @ts-ignore
import { resumeSession, applyReview, markPassed, replaceInQueue, saveStageIdx } from '../core/scheduler.mjs';
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
const REMIND_EVERY_MIN = 30;

// CHỈ CHO PHÉP MỘT BẢN CHẠY. Hai bản cùng chạy nghĩa là hai cái timer, hai cái
// tray, và cửa sổ bật lên gấp đôi — người dùng đóng một cái thì cái kia mở lại.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => createWindow());
}

let db: any;
let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let runner: any = null;
let session: any = null;
let questionShownAt = 0;
// Mốc sớm nhất được phép tự bật cửa sổ lần tới.
let nextPromptAt = 0;
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
    // Đóng được. Tiến độ đã nằm trong SQLite nên không mất gì — cửa sổ chỉ ẩn
    // đi, app ở lại trên menu bar và mở lại đúng chỗ đang dở.
    closable: true,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#11131a',
    webPreferences: { preload: join(HERE, '../preload/index.mjs'), sandbox: false },
  });
  applyAlwaysOnTop();
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.on('close', (e) => {
    if (allowQuit) return;
    e.preventDefault();
    win?.hide();
    // Bạn vừa chủ động đóng → coi như xin hoãn, đừng bật lại ngay.
    deferPrompt();
    refreshIndicators();
  });

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
        const res = {};
        const input = () => document.querySelector('input.ime');
        const setVal = (el, v) => {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
          setter.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true }));
        };
        const enter = (el, composing) => el.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: !!composing })
        );

        // Bỏ qua các cổng không có ô nhập cho tới khi gặp cổng gõ IME.
        for (let i = 0; i < 8 && !input(); i++) {
          document.querySelector('.choices button')?.click();
          await sleep(200);
          document.querySelector('.card button.primary')?.click();
          await sleep(200);
        }

        const compose = (el, text) => {
          el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
          setVal(el, 'zai');
          setVal(el, text);
          el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: text }));
        };

        // B — Enter đi liền sau khi IME chốt chữ (đúng chuỗi sự kiện của macOS,
        // đây là bug đã tái hiện được). Phải KHÔNG nộp bài.
        let el = input(); if (!el) return { error: 'không thấy ô nhập' };
        compose(el, '在');
        await sleep(60);
        enter(el, false);
        await sleep(200);
        res.B_submittedOnCommitEnter = !!document.querySelector('.card');
        res.B_valueKept = input()?.value ?? null;
        res.B_showsNudge = !!document.querySelector('.nudge');
        res.B_showsPreview = document.querySelector('.hz-preview')?.innerText ?? null;

        // C — sửa lại thành chữ khác rồi Enter lần nữa: lần này phải nộp.
        el = input();
        compose(el, '再');
        await sleep(400);
        enter(el, false);
        await sleep(250);
        res.C_secondEnterSubmitted = !!document.querySelector('.card');
        res.C_whatGotSubmitted = document.querySelector('.card .hz')?.innerText ?? null;
        document.querySelector('.card button.primary')?.click();
        await sleep(250);

        // D — ⌘Enter ngay sau khi chốt chữ: IME không nuốt tổ hợp này nên nộp luôn.
        el = input();
        if (el) {
          compose(el, '狗');
          await sleep(40);
          el.dispatchEvent(new KeyboardEvent('keydown', {
            key: 'Enter', metaKey: true, bubbles: true, cancelable: true }));
          await sleep(250);
          res.D_cmdEnterSubmitted = !!document.querySelector('.card');
        }
        return res;
      })()`);
      console.log('\n===RENDERER===\n' + JSON.stringify(out, null, 1) + '\n===END===');
      app.exit(0);
    });
  }
  return win;
}

/**
 * Mức nổi của cửa sổ.
 *
 * KHÔNG dùng 'screen-saver' (level 1000): bảng gợi ý chữ của bộ gõ tiếng Trung
 * nằm ở mức thấp hơn (cỡ pop-up menu, ~101), nên cửa sổ sẽ CHE MẤT bảng gợi ý
 * và không chọn được chữ.
 *
 * 'floating' (level 3) vẫn giữ cửa sổ trên các app khác nhưng nằm dưới bảng gợi
 * ý — đúng thứ tự cần có.
 */
function applyAlwaysOnTop() {
  if (!win || win.isDestroyed()) return;
  const on = getSetting(db, 'always_on_top', '1') !== '0';
  win.setAlwaysOnTop(on, 'floating');
}

/* ---------------- lịch nhắc ---------------- */

function sessionDoneToday() {
  const row = db.prepare('SELECT finished_at FROM sessions WHERE date=?').get(isoDate());
  return !!row?.finished_at;
}

function remindMs() {
  const n = Number(getSetting(db, 'remind_every_min', String(REMIND_EVERY_MIN)));
  return (Number.isFinite(n) && n > 0 ? n : REMIND_EVERY_MIN) * 60_000;
}

/** Hoãn lần tự bật cửa sổ kế tiếp. */
function deferPrompt(ms = remindMs()) {
  nextPromptAt = Date.now() + ms;
}

function msUntilTomorrow() {
  const t = new Date();
  t.setHours(24, 0, 0, 0);
  return t.getTime() - Date.now();
}

function shouldDrillNow() {
  if (sessionDoneToday()) return false;
  if (Date.now() < nextPromptAt) return false;
  const [h, m] = (getSetting(db, 'drill_time', DRILL_TIME_DEFAULT) as string).split(':').map(Number);
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes() >= h * 60 + m;
}

function tick() {
  if (!shouldDrillNow()) return;
  if (win && !win.isDestroyed() && win.isVisible()) return;
  createWindow();
  // Đã nhắc rồi thì im một lúc. Trước đây hàm này chạy mỗi 60 giây và mở lại
  // cửa sổ ngay sau khi người dùng vừa đóng — đóng xong một phút sau lại hiện.
  deferPrompt();
}

/* ---------------- phiên học ---------------- */

function ensureRunner() {
  if (runner && session && session.date === isoDate()) return;
  const r = resumeSession(db);
  session = r.session;
  runner = r.runner;
  refreshIndicators();
}

/**
 * Chỉ báo luôn nhìn thấy: tiêu đề trên menu bar và badge trên Dock.
 * Đây là chỗ nhắc "hôm nay còn bao nhiêu từ" mà không cần mở app.
 */
function refreshIndicators() {
  const row = db.prepare('SELECT passed_count, target_count, finished_at FROM sessions WHERE date=?')
    .get(isoDate());
  const passed = row?.passed_count ?? 0;
  const target = row?.target_count ?? 20;
  const left = Math.max(0, target - passed);
  const done = !!row?.finished_at || left === 0;

  tray?.setTitle(done ? '汉 ✓' : `汉 ${passed}/${target}`);
  tray?.setToolTip(done ? 'Xong 20 từ hôm nay' : `Còn ${left} từ hôm nay`);
  if (process.platform === 'darwin')
    app.dock?.setBadge(done || !row ? '' : String(left));

  const waiting = nextPromptAt > Date.now()
    ? `Nhắc lại lúc ${new Date(nextPromptAt).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}`
    : `Giờ học: ${getSetting(db, 'drill_time', DRILL_TIME_DEFAULT)}`;

  tray?.setContextMenu(Menu.buildFromTemplate([
    { label: done ? 'Hôm nay đã xong ✓' : `Còn ${left} / ${target} từ`, enabled: false },
    { label: done ? '' : waiting, enabled: false, visible: !done },
    { type: 'separator' },
    { label: done ? 'Mở để học thêm' : 'Học tiếp', click: () => createWindow() },
    { label: 'Nhắc lại sau 30 phút', visible: !done, click: () => { deferPrompt(); win?.hide(); refreshIndicators(); } },
    { label: 'Nghỉ hôm nay', visible: !done, click: () => { deferPrompt(msUntilTomorrow()); win?.hide(); refreshIndicators(); } },
    { type: 'separator' },
    {
      label: 'Mở cùng máy khi đăng nhập',
      type: 'checkbox',
      checked: getSetting(db, 'open_at_login', '1') !== '0',
      enabled: app.isPackaged,
      click: (item) => {
        setSetting(db, 'open_at_login', item.checked ? '1' : '0');
        if (app.isPackaged)
          app.setLoginItemSettings({ openAtLogin: item.checked, openAsHidden: true });
        refreshIndicators();
      },
    },
    { type: 'separator' },
    { label: 'Thoát hẳn', click: () => { allowQuit = true; app.quit(); } },
  ]));
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
    else saveStageIdx(db, session.id, wordId, runner.state.get(wordId)?.stageIdx ?? 0);
    refreshIndicators();

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
    deferPrompt(10 * 60_000);
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
    alwaysOnTop: getSetting(db, 'always_on_top', '1') !== '0',
  }));
  ipcMain.handle('settings:set', (_e, { key, value }) => {
    setSetting(db, key, value);
    if (key === 'always_on_top') applyAlwaysOnTop();
    return true;
  });

  // Lưới an toàn: nếu trên máy bạn bảng gợi ý vẫn bị che, hạ hẳn cửa sổ xuống
  // trong lúc đang ghép chữ rồi nâng lại khi xong.
  ipcMain.handle('window:composing', (_e, composing: boolean) => {
    if (!win || win.isDestroyed()) return false;
    if (getSetting(db, 'lower_while_composing', '0') === '0') return false;
    if (composing) win.setAlwaysOnTop(false);
    else applyAlwaysOnTop();
    return true;
  });
}

/* ---------------- vòng đời ---------------- */

app.whenReady().then(() => {
  db = openDb(join(app.getPath('userData'), 'hanzi-drill.db'));
  if (!getSetting(db, 'seed_loaded_at')) loadSeed();
  ensureCards(db);
  registerIpc();

  tray = new Tray(nativeImage.createEmpty());
  tray.on('click', () => createWindow());
  refreshIndicators();
  // Giữ chỉ báo đúng cả khi sang ngày mới mà không mở app.
  setInterval(refreshIndicators, 5 * 60_000);

  // CHỈ đăng ký khởi động cùng máy khi đã đóng gói. Bản dev chạy bằng binary
  // Electron trong node_modules, đăng ký nó sẽ tạo một mục khởi động trỏ vào
  // thư mục build — mỗi lần đóng gói lại là thành mục chết, và máy vẫn cố bật
  // một thứ không còn ở đó.
  if (app.isPackaged && getSetting(db, 'open_at_login', '1') !== '0')
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

    // --- đóng cửa sổ + chỉ báo luôn hiện ---
    const w2 = createWindow();
    ok('cửa sổ ĐÓNG ĐƯỢC (nút close không bị khoá)', w2.isClosable());
    w2.close();
    ok('đóng rồi thì chỉ ẩn, app vẫn sống', !w2.isDestroyed() && !w2.isVisible());

    refreshIndicators();
    const sess: any = db.prepare('SELECT passed_count, target_count FROM sessions WHERE date=?')
      .get(isoDate());
    const left = sess.target_count - sess.passed_count;
    ok('menu bar hiện tiến độ', tray?.getTitle() === `汉 ${sess.passed_count}/${sess.target_count}`,
       tray?.getTitle());
    ok('Dock hiện số từ còn lại',
       process.platform !== 'darwin' || app.dock?.getBadge() === String(left),
       `badge=${app.dock?.getBadge()} (còn ${left})`);

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

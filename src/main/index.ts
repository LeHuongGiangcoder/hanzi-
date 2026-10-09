import { app, BrowserWindow, Tray, nativeImage, ipcMain, powerMonitor, dialog } from 'electron';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
// @ts-ignore — lõi viết bằng .mjs để test được bằng node mà không cần Electron
import { openDb, upsertWords, ensureCards, isoDate, homophonesOf, quarantineWord, stats, getSetting, setSetting, wordByHanzi } from '../core/db.mjs';
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
        const root = document.getElementById('root');
        const q = await window.hanzi.question();
        const html = root.innerHTML;
        return {
          mounted: root.children.length > 0,
          hasInput: !!document.querySelector('input.ime'),
          progressShown: /\\d+\\/\\d+/.test(root.innerText),
          meaningShown: !!document.querySelector('.meaning')?.textContent?.trim(),
          ipcOk: !!q && typeof q.done === 'boolean',
          leaksHanzi: /[\\u4e00-\\u9fff]/.test(document.querySelector('.prompt')?.innerText || ''),
          text: root.innerText.replace(/\\n+/g, ' | ').slice(0, 180)
        };
      })()`);
      console.log('\n===RENDERER===\n' + JSON.stringify(out, null, 1) + '\n===END===');
      app.exit(out.mounted && out.hasInput && out.ipcOk && !out.leaksHanzi ? 0 : 1);
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
  runner = new SessionRunner(r.items);
  // Khôi phục tiến độ nếu hôm nay đã học dở.
  for (const it of r.items) if (it.passed_at) runner.answer(it.id, true);
}

function currentQuestion() {
  ensureRunner();
  const w = runner.next();
  if (!w) return { done: true, progress: runner.progress() };
  questionShownAt = Date.now();
  return {
    done: false,
    progress: runner.progress(),
    word: {
      id: w.id, hanzi_len: [...String(w.hanzi)].length,
      meaning_vi: w.meaning_vi, pos_vi: w.pos_vi, hsk_level: w.hsk_level,
      // CỐ Ý không gửi hanzi/pinyin/hanviet xuống renderer trước khi trả lời,
      // để không có cách nào rò đáp án ra devtools.
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

  ipcMain.handle('session:answer', (_e, { wordId, raw }) => {
    ensureRunner();
    const w = db.prepare('SELECT * FROM words WHERE id=?').get(wordId);
    const card = db.prepare("SELECT * FROM cards WHERE word_id=? AND direction='production'").get(wordId);
    const latency = Date.now() - questionShownAt;
    const g = gradeAnswer(raw, w.hanzi, latency);

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
      shaky: g.shaky,
      latencyMs: latency,
      justPassed: !!res?.justPassed,
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
      const card = db.prepare("SELECT * FROM cards WHERE word_id=? AND direction='production'").get(wordId);
      applyReview(db, card, { grade: 3, latencyMs: 0, answerRaw: '', errorType: 'none', sessionId: session.id });
      const st = runner.state.get(wordId);
      if (st) { st.needed = 1; }
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
    const card: any = db.prepare("SELECT * FROM cards WHERE word_id=? AND direction='production'").get(w.id);
    const g = gradeAnswer(w.hanzi, w.hanzi, 1000);
    applyReview(db, card, { grade: g.grade, latencyMs: 1000, answerRaw: w.hanzi, errorType: g.errorType, sessionId: session.id });
    runner.answer(w.id, true);
    markPassed(db, session.id, w.id);
    ok('chấm đúng + ghi lịch', runner.progress().passed === 1, `${runner.progress().passed}/${runner.progress().total}`);

    const q2: any = currentQuestion();
    const before = runner.total;
    quarantineWord(db, q2.word.id, true);
    const repl = replaceInQueue(db, session.id, q2.word.id);
    runner.removeAndReplace(q2.word.id, repl);
    ok('báo lỗi → cách ly + bù từ, chỉ tiêu giữ nguyên', runner.total === before, `${runner.total} từ`);

    const withEx: any = db.prepare(
      "SELECT COUNT(*) n FROM words WHERE example_zh <> ''").get();
    ok('có câu ví dụ', withEx.n > 3000, `${withEx.n} câu`);

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

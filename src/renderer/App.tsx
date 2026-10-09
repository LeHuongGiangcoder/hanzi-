import { useCallback, useEffect, useState } from 'react';
import ImeInput from './components/ImeInput';
import ReportDialog from './components/ReportDialog';
import ReadingStage from './components/ReadingStage';
import ClozeStage from './components/ClozeStage';
import Progress from './components/Progress';

const STAGE_LABEL: Record<string, string> = {
  production: 'Tạo ra chữ', reading: 'Đọc hiểu', cloze: 'Dùng trong câu',
};

declare global { interface Window { hanzi: any } }

type Q = { done: boolean; progress: any; word?: any };

export default function App() {
  const [q, setQ] = useState<Q | null>(null);
  const [result, setResult] = useState<any>(null);
  const [reporting, setReporting] = useState<string | null>(null);
  const [imeWarn, setImeWarn] = useState(false);
  const [showStats, setShowStats] = useState(false);

  const load = useCallback(async () => {
    setResult(null); setImeWarn(false);
    setQ(await window.hanzi.question());
  }, []);
  useEffect(() => { load(); }, [load]);

  // ⌘E mở báo lỗi ở bất kỳ bước nào.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'e' && q?.word) {
        e.preventDefault();
        setReporting(result && !result.correct ? 'grading' : 'hanzi');
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [q, result]);

  const submit = async (raw: string) => {
    const r = await window.hanzi.answer(q!.word.id, raw);
    if (r.imeOff) { setImeWarn(true); return; }
    setResult(r);
  };
  const pick = async (choice: number) => setResult(await window.hanzi.answer(q!.word.id, '', choice));

  if (!q) return <div className="stage">Đang tải…</div>;

  const p = q.progress ?? { passed: 0, total: 20 };
  const pct = p.total ? (p.passed / p.total) * 100 : 0;

  if (q.done) {
    return (
      <div className="stage done">
        <h1 style={{ marginBottom: 24 }}>Xong {p.total} từ hôm nay ✓</h1>
        <Progress />
      </div>
    );
  }

  return (
    <>
      <div className="topbar">
        <span className="count">{p.passed}/{p.total}</span>
        {q.word && (
          <>
            <span className="stagename">{STAGE_LABEL[q.word.stage] ?? q.word.stage}</span>
            <span className="stagebar">
              {Array.from({ length: q.word.stageCount }, (_, i) => (
                <i key={i} className={i <= q.word.stageIndex ? 'on' : ''} />
              ))}
            </span>
          </>
        )}
        <div className="bar"><i style={{ width: `${pct}%` }} /></div>
        <button className="ghost" onClick={() => setShowStats(true)}>Tiến độ</button>
        <button className="ghost" onClick={() => setReporting(result && !result.correct ? 'grading' : 'hanzi')}>
          ⚠ Báo lỗi <span style={{ opacity: .6 }}>⌘E</span>
        </button>
        <button className="ghost" onClick={async () => {
          const r = await window.hanzi.snooze();
          if (!r.ok) alert(`Đã dùng hết ${r.max} lần hoãn của hôm nay.`);
        }}>Hoãn 10′</button>
      </div>

      <div className="stage">
        {!result ? (
          q.word.stage === 'reading' ? (
            <ReadingStage hanzi={q.word.hanzi} choices={q.word.choices} onPick={pick} />
          ) : q.word.stage === 'cloze' && q.word.cloze ? (
            <>
              <ClozeStage
                cloze={q.word.cloze}
                meaning={q.word.meaning_vi}
                expectedLength={q.word.hanzi_len}
                onSubmit={submit}
                bad={imeWarn}
              />
              <div className="hintline">
                {imeWarn
                  ? 'Bạn đang gõ chữ Latin — bật bộ gõ tiếng Trung rồi thử lại. Lượt này không bị tính sai.'
                  : 'Gõ pinyin → chọn chữ (phím số 1–9) → Enter để nộp.'}
              </div>
            </>
          ) : (
          <>
            <div className="prompt">
              <div className="ask">Gõ hán tự</div>
              <div className="meaning">{q.word.meaning_vi}</div>
              <div className="pos">{q.word.pos_vi} · HSK {q.word.hsk_level}</div>
            </div>
            <ImeInput onSubmit={submit} expectedLength={q.word.hanzi_len} bad={imeWarn} />
            <div className="hintline">
              {imeWarn
                ? 'Bạn đang gõ chữ Latin — bật bộ gõ tiếng Trung rồi thử lại. Lượt này không bị tính sai.'
                : 'Gõ pinyin → chọn chữ (phím số 1–9) → Enter để nộp. Pinyin chỉ hiện sau khi trả lời.'}
            </div>
          </>
          )
        ) : (
          <Result result={result} onNext={load} onReport={() => setReporting('grading')} />
        )}
      </div>

      {showStats && (
        <div className="modal" onClick={() => setShowStats(false)}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: 600 }}>
            <Progress onClose={() => setShowStats(false)} />
          </div>
        </div>
      )}

      {reporting && (
        <ReportDialog
          defaultField={reporting}
          appValue={result?.reveal ? `${result.reveal.hanzi} ${result.reveal.pinyin}` : ''}
          onClose={() => setReporting(null)}
          onSend={async (payload) => {
            await window.hanzi.report({
              wordId: q.word.id, appValue: result?.reveal?.pinyin ?? '', ...payload,
            });
            setReporting(null);
            load();
          }}
        />
      )}
    </>
  );
}

function Result({ result, onNext, onReport }: { result: any; onNext: () => void; onReport: () => void }) {
  const r = result.reveal;
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Enter') { e.preventDefault(); onNext(); } };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onNext]);

  return (
    <div className="card">
      <div style={{ color: result.correct ? 'var(--ok)' : 'var(--bad)', fontSize: 14, marginBottom: 10 }}>
        {result.correct
          ? result.shaky ? '✓ Đúng — nhưng hơi chậm, sẽ gặp lại sớm' : '✓ Đúng'
          : result.errorType === 'homophone_wrong_char'
            ? '✗ Đúng âm, sai chữ — đây đúng là lỗi cần chữa'
            : result.errorType === 'meaning_wrong' ? '✗ Chọn sai nghĩa'
            : result.errorType === 'blank' ? '✗ Bỏ trống' : '✗ Sai'}
      </div>

      {result.comparison && (
        <div className="vs" style={{ marginBottom: 18 }}>
          <div className="wrong">
            <div className="tag">bạn gõ</div>
            <div className="hz">{result.comparison.typed.hanzi}</div>
            <div className="py">{result.comparison.typed.pinyin}</div>
            {result.comparison.typed.hanviet && <div className="hv">{result.comparison.typed.hanviet}</div>}
            <div style={{ marginTop: 8 }}>{result.comparison.typed.meaning_vi}</div>
            <div className="pos">bộ {result.comparison.typed.radical}</div>
          </div>
          <div className="right">
            <div className="tag">đúng là</div>
            <div className="hz">{result.comparison.correct.hanzi}</div>
            <div className="py">{result.comparison.correct.pinyin}</div>
            {result.comparison.correct.hanviet && <div className="hv">{result.comparison.correct.hanviet}</div>}
            <div style={{ marginTop: 8 }}>{result.comparison.correct.meaning_vi}</div>
            <div className="pos">bộ {result.comparison.correct.radical}</div>
          </div>
        </div>
      )}

      {!result.comparison && (
        <div className="row">
          <div>
            <div className="hz">{r.hanzi}</div>
            <div className="py">{r.pinyin}</div>
            {r.hanviet && <div className="hv">Hán-Việt: {r.hanviet}</div>}
          </div>
          <div style={{ paddingTop: 6 }}>
            <div style={{ fontSize: 20 }}>{r.meaning_vi}</div>
            <div className="pos">{r.pos_vi} · bộ {r.radical}</div>
            {r.example_zh && (
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 20 }}>{r.example_zh}</div>
                <div className="pos">{r.example_vi}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {result.hint?.value && (
        <div style={{ marginTop: 14, color: 'var(--warn)' }}>
          Mẹo nhớ ({result.hint.kind === 'hanviet' ? 'âm Hán-Việt' : result.hint.kind === 'radical' ? 'bộ thủ' : 'từ loại'}):
          <b> {result.hint.value}</b>
          <div className="pos">{result.hint.why}</div>
        </div>
      )}

      {r.note && <div className="note">{r.note}</div>}

      {!result.correct && result.stillNeeded > 0 && (
        <div className="pos" style={{ marginTop: 14 }}>
          Cổng "{STAGE_LABEL[result.stage] ?? result.stage}" cần đúng thêm {result.stillNeeded} lần nữa.
        </div>
      )}
      {result.correct && !result.justPassed && result.nextStage && (
        <div className="pos" style={{ marginTop: 14 }}>
          Qua cổng này. Tiếp theo: <b>{STAGE_LABEL[result.nextStage] ?? result.nextStage}</b>.
        </div>
      )}
      {result.justPassed && (
        <div style={{ marginTop: 14, color: 'var(--ok)' }}>✓ Từ này đã pass đủ các cổng hôm nay.</div>
      )}

      <div className="actions" style={{ marginTop: 22 }}>
        <button className="primary" onClick={onNext}>Tiếp (Enter)</button>
        <button className="ghost" onClick={onReport}>⚠ Tôi nghĩ tôi đúng</button>
      </div>
    </div>
  );
}

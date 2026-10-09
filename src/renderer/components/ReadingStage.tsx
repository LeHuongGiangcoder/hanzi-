import { useEffect } from 'react';

/**
 * Cổng đọc hiểu: hán tự trần, KHÔNG pinyin, chọn nghĩa đúng.
 *
 * Mồi nhử là từ cùng âm / cùng bộ thủ nên không loại trừ được bằng cảm tính —
 * phải thật sự nhận ra mặt chữ.
 */
export default function ReadingStage({
  hanzi, choices, onPick,
}: { hanzi: string; choices: { i: number; meaning_vi: string }[]; onPick: (i: number) => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const n = Number(e.key);
      if (n >= 1 && n <= choices.length) { e.preventDefault(); onPick(choices[n - 1].i); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [choices, onPick]);

  return (
    <>
      <div className="prompt">
        <div className="ask">Chữ này nghĩa là gì</div>
        <div className="hz big">{hanzi}</div>
      </div>
      <div className="choices">
        {choices.map((c, n) => (
          <button key={c.i} onClick={() => onPick(c.i)}>
            <span className="num">{n + 1}</span>{c.meaning_vi}
          </button>
        ))}
      </div>
      <div className="hintline">Bấm số 1–{choices.length} để chọn nhanh.</div>
    </>
  );
}

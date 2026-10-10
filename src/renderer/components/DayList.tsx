import { useEffect, useState } from 'react';

const DAY = 86400000;
const iso = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const label = (s: string) => {
  const t = iso(new Date());
  const tm = iso(new Date(Date.now() + DAY));
  const y = iso(new Date(Date.now() - DAY));
  if (s === t) return 'Hôm nay';
  if (s === tm) return 'Ngày mai';
  if (s === y) return 'Hôm qua';
  return new Date(s).toLocaleDateString('vi-VN', { weekday: 'long', day: 'numeric', month: 'numeric' });
};

const DOT: Record<string, string> = { passed: '✓', doing: '◐', todo: '○' };

export default function DayList({ onClose }: { onClose?: () => void }) {
  const [date, setDate] = useState(iso(new Date()));
  const [data, setData] = useState<any>(null);
  const [reveal, setReveal] = useState(false);

  useEffect(() => { setData(null); window.hanzi.wordsByDate(date).then(setData); }, [date]);

  const today = iso(new Date());
  const canNext = date < iso(new Date(Date.now() + DAY));
  // Từ của HÔM NAY mà chưa học xong thì che hán tự lại: nhìn thấy đáp án trước
  // khi làm bài thì cổng "tạo ra chữ" không còn kiểm được gì.
  const hidden = (w: any) => date === today && w.status !== 'passed' && !reveal;

  return (
    <div className="daylist">
      <div className="dayhead">
        <button className="ghost" onClick={() => setDate(iso(new Date(new Date(date).getTime() - DAY)))}>←</button>
        <div>
          <b>{label(date)}</b>
          <span>{date}</span>
        </div>
        <button className="ghost" disabled={!canNext}
          onClick={() => canNext && setDate(iso(new Date(new Date(date).getTime() + DAY)))}>→</button>
      </div>

      {!data ? <div className="pos">Đang tải…</div> : (
        <>
          <div className="daymeta">
            {data.kind === 'preview'
              ? <span className="badge">dự kiến · có thể đổi tuỳ kết quả hôm nay</span>
              : <span>{data.passed}/{data.target} đã xong{data.finished ? ' ✓' : ''}</span>}
            {data.words.some((w: any) => hidden(w)) && (
              <button className="ghost" onClick={() => setReveal(true)}>Hiện hán tự</button>
            )}
          </div>

          {!data.words.length && <div className="pos">Ngày này chưa có buổi học nào.</div>}

          <ol className="wordlist">
            {data.words.map((w: any, i: number) => (
              <li key={i} className={w.status}>
                <span className="st">{DOT[w.status]}</span>
                <span className={`hz${hidden(w) ? ' masked' : ''}`}>
                  {hidden(w) ? '　'.repeat([...w.hanzi].length) : w.hanzi}
                </span>
                <span className="py">{hidden(w) ? '' : w.pinyin}</span>
                <span className="mn">{w.meaning_vi}</span>
                <span className="lv">HSK {w.hsk_level}</span>
              </li>
            ))}
          </ol>
        </>
      )}

      {onClose && <button className="primary" onClick={onClose}>Đóng</button>}
    </div>
  );
}

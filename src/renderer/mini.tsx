import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './mini.css';

declare global { interface Window { hanzi: any } }

type P = { passed: number; target: number; done: boolean };

function Mini() {
  const [p, setP] = useState<P>({ passed: 0, target: 20, done: false });

  useEffect(() => {
    window.hanzi.onProgress(setP);
    window.hanzi.stats().then((s: any) => {
      const t = s.today;
      if (t) setP({ passed: t.passed_count, target: t.target_count, done: !!t.finished_at });
    });
  }, []);

  const pct = p.target ? Math.min(100, (p.passed / p.target) * 100) : 0;
  const R = 15, C = 2 * Math.PI * R;

  return (
    <div className={`pill${p.done ? ' done' : ''}`} onClick={() => window.hanzi.openDrill()}>
      <svg width="36" height="36" viewBox="0 0 36 36" className="ring">
        <circle cx="18" cy="18" r={R} className="track" />
        <circle cx="18" cy="18" r={R} className="fill"
          strokeDasharray={C} strokeDashoffset={C - (C * pct) / 100} />
        <text x="18" y="18" className="glyph">汉</text>
      </svg>
      <div className="txt">
        {p.done ? (
          <><b>Xong rồi</b><span>hẹn mai</span></>
        ) : (
          <><b>{p.passed}/{p.target}</b><span>còn {p.target - p.passed} từ</span></>
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Mini />);

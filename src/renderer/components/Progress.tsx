import { useEffect, useState } from 'react';

const LEVELS = [1, 2, 3, 4] as const;

export default function Progress({ onClose }: { onClose?: () => void }) {
  const [s, setS] = useState<any>(null);
  useEffect(() => { window.hanzi.progress().then(setS); }, []);
  if (!s) return <div className="stats">Đang tính…</div>;

  const { all, byLevel } = s;
  const pct = (n: number, d: number) => (d ? (n / d) * 100 : 0);
  const dep = s.pinyinDependency;

  return (
    <div className="stats">
      <div className="goal">
        <div className="ask">Mục tiêu HSK 4</div>
        <div className="big">
          {all.mature.toLocaleString('vi-VN')}
          <small> / {all.total.toLocaleString('vi-VN')} từ đã thuộc</small>
        </div>
        <div className="track">
          <i className="mature" style={{ width: `${pct(all.mature, all.total)}%` }} />
          <i className="learning" style={{ width: `${pct(all.learning, all.total)}%` }} />
        </div>
        <div className="legend">
          <span><b className="dot mature" />{all.mature} đã thuộc</span>
          <span><b className="dot learning" />{all.learning} đang học</span>
          <span><b className="dot fresh" />{all.fresh} chưa học</span>
        </div>
      </div>

      <div className="levels">
        {LEVELS.map((lv) => {
          const d = byLevel[lv] ?? { mature: 0, learning: 0, total: 0 };
          return (
            <div className="lvrow" key={lv}>
              <span className="lv">HSK {lv}</span>
              <div className="track sm">
                <i className="mature" style={{ width: `${pct(d.mature, d.total)}%` }} />
                <i className="learning" style={{ width: `${pct(d.learning, d.total)}%` }} />
              </div>
              <span className="num">{d.mature}/{d.total}</span>
            </div>
          );
        })}
      </div>

      <div className="kpis">
        <div>
          <b className={dep != null && dep > 0.15 ? 'bad' : ''}>
            {dep == null ? '—' : `${(dep * 100).toFixed(1)}%`}
          </b>
          <span>phụ thuộc pinyin</span>
        </div>
        <div><b>{s.streak}</b><span>ngày liên tiếp</span></div>
        <div>
          <b>{s.eta ? `~${s.eta}` : '—'}</b>
          <span>{s.eta ? 'ngày nữa' : 'chưa đủ dữ liệu'}</span>
        </div>
      </div>

      <p className="foot">
        “Đã thuộc” = cả ba cổng đều đạt khoảng ôn {s.matureDays} ngày.
        “Phụ thuộc pinyin” = tỷ lệ lượt gõ <b>đúng âm nhưng sai chữ</b> — con số cần kéo xuống.
      </p>

      {onClose && <button className="primary" onClick={onClose}>Đóng</button>}
    </div>
  );
}

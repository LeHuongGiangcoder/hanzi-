import { useState } from 'react';

const FIELDS = [
  { v: 'grading', label: 'App chấm sai — tôi nghĩ tôi đúng' },
  { v: 'hanzi', label: 'Hán tự sai' },
  { v: 'pinyin', label: 'Pinyin sai' },
  { v: 'meaning_vi', label: 'Nghĩa tiếng Việt sai' },
  { v: 'example', label: 'Câu ví dụ sai' },
  { v: 'other', label: 'Khác' },
];

export default function ReportDialog({
  defaultField, appValue, onClose, onSend,
}: {
  defaultField: string; appValue: string;
  onClose: () => void;
  onSend: (p: { field: string; correction: string; reason: string }) => void;
}) {
  const [field, setField] = useState(defaultField);
  const [correction, setCorrection] = useState('');
  const [reason, setReason] = useState('');

  return (
    <div className="modal" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0 }}>Báo lỗi</h2>
        <p style={{ color: 'var(--dim)', fontSize: 14, marginTop: -6 }}>
          {field === 'grading'
            ? 'Card sẽ được cho qua ngay, không tính là sai.'
            : 'Từ này sẽ bị rút khỏi phiên hôm nay và được bù bằng từ khác — bạn vẫn đủ chỉ tiêu.'}
        </p>

        <label>Sai ở đâu</label>
        <select value={field} onChange={(e) => setField(e.target.value)}>
          {FIELDS.map((f) => <option key={f.v} value={f.v}>{f.label}</option>)}
        </select>

        {field !== 'grading' && (
          <>
            <label>Sửa thành (không bắt buộc)</label>
            <input className="txt" value={correction} onChange={(e) => setCorrection(e.target.value)} />
          </>
        )}

        <label>Lý do (không bắt buộc)</label>
        <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />

        <div className="actions" style={{ marginTop: 20, justifyContent: 'flex-end' }}>
          <button className="ghost" onClick={onClose}>Huỷ</button>
          <button className="primary" onClick={() => onSend({ field, correction, reason })}>Gửi</button>
        </div>
        <p style={{ color: 'var(--dim)', fontSize: 12, marginBottom: 0 }}>
          App đang hiển thị: <code>{appValue || '—'}</code>
        </p>
      </div>
    </div>
  );
}

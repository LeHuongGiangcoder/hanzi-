import { useEffect, useRef, useState } from 'react';
import { decideEnter } from '../../core/ime-submit.mjs';

/**
 * Ô nhập hán tự qua IME.
 *
 * Hai việc phải tách rời:
 *   1. Enter CHỐT CHỮ đang ghép trong IME
 *   2. Enter NỘP BÀI
 *
 * Nếu gộp làm một thì bộ gõ chốt chữ phổ biến nhất ("zai" → 在) và app nộp luôn
 * chữ đó, bạn không kịp thấy nó đã chọn gì. Quyết định nằm ở core/ime-submit.mjs
 * và có test riêng.
 */
export default function ImeInput({
  onSubmit, disabled, bad, expectedLength,
}: { onSubmit: (v: string) => void; disabled?: boolean; bad?: boolean; expectedLength?: number }) {
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const [nudge, setNudge] = useState(false);
  const endedAt = useRef(-1);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!disabled) ref.current?.focus(); }, [disabled]);
  useEffect(() => { if (disabled) { setValue(''); endedAt.current = -1; } }, [disabled]);

  const send = () => {
    if (!value.trim()) return;
    onSubmit(value);
    setValue('');
    endedAt.current = -1;
    setNudge(false);
  };

  const HAN = /[㐀-䶿一-鿿]/;
  const ready = !composing && HAN.test(value);

  return (
    <>
      <input
        ref={ref}
        className={`ime${composing ? ' composing' : ''}${bad ? ' bad' : ''}`}
        value={value}
        disabled={disabled}
        spellCheck={false}
        autoComplete="off"
        lang="zh-CN"
        placeholder={expectedLength ? '　'.repeat(expectedLength) : ''}
        onChange={(e) => setValue(e.target.value)}
        onCompositionStart={() => {
          setComposing(true); setNudge(false);
          (window as any).hanzi?.composing?.(true);
        }}
        onCompositionEnd={(e) => {
          setComposing(false);
          endedAt.current = Date.now();
          setValue((e.target as HTMLInputElement).value);
          (window as any).hanzi?.composing?.(false);
        }}
        onPaste={(e) => e.preventDefault()}   // không cho dán đáp án từ chỗ khác
        onKeyDown={(e) => {
          if (e.key === 'Escape') { setValue(''); endedAt.current = -1; return; }
          if (e.key !== 'Enter') return;
          const d = decideEnter({
            isComposing: (e.nativeEvent as any).isComposing,
            composingState: composing,
            msSinceCompositionEnd: endedAt.current < 0 ? -1 : Date.now() - endedAt.current,
            withModifier: e.metaKey || e.ctrlKey,
            value,
          });
          if (d.submit) { e.preventDefault(); send(); return; }
          if (d.reason === 'just_committed') {
            // Chính là lần Enter vừa chốt chữ trong IME. Nuốt nó và nhắc một
            // câu, để bạn kịp nhìn xem bộ gõ đã chọn đúng chữ chưa.
            e.preventDefault();
            setNudge(true);
          }
        }}
      />

      {ready ? (
        <div className="confirm">
          <span className="tag">sẽ nộp</span>
          <span className="hz-preview">{value}</span>
          <button className="primary" onClick={send}>Nộp (Enter)</button>
          <button className="ghost" onClick={() => { setValue(''); endedAt.current = -1; }}>Xoá (Esc)</button>
        </div>
      ) : (
        expectedLength ? <div className="slots">{'_'.repeat(expectedLength)}</div> : null
      )}

      {nudge && (
        <div className="nudge">
          Bộ gõ vừa chốt <b>{value}</b> — kiểm lại xem có đúng chữ bạn định viết không,
          rồi Enter lần nữa để nộp. Chọn chữ khác trong danh sách gợi ý bằng phím số <b>1–9</b>.
        </div>
      )}
    </>
  );
}

import { useEffect, useRef, useState } from 'react';

/**
 * Ô nhập hán tự qua IME.
 *
 * Điểm mấu chốt: trong lúc IME đang ghép chữ (composition), chuỗi trong input là
 * pinyin dở dang. Nếu chấm theo onChange thì app sẽ chấm lúc bạn mới gõ "xu".
 * Nên mọi thao tác chấm đều bị khoá cho tới compositionend.
 */
export default function ImeInput({
  onSubmit, disabled, bad, expectedLength,
}: { onSubmit: (v: string) => void; disabled?: boolean; bad?: boolean; expectedLength?: number }) {
  const [value, setValue] = useState('');
  const [composing, setComposing] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => { if (!disabled) ref.current?.focus(); }, [disabled]);
  useEffect(() => { if (disabled) setValue(''); }, [disabled]);

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
        onCompositionStart={() => setComposing(true)}
        onCompositionEnd={(e) => { setComposing(false); setValue((e.target as HTMLInputElement).value); }}
        // Chặn dán: không cho copy đáp án từ chỗ khác vào.
        onPaste={(e) => e.preventDefault()}
        onKeyDown={(e) => {
          if (e.key !== 'Enter') return;
          // Enter trong lúc đang ghép chữ là để CHỌN chữ trong bảng IME,
          // không phải để nộp bài. e.nativeEvent.isComposing bắt đúng ca này.
          if (composing || (e.nativeEvent as any).isComposing) return;
          e.preventDefault();
          if (!value.trim()) return;
          onSubmit(value);
          setValue('');
        }}
      />
      {expectedLength ? <div className="slots">{'_'.repeat(expectedLength)}</div> : null}
    </>
  );
}

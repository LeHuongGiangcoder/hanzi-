import ImeInput from './ImeInput';

/**
 * Cổng điền vào chỗ trống: gõ hán tự đúng vào câu ví dụ.
 *
 * Đây cũng là cổng ĐẦU TIÊN của trợ từ (的, 了, 吗, 吧, 着): bắt gõ 吧 từ prompt
 * "trợ từ đề nghị" là kiểm tra cách diễn đạt của người soạn, không phải kiểm tra
 * bạn có nhớ mặt chữ hay không.
 */
export default function ClozeStage({
  cloze, meaning, expectedLength, onSubmit, bad,
}: {
  cloze: { before: string; after: string; blankLength: number; translation: string };
  meaning: string; expectedLength: number;
  onSubmit: (v: string) => void; bad?: boolean;
}) {
  return (
    <>
      <div className="prompt">
        <div className="ask">Điền vào chỗ trống</div>
        <div className="sentence">
          {cloze.before}
          <span className="blank">{'＿'.repeat(cloze.blankLength)}</span>
          {cloze.after}
        </div>
        {cloze.translation && <div className="pos">{cloze.translation}</div>}
        <div className="pos" style={{ marginTop: 10 }}>Từ cần điền nghĩa là: <b>{meaning}</b></div>
      </div>
      <ImeInput onSubmit={onSubmit} expectedLength={expectedLength} bad={bad} />
    </>
  );
}

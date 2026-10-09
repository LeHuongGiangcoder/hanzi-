// Quyết định một lần nhấn Enter là CHỐT CHỮ trong IME hay NỘP BÀI.
//
// Vì sao cần tách: bộ gõ tiếng Trung trên macOS dùng Enter để chốt chữ đang
// ghép. Nếu app cũng nộp bài khi thấy Enter thì một phím làm hai việc, và bạn
// mất luôn cơ hội nhìn xem IME đã chọn chữ nào — nó mặc định chọn chữ phổ biến
// nhất, nên gõ "zai" sẽ luôn ra 在 dù bạn đang cần 再.
//
// Không dựa vào event.isComposing được: thứ tự compositionend và keydown khác
// nhau giữa các bộ gõ. Đã đo trong app: macOS bắn compositionend TRƯỚC, nên lúc
// keydown chạy thì isComposing đã là false và guard không bắt được.
// Vì vậy dùng thêm một cửa sổ thời gian sau compositionend.

export const COMPOSITION_GUARD_MS = 250;

/**
 * @param {object} p
 * @param {boolean} p.isComposing          event.nativeEvent.isComposing
 * @param {boolean} p.composingState       cờ composing của component
 * @param {number}  p.msSinceCompositionEnd  -1 nếu chưa từng ghép chữ
 * @param {boolean} p.withModifier         có giữ ⌘ hoặc Ctrl không
 * @param {string}  p.value
 * @param {number} [p.guardMs]
 * @returns {{submit: boolean, reason: string}}
 */
export function decideEnter({
  isComposing, composingState, msSinceCompositionEnd,
  withModifier, value, guardMs = COMPOSITION_GUARD_MS,
}) {
  if (!String(value ?? '').trim()) return { submit: false, reason: 'empty' };
  // ⌘Enter không bao giờ bị IME nuốt → luôn là ý định nộp bài.
  if (withModifier) return { submit: true, reason: 'modifier' };
  if (isComposing || composingState) return { submit: false, reason: 'composing' };
  if (msSinceCompositionEnd >= 0 && msSinceCompositionEnd < guardMs)
    return { submit: false, reason: 'just_committed' };
  return { submit: true, reason: 'enter' };
}

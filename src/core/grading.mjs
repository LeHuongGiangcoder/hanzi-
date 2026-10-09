// Chấm câu trả lời gõ bằng IME và phân loại lỗi.
//
// Phân loại lỗi là phần quan trọng nhất của file này: lỗi "pinyin đúng, hán tự sai"
// phải được đếm RIÊNG, vì nó chính là thước đo tật phụ thuộc pinyin.
import { pinyin } from 'pinyin-pro';
import { toneless } from '../../scripts/lib/py.mjs';

/** Chuẩn hoá đầu vào IME: NFC + bỏ khoảng trắng (kể cả khoảng trắng toàn rộng). */
export function normalizeAnswer(s) {
  return String(s ?? '')
    .normalize('NFC')
    .replace(/[\s　]+/g, '')
    .trim();
}

const HAS_HAN = /[㐀-䶿一-鿿]/;
const ALL_LATIN = /^[a-zA-Z0-9'"\-.,?!]+$/;

export const SHAKY_MS = 8000;

/**
 * @param {string} raw      chuỗi người dùng gõ
 * @param {string} target   hán tự đúng
 * @param {number} latencyMs
 * @returns {{correct:boolean, errorType:string, grade:number, shaky:boolean,
 *            answer:string, answerPinyin:string, sameSound:boolean, imeOff:boolean}}
 */
export function gradeAnswer(raw, target, latencyMs = 0) {
  const answer = normalizeAnswer(raw);
  const want = normalizeAnswer(target);
  const shaky = latencyMs > SHAKY_MS;

  if (!answer) {
    return { correct: false, errorType: 'blank', grade: 1, shaky, answer, answerPinyin: '', sameSound: false, imeOff: false };
  }

  // Gõ ra toàn chữ Latin = chưa bật IME tiếng Trung. Không tính là sai kiến thức.
  if (!HAS_HAN.test(answer) && ALL_LATIN.test(answer)) {
    return { correct: false, errorType: 'ime_off', grade: 1, shaky, answer, answerPinyin: '', sameSound: false, imeOff: true };
  }

  if (answer === want) {
    // Đúng nhưng chậm thì chưa thuộc chắc — hạ xuống Hard để FSRS lên lịch dày hơn.
    return { correct: true, errorType: 'none', grade: shaky ? 2 : 3, shaky, answer, answerPinyin: '', sameSound: false, imeOff: false };
  }

  // Sai: âm của chuỗi vừa gõ có trùng âm của đáp án không?
  const answerPinyin = pinyin(answer, { toneType: 'symbol' });
  const sameSound = toneless(answerPinyin) === toneless(pinyin(want, { toneType: 'symbol' }));

  return {
    correct: false,
    errorType: sameSound ? 'homophone_wrong_char' : 'wrong_char',
    grade: 1,
    shaky,
    answer,
    answerPinyin,
    sameSound,
    imeOff: false,
  };
}

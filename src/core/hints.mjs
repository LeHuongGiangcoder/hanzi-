// Luật chọn gợi ý khi trả lời sai.
//
// Cơ sở: đo trên 106 nhóm đồng âm của HSK 1-4 cho thấy âm Hán-Việt phân biệt được
// 86% số nhóm hoàn toàn và 98% ít nhất một phần; đúng 2 nhóm thất bại (他/她/它,
// 下/夏) thì bộ thủ phân biệt được. Nên: Hán-Việt trước, bộ thủ làm lưới đỡ.

/**
 * @param {object} word       từ đúng
 * @param {object[]} siblings các từ cùng âm
 */
export function pickHint(word, siblings = []) {
  const group = [word, ...siblings];

  if (word.hanviet) {
    const allHaveHv = group.every((w) => w.hanviet);
    const distinct = new Set(group.map((w) => w.hanviet)).size === group.length;
    if (!siblings.length || (allHaveHv && distinct))
      return { kind: 'hanviet', value: word.hanviet, why: 'âm Hán-Việt gắn với mặt chữ, không đi qua pinyin' };
  }

  if (word.radical) {
    const distinctRad = new Set(group.map((w) => w.radical)).size === group.length;
    if (distinctRad)
      return { kind: 'radical', value: word.radical, why: 'các từ cùng âm này khác nhau ở bộ thủ' };
  }

  if (word.pos_vi) return { kind: 'pos', value: word.pos_vi, why: 'từ loại' };
  return { kind: 'none', value: '', why: '' };
}

/**
 * Màn hình đối chiếu khi gõ nhầm sang một chữ đồng âm — đây là lúc việc học
 * thật sự diễn ra, nên phải hiện cả hai chữ cạnh nhau chứ không chỉ báo "sai".
 */
export function buildComparison(word, typedWord) {
  if (!typedWord) return null;
  return {
    typed: {
      hanzi: typedWord.hanzi, pinyin: typedWord.pinyin,
      hanviet: typedWord.hanviet, meaning_vi: typedWord.meaning_vi, radical: typedWord.radical,
    },
    correct: {
      hanzi: word.hanzi, pinyin: word.pinyin,
      hanviet: word.hanviet, meaning_vi: word.meaning_vi, radical: word.radical,
    },
    differsBy:
      word.hanviet && typedWord.hanviet && word.hanviet !== typedWord.hanviet
        ? 'hanviet'
        : word.radical !== typedWord.radical
          ? 'radical'
          : 'meaning',
  };
}

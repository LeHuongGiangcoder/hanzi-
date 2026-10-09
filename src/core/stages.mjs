// Ba cổng mà một từ phải vượt qua mới được tính là PASS trong ngày.
//
//   production : nghĩa tiếng Việt → gõ hán tự bằng IME   (tạo ra chữ)
//   reading    : hán tự trần, KHÔNG pinyin → chọn nghĩa   (đọc hiểu)
//   cloze      : câu ví dụ khoét chỗ trống → gõ hán tự    (dùng trong ngữ cảnh)
//
// Thứ tự cố ý: bắt TẠO RA chữ trước rồi mới kiểm đọc hiểu. Nhận ra chữ dễ hơn
// viết ra chữ rất nhiều, nên nhận diện không bao giờ được tính là pass.

export const STAGES = ['production', 'reading', 'cloze'];

/** Trợ từ và hư từ: không có nghĩa độc lập nên hỏi "nghĩa → viết chữ" là gượng. */
export function isFunctionWord(word) {
  const pos = (word.pos_vi ?? '').toLowerCase();
  return pos.includes('trợ từ') || pos.includes('thán từ');
}

export function hasCloze(word) {
  return !!word.example_zh && word.example_zh.includes(word.hanzi);
}

/**
 * Các cổng áp dụng cho một từ.
 *
 * Với trợ từ (的, 了, 吗, 呢, 吧, 着) thì BỎ cổng production và cho đi thẳng vào
 * cloze: bắt gõ 吧 từ prompt "trợ từ đề nghị" là bài kiểm tra về cách diễn đạt
 * của tôi, không phải về việc bạn có nhớ mặt chữ hay không. Điền vào chỗ trống
 * trong câu mới đúng bản chất của nhóm từ này.
 */
export function stagesFor(word) {
  const cloze = hasCloze(word);
  if (isFunctionWord(word) && cloze) return ['cloze', 'reading'];
  return cloze ? ['production', 'reading', 'cloze'] : ['production', 'reading'];
}

/** Khoét chỗ trống đúng MỘT lần xuất hiện đầu tiên của từ trong câu. */
export function buildCloze(word) {
  if (!hasCloze(word)) return null;
  const at = word.example_zh.indexOf(word.hanzi);
  const len = [...word.hanzi].length;
  return {
    before: word.example_zh.slice(0, at),
    after: word.example_zh.slice(at + word.hanzi.length),
    blankLength: len,
    answer: word.hanzi,
    translation: word.example_vi ?? '',
  };
}

/**
 * Bốn lựa chọn cho cổng đọc hiểu.
 *
 * Mồi nhử KHÔNG lấy ngẫu nhiên: ưu tiên từ cùng âm, rồi tới từ cùng bộ thủ,
 * rồi mới tới cùng cấp. Mồi ngẫu nhiên thì chỉ cần loại trừ là đoán ra, không
 * kiểm được gì; mồi cùng âm thì ép bạn thật sự nhận ra mặt chữ.
 */
export function buildChoices(word, pools, { count = 4, rand = Math.random } = {}) {
  const picked = [];
  const seen = new Set([word.hanzi]);
  const take = (list) => {
    for (const w of list) {
      if (picked.length >= count - 1) return;
      if (seen.has(w.hanzi) || !w.meaning_vi) continue;
      if (w.meaning_vi === word.meaning_vi) continue;   // mồi trùng nghĩa là vô nghĩa
      seen.add(w.hanzi);
      picked.push(w);
    }
  };
  take(pools.homophones ?? []);
  take(pools.sameRadical ?? []);
  take(pools.sameLevel ?? []);

  const options = [...picked, word].map((w) => ({
    hanzi: w.hanzi,
    meaning_vi: w.meaning_vi,
    correct: w.hanzi === word.hanzi,
  }));
  // xáo trộn
  for (let i = options.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [options[i], options[j]] = [options[j], options[i]];
  }
  return options;
}

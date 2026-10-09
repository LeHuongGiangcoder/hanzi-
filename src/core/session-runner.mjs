// Luật "pass đủ 20" bên trong một phiên học.
//
// Một từ chỉ PASS khi vượt qua HẾT các cổng của nó (production → reading → cloze).
// Sai ở cổng nào thì phải làm đúng cổng đó thêm REQUEUE_CORRECT lần nữa, với ít
// nhất MIN_GAP lượt khác chen vào giữa — để bạn không trả lời đúng chỉ vì vừa
// mới nhìn thấy đáp án.
//
// Lớp này là máy trạng thái thuần, không đụng DB, nên test được trực tiếp.

export const MIN_GAP = 3;
export const REQUEUE_CORRECT = 2;

export class SessionRunner {
  constructor(items, { minGap = MIN_GAP, requeueCorrect = REQUEUE_CORRECT } = {}) {
    this.minGap = minGap;
    this.requeueCorrect = requeueCorrect;
    this.served = 0;
    this.state = new Map();
    this.queue = [];
    for (const it of items) {
      this.state.set(it.id, {
        word: it,
        stages: it.stages?.length ? [...it.stages] : ['production'],
        stageIdx: 0,
        needed: 1,          // số lần đúng còn phải đạt Ở CỔNG HIỆN TẠI
        wrongCount: 0,
        passed: false,
        removed: false,
        notBefore: 0,       // chỉ được phục vụ lại khi served >= giá trị này
      });
      this.queue.push(it.id);
    }
  }

  get total() { return [...this.state.values()].filter((s) => !s.removed).length; }
  get passedCount() { return [...this.state.values()].filter((s) => s.passed).length; }
  get done() { return this.total > 0 && this.passedCount >= this.total; }

  /** Cổng hiện tại của một từ. */
  stageOf(wordId) {
    const s = this.state.get(wordId);
    return s ? s.stages[s.stageIdx] : null;
  }

  /** Từ tiếp theo nên hỏi, kèm cổng; null nếu đã xong. */
  next() {
    if (this.done) return null;
    const ready = this.queue.filter((id) => {
      const s = this.state.get(id);
      return s && !s.passed && !s.removed && this.served >= s.notBefore;
    });
    // Chưa từ nào hết thời gian giãn cách → lấy từ gần hết nhất, không đứng im.
    const pool = ready.length
      ? ready
      : this.queue.filter((id) => {
          const s = this.state.get(id);
          return s && !s.passed && !s.removed;
        });
    if (!pool.length) return null;
    if (!ready.length) {
      // Chưa từ nào hết giãn cách: lấy từ gần hết nhất chứ không đứng im.
      pool.sort((a, b) => this.state.get(a).notBefore - this.state.get(b).notBefore);
    } else {
      // Từ đã từng sai, vừa hết giãn cách, được ưu tiên hơn từ chưa hỏi lần nào.
      // Nếu đẩy nó xuống cuối hàng thì phải chờ hết 19 từ kia mới gặp lại — quá xa
      // để việc học lại còn dính vào trí nhớ ngắn hạn.
      pool.sort((a, b) => {
        const A = this.state.get(a), B = this.state.get(b);
        return (B.wrongCount > 0) - (A.wrongCount > 0);
      });
    }
    const s = this.state.get(pool[0]);
    return { ...s.word, stage: s.stages[s.stageIdx], stageIndex: s.stageIdx, stageCount: s.stages.length };
  }

  /** Ghi kết quả một lượt. Trả về trạng thái mới của từ đó. */
  answer(wordId, correct) {
    const s = this.state.get(wordId);
    if (!s || s.removed || s.passed) return null;
    this.served++;
    this.queue = this.queue.filter((id) => id !== wordId);

    if (correct) {
      s.needed -= 1;
      if (s.needed <= 0) {
        s.stageIdx += 1;              // qua cổng này, sang cổng kế
        s.needed = 1;
        if (s.stageIdx >= s.stages.length) {
          s.passed = true;
          return { ...s, justPassed: true, clearedStage: true };
        }
        // Cổng kế cũng phải giãn cách như khi trả lời sai.
        //
        // Ban đầu tôi cho hỏi cổng kế ngay, lập luận rằng nó kiểm một kỹ năng
        // khác. Sai: nếu vừa gõ xong 的 và vừa nhìn thấy đáp án, thì cổng đọc
        // hiểu ngay sau đó được trả lời bằng trí nhớ tức thời chứ không phải
        // bằng cái đã thuộc — nó không kiểm được gì, chỉ làm buổi học dài ra.
        s.notBefore = this.served + this.minGap;
        this.queue.push(wordId);
        return { ...s, justPassed: false, clearedStage: true };
      }
    } else {
      s.wrongCount += 1;
      s.needed = this.requeueCorrect;
    }
    s.notBefore = this.served + this.minGap;
    this.queue.push(wordId);
    return { ...s, justPassed: false };
  }

  /** Báo lỗi dữ liệu → rút từ khỏi phiên ngay, và nhận từ thay thế nếu có. */
  removeAndReplace(wordId, replacement = null) {
    const s = this.state.get(wordId);
    if (s) { s.removed = true; s.passed = false; }
    this.queue = this.queue.filter((id) => id !== wordId);
    if (replacement) {
      this.state.set(replacement.id, {
        word: replacement,
        stages: replacement.stages?.length ? [...replacement.stages] : ['production'],
        stageIdx: 0, needed: 1, wrongCount: 0,
        passed: false, removed: false, notBefore: this.served,
      });
      this.queue.push(replacement.id);
    }
    return { total: this.total, passed: this.passedCount };
  }

  progress() {
    return { passed: this.passedCount, total: this.total, served: this.served, done: this.done };
  }
}

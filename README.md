# hanzi-drill

Trợ lý ôn từ vựng tiếng Trung HSK 1–4 chạy trên macOS. Mỗi ngày bật lên 20 từ và
**không đóng được cho tới khi pass hết 20 từ**.

Mục tiêu cụ thể: chữa tật phụ thuộc pinyin mà không nhớ mặt chữ. Vì vậy:

- **Pinyin là phần thưởng, không phải gợi ý** — chỉ hiện sau khi đã trả lời.
- **Phải tự tạo ra chữ** (gõ hán tự bằng IME) trước khi được kiểm tra khả năng đọc hiểu.
- **Bẫy đồng âm**: app cố tình xếp các từ cùng âm vào cùng phiên (的/得, 在/再, 买/卖,
  他/她/它, 请/晴). Chỉ nhớ âm thì sẽ trượt.
- **Lỗi "pinyin đúng, hán tự sai" được đếm riêng** → đây là thước đo tiến bộ chính.

## Trạng thái

- [x] Phase 0 — pipeline dữ liệu: 1193 từ HSK 1–4, pinyin đã kiểm 3 nguồn, nhóm đồng âm
- [ ] Phase 0b — nghĩa tiếng Việt + câu ví dụ
- [ ] Phase 1 — Electron app: scheduler, SQLite, FSRS, cổng gõ IME, luật pass-20
- [ ] Phase 2 — stage đọc + cloze, màn hình đối chiếu đồng âm, phân loại lỗi
- [ ] Phase 3 — dashboard, streak, xử lý từ hay sai
- [ ] Phase 4 (tuỳ) — viết tay trackpad, luyện nghe

## Pipeline dữ liệu

```bash
npm run data:fetch   # tải nguồn về data/source/
npm run data:build   # gộp 3 nguồn → data/seed.hsk1-4.json + review-pinyin.md
npm run data:qa      # kiểm toàn vẹn → char-whitelist.json + homophones.json
npm run data:all     # cả ba

node scripts/4-export-sheet.mjs 1 2   # → data/sheet-hsk12.csv (đúng cột Google Sheet)
```

### Nguồn và lý do chọn

| Nguồn | Dùng cho | Ghi chú |
|---|---|---|
| [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) | hán tự, phồn thể, level HSK, bộ thủ, từ loại, hạng tần suất, nghĩa EN | MIT; dữ liệu từ CC-CEDICT. Dùng `wordlists/exclusive/old/{1..4}.json` = HSK 2.0, không lặp từ giữa các level |
| `pinyin-pro` | **thẩm quyền pinyin cho hán tự đơn** | Chọn âm theo từ điển tần suất |
| [`lxaw/hsk-infinite`](https://github.com/lxaw/hsk-infinite) | chỉ để cross-check | Thực chất là app luyện đề thi (5269 mp3). `site/vocab.json` cùng gốc CC-CEDICT nên **không độc lập** |

### Quy tắc chọn pinyin — và tại sao cần nó

Cả hai repo đều sắp các âm đọc của một chữ **theo thứ tự alphabet, không theo tần suất**.
Nên `forms[0]` sai hệ thống ở từ đa âm: 看→`kān`, 读→`dòu`, 吗→`má`, 个→`gě`. Vì hai repo
cùng gốc CC-CEDICT, chúng **sai giống nhau** → cross-check hai nguồn không phát hiện được.

Mặt khác `pinyin-pro` lại trả thanh gốc từng chữ cho từ nhiều âm tiết, trong khi giáo trình
in thanh nhẹ: 名字 `míngzi`, 朋友 `péngyou`, 谢谢 `xièxie`.

Thứ tự thẩm quyền rút ra từ đó:

1. `data/overrides.pinyin.json` — quyết định tay, có ghi lý do
2. **hán tự đơn** → `pinyin-pro`
3. **từ nhiều âm tiết** → nguồn A, nhưng chỉ nhận form trùng âm với `pinyin-pro`
   (để không kéo theo lỗi thứ tự alphabet), ưu tiên form có thanh nhẹ

Khâu chọn form còn phải tránh nhánh tên riêng và nhánh nghĩa cổ của CC-CEDICT, nếu không
cột nghĩa bị nhiễm: 汤 → "surname Tang", 只 → "grain that has begun to ripen".

Kết quả: 1193 từ, **0 lỗi chặn**, 3 ca lệch `pinyin-pro` đều là override có chủ ý.
Vùng rủi ro đã soi tay: 33 hán tự đơn nhiều âm + 32 hán tự đơn nhiều thanh → 9 từ cần override.

### File sinh ra

| File | Nội dung |
|---|---|
| `data/seed.hsk1-4.json` | 1193 từ, kèm `_sources` để audit lại từng quyết định pinyin |
| `data/review-pinyin.md` | các ca máy không tự quyết được |
| `data/homophones.json` | 106 nhóm đồng âm → app dùng làm bẫy và làm distractor |
| `data/char-whitelist.json` | hán tự theo từng level (178 / 346 / 618 / 1071) → validate câu ví dụ theo nguyên tắc i+1 |
| `data/sheet-hsk*.csv` | CSV đúng thứ tự cột Google Sheet |

`data/source/` không commit — chạy `npm run data:fetch` để tải lại.

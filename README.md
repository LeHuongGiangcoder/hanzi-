# hanzi-drill

Trợ lý ôn từ vựng tiếng Trung HSK 1–4 chạy trên macOS. Mỗi ngày bật lên 20 từ và
**không đóng được cho tới khi pass hết 20 từ**.

Mục tiêu cụ thể: chữa tật phụ thuộc pinyin mà không nhớ mặt chữ. Vì vậy:

- **Pinyin là phần thưởng, không phải gợi ý** — chỉ hiện sau khi đã trả lời.
- **Phải tự tạo ra chữ** (gõ hán tự bằng IME) trước khi được kiểm tra khả năng đọc hiểu.
- **Bẫy đồng âm**: app cố tình xếp các từ cùng âm vào cùng phiên (的/得, 在/再, 买/卖,
  他/她/它, 请/晴). Chỉ nhớ âm thì sẽ trượt.
- **Lỗi "pinyin đúng, hán tự sai" được đếm riêng** → đây là thước đo tiến bộ chính.
- **Dùng âm Hán-Việt làm kênh ghi nhớ thứ hai** — xem bên dưới.

## Trạng thái

- [x] Phase 0 — pipeline dữ liệu: 1193 từ HSK 1–4, pinyin đã kiểm 3 nguồn, nhóm đồng âm
- [x] Phase 0a — Google Sheet (tab `words` + `_reports`), validator sync, vòng báo lỗi
- [x] Phase 0b — nghĩa tiếng Việt + âm Hán-Việt: **1193/1193 từ** (Hán-Việt 1146)
- [ ] Phase 0c — câu ví dụ (1193 từ, có validator i+1)
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

npm run data:validate -- dump.json    # kiểm dòng đọc từ Sheet trước khi nạp vào deck
npm run data:reports  -- reports.json # xử lý báo lỗi → overrides + việc cần làm tay
```

## Âm Hán-Việt: kênh ghi nhớ đi tắt qua pinyin

Người Việt học tiếng Trung có một lợi thế mà người học tiếng Anh không có: **âm Hán-Việt
gắn với mặt chữ, không gắn với phát âm tiếng Phổ thông.** 医院 = y viện, 学生 = học sinh,
电影 = điện ảnh. Đúng là một đường từ hán tự sang nghĩa **không đi qua pinyin** — tức nhắm
thẳng vào vấn đề mà app này tồn tại để giải quyết.

Mạnh hơn thế: **với nhiều cặp đồng âm tiếng Trung, âm Hán-Việt lại khác nhau.**

| Cùng pinyin | Âm Hán-Việt | Phân biệt được? |
|---|---|---|
| 坐 / 做 — `zuò` | tọa / tố | ✅ |
| 十 / 是 — `shì` | thập / thị | ✅ |
| 回 / 会 — `huì` | hồi / hội | ✅ |
| 他 / 她 — `tā` | tha / tha | ❌ — nhưng khác **bộ thủ** (人 / 女) |

Đo trên **toàn bộ 106 nhóm đồng âm** của HSK 1–4 (91 nhóm đủ dữ liệu Hán-Việt):

| Mức phân biệt | Số nhóm | Tỷ lệ |
|---|---|---|
| Hán-Việt phân biệt **hoàn toàn** | 78 | 86% |
| phân biệt **một phần** | 11 | 12% |
| Hán-Việt **trùng hết** | 2 | 2% |

**98% các nhóm đồng âm được Hán-Việt phân biệt ít nhất một phần.** Và đúng 2 nhóm thất bại
— `他/她/它` (đều "tha") và `下/夏` (đều "hạ") — thì **bộ thủ phân biệt được cả hai**
(人/女/宀 và 一/夂).

Nên luật hiển thị gợi ý khi bạn trả lời sai là: **ưu tiên âm Hán-Việt nếu nó khác nhau
trong nhóm đồng âm, rơi về bộ thủ nếu Hán-Việt trùng.** Hai cơ chế này phủ kín 100% các
nhóm đồng âm trong kho từ.

Cột `hanviet` **chỉ điền khi âm Hán-Việt thật sự giúp nhớ**. Ở trợ từ, từ khẩu ngữ và từ
phiên âm (的, 了, 吗, 很, 吃, 喝, 这, 咖啡, 沙发, 巧克力…) nó để trống — bản thân việc trống
đã là tín hiệu "đừng trông vào Hán-Việt ở từ này". Toàn kho: 1146/1193 từ được điền.

### Bẫy Hán-Việt

Hán-Việt cũng gài bẫy, và những ca đó được ghi thẳng vào cột `note`:

| Từ | Âm Hán-Việt | Nghĩa thật trong tiếng Trung |
|---|---|---|
| 博士 | bác sĩ | **tiến sĩ** (bác sĩ chữa bệnh là 医生/大夫) |
| 访问 | phỏng vấn | **thăm viếng** (phỏng vấn lấy tin là 采访) |
| 入口 | nhập khẩu | **lối vào** (nhập khẩu hàng là 进口) |
| 仔细 | tử tế | **cẩn thận, tỉ mỉ** |
| 专业 | chuyên nghiệp | **chuyên ngành** |

## Báo lỗi dữ liệu

Kho từ dựng từ CC-CEDICT nên sẽ có lỗi, và lỗi trong app này độc hơn bình thường: một chữ
sai sẽ được chính cơ chế spaced repetition dạy đi dạy lại hàng tháng. Nên app có nút
`⚠ Báo lỗi` (⌘E) ở mọi bước, và báo lỗi **có hiệu lực ngay**: từ bị nghi sai được rút khỏi
phiên học và bù từ khác vào, chứ không chờ tới lúc sửa xong.

Thiết kế đầy đủ: [docs/error-reporting.md](docs/error-reporting.md).

Lưới chặn đầu tiên là `src/data/validate-rows.mjs`, chạy mỗi lần sync Sheet → SQLite. Nó
đối chiếu từng dòng với `seed.hsk1-4.json` và so pinyin **có dấu** — vì so bỏ dấu thì 买 bị
sửa thành `mài` vẫn lọt, mà đó đúng là kiểu lẫn mà app này sinh ra để chống.

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
| `data/meanings.vi.json` | nghĩa tiếng Việt + âm Hán-Việt + từ loại, do Claude soạn |
| `src/data/validate-rows.mjs` | validator cho dòng đọc từ Sheet (hàm thuần, test được) |

`data/source/` không commit — chạy `npm run data:fetch` để tải lại.

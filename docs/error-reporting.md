# Báo lỗi dữ liệu — vòng khép kín

Kho từ được máy dựng từ CC-CEDICT nên **sẽ có lỗi**. Lỗi dữ liệu trong app này độc hơn
bình thường: một chữ sai sẽ được bạn học lặp lại nhiều tháng bằng chính cơ chế spaced
repetition. Nên app phải coi "phát hiện lỗi" là một luồng chính, không phải tính năng phụ.

## Nguyên tắc

**Báo lỗi phải cho phản hồi tức thì, không chỉ "đã gửi".** Nếu bạn báo lỗi rồi vẫn bị bắt
học tiếp cái từ sai đó, lần sau bạn sẽ không báo nữa.

## Trong app

Nút `⚠ Báo lỗi` (⌘E) có ở mọi stage. Hai ngữ cảnh, hai nhãn khác nhau:

| Khi nào | Nhãn nút | Vì sao tách riêng |
|---|---|---|
| Vừa bị chấm sai | **"Tôi nghĩ tôi đúng"** | Đây là ca hay gặp nhất và gây mất niềm tin nhanh nhất |
| Ở màn hình reveal | **"Dữ liệu từ này sai"** | Bạn nhận ra pinyin/nghĩa/câu ví dụ sai |

Form gọn, điền trong vài giây:

- **Sai ở đâu**: `hanzi` · `pinyin` · `meaning_vi` · `example` · `grading` (app chấm sai) · `other`
- **Sửa thành** (không bắt buộc)
- **Lý do** (không bắt buộc)

App tự gắn kèm: `hanzi`, giá trị app đang hiển thị, stage đang ở, câu trả lời bạn vừa gõ,
latency, `session_id`, thời điểm.

## Hành động tức thì — phần quan trọng nhất

| Loại báo | App làm gì ngay |
|---|---|
| `grading` (app chấm sai) | Pass card luôn, **không tính lapse**, FSRS nhận grade `Good`. Bạn đi tiếp, không bị phạt vì lỗi của app |
| mọi loại khác | **Cách ly từ đó**: rút khỏi queue hôm nay, **bù một từ khác vào** để bạn vẫn pass đủ 20, và không cho nó xuất hiện lại cho tới khi lỗi được xử lý |

Cách ly là điểm cốt lõi: một từ đã bị nghi sai thì phải ngừng dạy **ngay**, chứ không chờ
tới lúc tôi sửa xong.

## Đường về kho từ

```
app  ──ghi──→  SQLite reports  ──sync──→  tab _reports trên Sheet
                                                   │
                                      tôi / bạn xử lý theo loại lỗi
                                                   │
                     ┌─────────────────────────────┼──────────────────────────┐
                     ▼                             ▼                          ▼
          lỗi pinyin                      lỗi nghĩa / câu ví dụ        lỗi hán tự
   overrides.pinyin.json                   sửa trực tiếp trên Sheet   sửa Sheet + validator
   + npm run data:build                                                phải chặn từ đầu
                     └─────────────────────────────┼──────────────────────────┘
                                                   ▼
                              đặt status=applied + resolution_note
                                                   │
                                    app sync về → bỏ cách ly
```

Tab `_reports` trên Sheet:

| Cột | Nội dung |
|---|---|
| `report_id` | uuid sinh ở app |
| `created_at` | ISO 8601 |
| `hanzi` | khoá nối với tab `words` |
| `field` | `hanzi` / `pinyin` / `meaning_vi` / `example` / `grading` / `other` |
| `app_value` | giá trị app đang hiển thị lúc bạn báo |
| `my_correction` | bạn nghĩ nó phải là gì |
| `reason` | ghi chú tự do |
| `session_id` | để lần lại phiên học |
| `status` | `new` → `applied` / `rejected` |
| `resolved_at`, `resolution_note` | tôi điền khi xử lý xong |

## Khi bỏ cách ly: phải reset card, không giữ lịch cũ

Nếu một từ bị dữ liệu sai trong N ngày, thì `stability` và `difficulty` mà FSRS tích được
cho nó **được tính trên dữ liệu sai** — nó phản ánh việc bạn thuộc một thứ không đúng.

Nên khi resolve, card quay về trạng thái `new` thay vì giữ lịch cũ. Thà học lại từ đầu còn
hơn tin vào một lịch đã bị nhiễm.

Ngoại lệ: `field = grading` không reset gì cả — dữ liệu vốn đúng, chỉ khâu chấm sai.

## Chặn từ đầu: validator ở khâu sync

Báo lỗi là lưới an toàn cuối. Lưới đầu tiên là validator chạy mỗi lần sync Sheet → SQLite,
trong `src/data/validate-rows.mjs`. Dòng nào không qua thì **không được nạp vào deck** và
hiện ở màn hình Settings để xử lý:

- `hanzi` không nằm trong `seed.hsk1-4.json` → chặn. *Đây là lưới bắt được ca `晚上` bị gõ
  thành `晥上` khi bơm dữ liệu lần đầu.*
- `hanzi` có ký tự không phải CJK → chặn
- `pinyin` lệch âm so với `pinyin-pro` mà không có override → cảnh báo
- số âm tiết ≠ số hán tự → cảnh báo
- `meaning_vi` trống → không chặn, nhưng từ đó chưa được đưa vào deck
- `example_zh` chứa hán tự ngoài level (vi phạm i+1) → cảnh báo, vẫn học được stage 1 và 2

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
- [x] Phase 0b — nghĩa tiếng Việt + âm Hán-Việt: 1193/1193 từ (bộ HSK 2.0)
- [x] Phase 0c — hợp nhất sang **HSK 3.0: 3304 từ, 3156 câu ví dụ**
- [x] Phase 1 — Electron app: scheduler, SQLite, FSRS, cổng gõ IME, luật pass-20, báo lỗi, sync Sheet
- [ ] Phase 2 — stage đọc + cloze, màn hình đối chiếu đồng âm, phân loại lỗi
- [ ] Phase 3 — dashboard, streak, xử lý từ hay sai
- [ ] Phase 4 (tuỳ) — viết tay trackpad, luyện nghe

## Chạy app

```bash
npm install          # postinstall tự rebuild better-sqlite3 cho ABI của Electron
npm run dev          # chế độ phát triển, hot reload
npm run build        # build vào out/
npm test             # 28 test phần lõi
npm run smoke        # kiểm toàn bộ đường dây phía main rồi thoát
```

`npm test` chạy bằng **node của Electron** (`ELECTRON_RUN_AS_NODE=1`), không phải node hệ
thống: `better-sqlite3` được build cho ABI của Electron nên node thường không nạp được nó.

### Kiến trúc

| Tầng | Nơi | Ghi chú |
|---|---|---|
| Lõi | `src/core/*.mjs` | Thuần, không phụ thuộc Electron → test được bằng node |
| Main | `src/main/index.ts` | Vòng đời app, tray, lịch nhắc, IPC |
| Preload | `src/preload/index.ts` | `contextBridge`, không bật nodeIntegration |
| Renderer | `src/renderer/` | React + TS |

**Đáp án không bao giờ đi xuống renderer trước khi bạn trả lời.** IPC `session:question`
chỉ gửi nghĩa tiếng Việt, từ loại, level và *số lượng chữ* — không gửi `hanzi`, `pinyin`
hay `hanviet`. Mở devtools cũng không đọc được đáp án. Có test tự động cho điều này.

### Cách app bật lên

Tự chạy lúc đăng nhập và nằm im trên menu bar (`汉`). Tới giờ đặt trước (mặc định 20:30)
mà hôm nay chưa pass đủ 20 từ thì mở cửa sổ. Laptop ngủ qua giờ hẹn thì `powerMonitor`
bắt lại lúc mở nắp — không bỏ sót ngày nào.

Cửa sổ `alwaysOnTop`, không có nút đóng. Lối thoát: hoãn 10 phút (tối đa 3 lần/ngày),
hoặc **gõ đúng `我放弃` bằng IME** — đầu hàng cũng phải học. Cố ý dừng ở mức "rất phiền
nếu bỏ" chứ không khoá cứng máy: ép quá tay thì app bị gỡ sau một tuần.

## Đồng bộ Google Sheet

Sheet do **code ghi**, không ai gõ tay. Lần bơm dữ liệu đầu tiên làm bằng tay đã sinh ra
một lỗi câm (`晚上` → `晥上`), nên toàn bộ đường ghi giờ đi qua service account.

```bash
npm run sheet:push      # đẩy seed lên tab words (giữ nguyên cột lesson/verified bạn nhập)
npm run sheet:pull      # kéo Sheet về + chạy validator trước khi nạp vào deck
npm run sheet:reports   # kéo trạng thái báo lỗi về
```

Chuẩn bị một lần:

1. [console.cloud.google.com](https://console.cloud.google.com) → tạo project → bật
   **Google Sheets API**
2. *IAM & Admin → Service Accounts* → tạo account → *Keys* → **Add key → JSON** → tải về
3. Mở Sheet, bấm **Share**, dán email của service account (dạng
   `…@….iam.gserviceaccount.com`), cấp quyền **Editor**
4. Tạo `.env.local` cạnh `package.json` (đã nằm trong `.gitignore`):

```
HANZI_SHEET_ID=1nXjE2TOoU_tggH8JRNw-zjX3CcGjMfY4XUVZgITudsk
HANZI_SA_KEY=/đường/dẫn/tới/service-account.json
```

`sheet:push` **không** ghi đè cột `lesson` và `verified` — hai cột đó là của bạn, pipeline
không đụng vào.

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

Đo lại trên **toàn bộ 271 nhóm đồng âm** của kho từ HSK 3.0 (265 nhóm đủ dữ liệu Hán-Việt):

| Mức phân biệt | Số nhóm | Tỷ lệ |
|---|---|---|
| Hán-Việt phân biệt **hoàn toàn** | 208 | 78% |
| phân biệt **một phần** | 46 | 17% |
| Hán-Việt **trùng hết** | 11 | 4% |

**96% các nhóm đồng âm được Hán-Việt phân biệt ít nhất một phần.** Trong 11 nhóm Hán-Việt
trùng, **bộ thủ cứu được 9** (`他们/她们/它们`, `下/夏`, `后/厚`, `门/们`, `字/自`, `风/封`,
`掉/调`, `层/曾`, `功夫/工夫`).

Còn đúng **2 nhóm cả hai cơ chế đều bó tay**: `心里 / 心理` và `制定 / 制订` — trùng âm,
trùng Hán-Việt, trùng cả bộ thủ chữ đầu. Hai cặp này phải phân biệt bằng ngữ cảnh dùng.

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
| **Sheet từ vựng của bạn** | danh sách từ, cấp HSK 3.0, câu ví dụ + pinyin + dịch, Hán-Việt | 3245 dòng → 3156 từ sau khi bỏ trùng. Đủ 100% mọi trường |
| [`drkameleon/complete-hsk-vocabulary`](https://github.com/drkameleon/complete-hsk-vocabulary) | hán tự, phồn thể, level HSK, bộ thủ, từ loại, hạng tần suất, nghĩa EN | MIT; dữ liệu từ CC-CEDICT. Dùng `wordlists/exclusive/old/{1..4}.json` = HSK 2.0, không lặp từ giữa các level |
| `pinyin-pro` | **thẩm quyền pinyin cho hán tự đơn** | Chọn âm theo từ điển tần suất |
| [`lxaw/hsk-infinite`](https://github.com/lxaw/hsk-infinite) | chỉ để cross-check | Thực chất là app luyện đề thi (5269 mp3). `site/vocab.json` cùng gốc CC-CEDICT nên **không độc lập** |

### Chuẩn: HSK 3.0, hợp nhất hai nguồn

Kho từ cuối cùng là **3304 từ**: toàn bộ HSK 3.0 cấp 1–4 từ sheet của bạn (3156) cộng 148
từ chỉ có trong danh sách HSK 2.0 cũ.

| Cấp | Số từ |
|---|---|
| HSK 1 | 496 |
| HSK 2 | 753 |
| HSK 3 | 972 |
| HSK 4 | 1083 |

Nguồn tốt nhất được chọn cho **từng cột**, dựa trên đối chiếu thật chứ không phải phỏng đoán:

- **câu ví dụ** ← sheet, sau khi quy phồn thể → giản thể (2955 câu phải đổi)
- **Hán-Việt** ← sheet; nhiều chỗ đúng hơn bản tôi soạn (办法 *biện pháp* chứ không phải *bạn pháp*)
- **pinyin** ← bản đã vet cho 1045 từ trùng, sheet cho phần còn lại. Đối chiếu cho **0 ca lệch âm**; sheet lại đúng hơn ở vần hoá -r (`hǎowánr`, `nǎr`)
- **nghĩa tiếng Việt** ← bản tôi soạn cho các từ trùng. Nghĩa của sheet cô đọng kiểu từ điển nên dùng làm prompt thì yếu: 把 ghi "Cầm nắm, để" trong khi HSK 3 dùng nó làm giới từ. Bản của sheet giữ ở `meaning_vi_alt`
- **bộ thủ, tần suất** ← complete-hsk-vocabulary; thiếu cột này thì luật gợi ý rơi về bộ thủ sẽ hỏng

Pinyin được chuẩn hoá về **viết liền** (`méiyǒu`), là chính tả đúng cho một từ và cũng là
dạng của 2315/3304 mục.

Chuyển đổi phồn → giản dùng `from:'t'` chứ **không** dùng `from:'tw'`: bộ `tw` còn đổi cả
từ vựng kiểu Đài Loan và chuyển quá tay — nó biến 显著 (vốn đúng giản thể) thành 显着.

### Sáu từ bị cách ly sẵn

Đối chiếu với từ điển 11470 mục tìm ra 6 từ ghép không tra được, gần như chắc chắn là lỗi
gõ trong sheet. Chúng bị cách ly ngay từ seed, không vào deck cho tới khi bạn đối chiếu sách:

| Trong sheet | Có lẽ là |
|---|---|
| 阳天 *"ngày nắng"* | 晴天 |
| 里米 *"mét"* | 厘米 (xăng-ti-mét) |
| 拨脱 *"thoát khỏi"* | 摆脱 |
| 播动 *"lay động"* | 拨动 |
| 补子 *"miếng vá"* | 补丁 |
| 塔车 *"cần cẩu tháp"* | chưa rõ |

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

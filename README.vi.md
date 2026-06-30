# Notchy

[English](README.md) | [Tiếng Việt](README.vi.md)

Ứng dụng quản lý tài chính cá nhân cục bộ (local-first). Dữ liệu của bạn nằm trên thiết bị của bạn — không đám mây, không tài khoản, không đăng ký trả phí.

## Cài đặt

### Tải về

Bản dựng sẵn cho Linux có sẵn tại [bản phát hành mới nhất](https://github.com/baoviettran/notchy/releases):

| Nền tảng | Tệp |
|---|---|
| Linux (Debian/Ubuntu) | `Notchy_0.1.0_amd64.deb` |
| Linux (Fedora/RHEL) | `Notchy-0.1.0-1.x86_64.rpm` |
| Linux (bất kỳ) | `Notchy_0.1.0_amd64.AppImage` |
| macOS | `Notchy_0.1.0_x64.dmg` (dự kiến) |
| Windows | `Notchy_0.1.0_x64-setup.exe` (dự kiến) |

### Build từ mã nguồn

Yêu cầu: Node.js 22, pnpm 10, Rust 1.77+, và các thư viện hệ thống của Tauri.

```bash
# Cài đặt thư viện hệ thống (Ubuntu/Debian)
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Clone và build
git clone https://github.com/baoviettran/notchy.git
cd notchy
pnpm install
pnpm tauri build

# Tệp thực thi nằm tại: src-tauri/target/release/notchy
```

Hoặc dùng Docker để build có thể tái lập:

```bash
docker build -t notchy .
docker cp $(docker create notchy):/app/src-tauri/target/release/bundle ./release
```

## Sử dụng

### Lần đầu mở app

1. **Chọn ngôn ngữ** — English hoặc Tiếng Việt
2. **Chọn đơn vị tiền tệ** — VND hoặc USD (tất cả tài khoản dùng chung một đơn vị)
3. **Tạo tài khoản đầu tiên** — chọn loại (Tài khoản thanh toán, Tiết kiệm, Tiền mặt, Thẻ tín dụng) và có thể nhập số dư ban đầu

Xong rồi, bắt đầu dùng thôi.

### Sử dụng hằng ngày

- **Thêm giao dịch** — bấm nút `+` màu xanh (hoặc nhấn `n`) → nhập số tiền, chọn nhãn, lưu
- **Cú pháp tắt số tiền** — gõ `50k` (= 50.000), `1.5tr` (= 1.500.000), hoặc thậm chí `50k+30k` (= 80.000)
- **Tìm kiếm** — nhấn `/` để đưa con trỏ vào thanh tìm kiếm, tìm giao dịch theo người nhận hoặc diễn giải
- **Giao dịch thường xuyên** — các giao dịch dùng nhiều nhất hiển thị thành thẻ một chạm trên trang Tổng quan

### Điều hướng

| Trang | Tác dụng |
|---|---|
| Tổng quan | Tiến độ ngân sách, giao dịch gần đây, mục tiêu, tài sản ròng |
| Giao dịch | Danh sách đầy đủ với tìm kiếm và bộ lọc |
| Ngân sách | Ngân sách phong bì hằng tháng theo nhóm |
| Báo cáo | Tổng quan, Xu hướng (6/12/24 tháng), So sánh (hai tháng) |
| Tài khoản | Tất cả tài khoản kèm số dư |
| Mục tiêu | Đích tiết kiệm với theo dõi tiến độ |
| Công nợ | Khoản vay cá nhân — ai nợ ai |
| Cài đặt | Nhóm, sao lưu/xuất, giao diện, ngôn ngữ |

### Phím tắt

| Phím | Hành động |
|---|---|
| `n` | Mở form giao dịch mới |
| `/` | Đưa con trỏ vào ô tìm kiếm |
| `Escape` | Đóng hộp thoại |

### Sao lưu & dữ liệu

- **Sao lưu tự động** — một bản chụp được lưu mỗi lần mở app (giữ lại 10 bản gần nhất)
- **Xuất** — Cài đặt → Sao lưu → Xuất ra tệp SQLite hoặc CSV
- **Nhập** — Cài đặt → Sao lưu → Nhập (thay thế dữ liệu hiện tại)
- **Tệp dữ liệu của bạn** nằm tại:
  - Linux: `~/.local/share/com.notchy.app/notchy.db`
  - macOS: `~/Library/Application Support/com.notchy.app/notchy.db`
  - Windows: `%APPDATA%\com.notchy.app\notchy.db`

Bạn có thể mở tệp này bằng bất kỳ công cụ SQLite nào. Xem [RECOVERY.md](RECOVERY.md) để biết các câu truy vấn.

## Nguyên tắc

1. **Dữ liệu sống lâu hơn ứng dụng.** SQLite là nguồn sự thật duy nhất; tệp vẫn đọc được trong mọi thời đại.
2. **Cục bộ trước tiên.** Không đám mây, không thu thập dữ liệu, không bắt buộc mạng.
3. **Xây dựng cho một thập kỷ.** Khóa phiên bản dependency, build có thể tái lập.
4. **Nhỏ và sẵn sàng phát hành.** v0.1 cố ý tối giản.

## Công nghệ

- [Tauri v2](https://tauri.app) — vỏ ứng dụng desktop
- [SvelteKit](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) — giao diện
- [SQLite](https://sqlite.org) — cơ sở dữ liệu (qua `@tauri-apps/plugin-sql`)
- [Tailwind CSS](https://tailwindcss.com) — kiểu dáng

## Tài liệu

- [SCHEMA.md](SCHEMA.md) — tham chiếu schema cơ sở dữ liệu
- [RECOVERY.md](RECOVERY.md) — cách đọc dữ liệu bằng sqlite3 nếu app ngừng hoạt động

## Giấy phép

MIT

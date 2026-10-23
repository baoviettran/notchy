# Notchy

[English](README.md) | [Tiếng Việt](README.vi.md)

<p align="center">
  <img src="src-tauri/icons/icon.png" alt="Notchy" width="128" height="128">
</p>

Ứng dụng quản lý tài chính cá nhân cục bộ (local-first). Dữ liệu của bạn nằm trên thiết bị của bạn — không đám mây, không tài khoản, không đăng ký trả phí.

## Cài đặt

### Tải về

Tải [Notchy 0.2.2](https://github.com/baoviettran/notchy/releases/tag/v0.2.2):

| Nền tảng | Tệp |
|---|---|
| Ubuntu 24.04 x86_64 | [DEB](https://github.com/baoviettran/notchy/releases/download/v0.2.2/Notchy_0.2.2_amd64.deb) |
| Fedora 44 x86_64 | [RPM](https://github.com/baoviettran/notchy/releases/download/v0.2.2/Notchy-0.2.2-1.x86_64.rpm) |

Package Linux DEB/RPM chưa ký. Kiểm tra bằng SHA256SUMS của release. Windows/macOS và AppImage không nằm trong bản 0.2.2; kết quả này không chứng nhận mọi bản phân phối Linux hay tích hợp desktop trên máy thật.

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
| Báo cáo | Tổng quan, xu hướng, so sánh, cơ cấu, nhãn, so sánh năm và tài sản ròng |
| Tài khoản | Tất cả tài khoản kèm số dư |
| Mục tiêu | Đích tiết kiệm với theo dõi tiến độ |
| Công nợ | Khoản vay cá nhân — ai nợ ai |
| Định kỳ | Thu, chi và chuyển khoản định kỳ, ghi khi mở ứng dụng |
| Cài đặt | Nhóm, quy tắc phân loại, sao lưu/xuất, giao diện, ngôn ngữ |

### Phím tắt

| Phím | Hành động |
|---|---|
| `n` | Mở form giao dịch mới |
| `/` | Đưa con trỏ vào ô tìm kiếm |
| `Escape` | Đóng hộp thoại |

### Sao lưu & dữ liệu

- **Sao lưu** — dùng Cài đặt → Sao lưu & dữ liệu cho profile đang mở, hoặc Cài đặt → Profiles cho profile khác. Snapshot đã xác minh bảo vệ trước migration và reset; chưa bật sao lưu định kỳ/retention tự động.
- **Xuất** — SQLite để khôi phục đầy đủ, CSV để lưu trữ từng bảng.
- **Khôi phục** — SQLite được khôi phục thành **profile mới**, giữ nguyên các profile hiện có. Nhập CSV giao dịch là luồng nhập dữ liệu ngân hàng riêng.
- **Database profile trên Linux** — `~/.local/share/com.notchy.app/profiles/<profile-id>/notchy.db`.
- **Registry/tùy chọn trên Linux** — `~/.config/com.notchy.app/profiles.json` và `preferences.json`.

Backup nằm trong thư mục dữ liệu từng profile tại `backups/`, `backups/upgrades/`, `backups/resets/`. Cài đặt → Sao lưu & dữ liệu hiển thị đường dẫn thực tế. Database cũ được tiếp nhận vào một profile. Xuất backup SQLite ra ngoài thư mục ứng dụng trước khi nâng cấp; không mặc định binary cũ đọc được cấu trúc profile mới.

Bạn có thể mở tệp này bằng bất kỳ công cụ SQLite nào. Xem [RECOVERY.md](RECOVERY.md) để biết các câu truy vấn.

## Phát triển

Chạy `pnpm check`, `pnpm test`, `pnpm test:coverage`, `pnpm test:roadmap` và `pnpm build`. Các gate native gồm `cargo test --manifest-path src-tauri/Cargo.toml`, Clippy với `--all-targets -- -D warnings` và `pnpm check:db-contracts`. Dùng Node 22 cho `pnpm test:e2e`: loader của Playwright 1.52 đang bị treo trên Node 24. Cấu hình repo hỗ trợ cả pnpm 10 và 11.

Khởi tạo kho tài liệu riêng bằng `git submodule update --init docs`. Xem [ROADMAP.md](ROADMAP.md) để biết phạm vi hiện tại và [checklist desktop](specs/2026-07-27-desktop-release-smoke-checklist.md) trước khi phát hành.

## Nguyên tắc

1. **Dữ liệu sống lâu hơn ứng dụng.** SQLite là nguồn sự thật duy nhất; tệp vẫn đọc được trong mọi thời đại.
2. **Cục bộ trước tiên.** Không đám mây, không thu thập dữ liệu, không bắt buộc mạng.
3. **Xây dựng cho một thập kỷ.** Khóa phiên bản dependency, build có thể tái lập.
4. **Nhỏ và sẵn sàng phát hành.** v0.1 cố ý tối giản.

## Công nghệ

- [Tauri v2](https://tauri.app) — vỏ ứng dụng desktop
- [SvelteKit](https://kit.svelte.dev) + [Svelte 5](https://svelte.dev) — giao diện
- [SQLite](https://sqlite.org) — `rusqlite` trong Rust trên desktop; adapter `sql.js` trong bộ nhớ cho phát triển và kiểm thử bằng trình duyệt
- [Tailwind CSS](https://tailwindcss.com) — kiểu dáng

## Tài liệu

- [SCHEMA.md](SCHEMA.md) — tham chiếu schema cơ sở dữ liệu
- [RECOVERY.md](RECOVERY.md) — cách đọc dữ liệu bằng sqlite3 nếu app ngừng hoạt động

## Giấy phép

MIT

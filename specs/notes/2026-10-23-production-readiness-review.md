# Production readiness review và bàn giao phase fix

**Serves:** STORY-009, STORY-013, STORY-015, STORY-023

- Ngày review: 2026-10-23.
- Baseline: commit `29e0055`, version khai báo `0.2.1`.
- Trạng thái tại baseline: **review hoàn tất; cần sửa trước public release**. Kết quả phase fix hiện tại: [verification và closure](2026-10-23-production-fix-verification.md); R1/R3 đã sửa, R4 có gate bắt buộc, R2 Windows vẫn mở.
- Phạm vi: source, database boundary, schedules, backup/restore, kiểm thử và release tooling. Không phải audit bảo mật toàn diện hoặc chứng nhận UI/native trên mọi OS.
- Mục đích: agent tiếp theo có thể xác minh, sửa và nghiệm thu từng finding mà không cần đọc lịch sử chat.

## Kết luận và phạm vi phát hành

Notchy có nền tảng tốt hơn mức prototype: Rust sở hữu SQLite, executor tập trung,
process lock, transaction, kiểm tra schema, backup trước migration/restore và test
chèn lỗi. Tuy nhiên, tính nguyên tử của scheduled posting và idempotency xuyên IPC
chưa đáp ứng mục tiêu an toàn dữ liệu. Windows có lỗi tương thích filesystem được
phát hiện bằng đọc source, cần xác minh và xử lý trên Windows thật.

| Phạm vi | Quyết định tại baseline |
| --- | --- |
| Linux dùng nội bộ | Có thể dùng có kiểm soát, backup chủ động, chưa dựa vào scheduled auto-posting |
| Linux public beta | Chờ R1, R3 và release gate của artifact cuối cùng |
| Windows | Chờ R2 và smoke backup/import/restore/upgrade trên Windows |
| macOS | Chưa chứng nhận; cần kiểm thử native và kiểm tra phân phối riêng |
| Public production đa nền tảng | Chưa đạt |

Không cần thêm profile management, sync hoặc tính năng mới để đóng phase này.
Chỉ công bố hỗ trợ các OS đã có bằng chứng nghiệm thu; không dùng kết quả Linux để
suy ra Windows/macOS đã đạt.

## Hướng dẫn cho agent nhận việc

1. Đọc `AGENTS.md`, kiểm tra HEAD và thay đổi sau baseline; không mặc định finding còn nguyên.
2. Tái hiện từng finding trước khi sửa. Viết regression test thất bại trước implementation.
3. Dùng SQLite thật cho test dữ liệu; giữ nguyên các migration đã phát hành. Nếu cần đổi schema, thêm migration mới và kiểm tra upgrade/backup compatibility.
4. Xem các hướng sửa bên dưới là yêu cầu về hành vi, không phải thiết kế đã duyệt từng chi tiết.
5. Không thay browser mock rồi coi đó là bằng chứng Rust/native đã sửa.
6. Cập nhật bảng closure ở cuối bằng commit, lệnh kiểm tra, kết quả và evidence path.
7. Không sửa `src/lib/paraglide/`, không đưa code vào submodule `docs/`; giữ locale-switch boundary trong `AGENTS.md`.

Working tree lúc bàn giao có bảy CSV chưa được track: `accounts.csv`, `budgets.csv`,
`category_tags.csv`, `category_types.csv`, `goals.csv`, `reconciliations.csv`,
`transactions.csv`. Đây là dữ liệu có sẵn của người dùng: không đọc nếu không cần,
không commit, xóa hoặc đưa vào release. Release cleanliness cần được xử lý riêng
mà vẫn bảo toàn các file này, ví dụ build từ checkout sạch của release commit.

## R1 — P1: Scheduled posting không nguyên tử

**Độ tin cậy:** đã tái hiện với `createTestDb()` và SQLite thật ở browser adapter;
native có cùng chuỗi gọi tách rời, nhưng chưa chạy crash reproduction native.

**Source:** `src/lib/logic/post-due-schedules.ts`, đặc biệt `postOne()` gọi
`db.transactions.create()` trong vòng lặp rồi mới gọi `db.schedules.markPosted()`.
Native adapter gửi hai command riêng qua IPC.

**Trigger:** giao dịch commit thành công, nhưng cập nhật ngày đến hạn thất bại hoặc
process bị ngắt trước bước đó. Khi resume/restart, ngày đến hạn cũ vẫn còn và cùng
kỳ được ghi lại. Catch rồi park schedule không rollback những giao dịch đã commit.

**Tác động:** tiền bị tính hai lần, sai balance/budget/report mà dữ liệu vẫn hợp lệ
về mặt schema. Catch-up nhiều kỳ có thể làm tăng số giao dịch bị lặp.

### Reproduction độc lập với log tạm

Đặt regression dưới `src/tests/unit/` và điều chỉnh style theo repo. Đoạn dưới là
probe đã dùng trong review; bước SQL resume cố ý cô lập posting engine, không
chứng minh UI Resume. Fixture chỉ chứa dữ liệu tổng hợp.

```ts
import { it, expect } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { postDueSchedules } from '$lib/logic/post-due-schedules';

it('does not duplicate an occurrence when advancement fails and posting resumes', async () => {
	const raw = createTestDb();
	try {
		await runMigrations(raw, migrations);
		await raw.execute('PRAGMA foreign_keys = ON');
		await raw.execute(
			"INSERT INTO accounts (id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x')"
		);
		const db = new BrowserDatabaseClient(raw);
		const id = await db.schedules.create({
			name: 'Rent', kind: 'expense', amount: 50000, account_id: 'a',
			frequency: 'monthly', start_date: '2026-01-01'
		});
		await raw.execute(
			"CREATE TRIGGER fail_advance BEFORE UPDATE OF next_due_date ON schedules BEGIN SELECT RAISE(ABORT, 'injected advancement failure'); END"
		);
		const first = await postDueSchedules(db, '2026-01-01');
		expect(first.errors).toHaveLength(1);
		expect(await raw.query('SELECT id FROM transactions')).toHaveLength(1);
		await raw.execute('DROP TRIGGER fail_advance');
		await raw.execute('UPDATE schedules SET errored_at=NULL, enabled=1 WHERE id=?', [id]);
		await postDueSchedules(db, '2026-01-01');
		expect(await raw.query('SELECT date,amount FROM transactions')).toHaveLength(1);
	} finally {
		await raw.close();
	}
});
```

Baseline: assertion cuối thất bại; nhận hai dòng `{ date: '2026-01-01', amount: 50000 }`.
Sau khi làm atomic, assertion trung gian mong một giao dịch sau lỗi phải đổi theo
invariant mới (rollback toàn kỳ có thể để lại zero); không giữ bug làm yêu cầu test.

**Yêu cầu đóng:**

- [ ] Một kỳ có hiệu ứng tài chính và bookkeeping nhất quán trong transaction native.
- [ ] Có nhận diện kỳ ổn định hoặc cơ chế tương đương chống lặp sau retry/restart; không dựa vào biến `once` trong JS process.
- [ ] Test lỗi sau khi ghi nhưng trước khi advance; reopen/retry không nhân đôi expense, income hoặc transfer pair.
- [ ] Kiểm tra catch-up nhiều kỳ, cap 24, reminder-only, end date, park/resume và concurrent submission.
- [ ] Browser adapter và native có cùng semantics; test native đi qua command/domain thực.
- [ ] Test UI Resume và native restart bổ sung cho probe engine ở trên.

## R2 — P1 cho Windows: Đồng bộ thư mục dùng giả định Unix

**Độ tin cậy:** static finding có đối chiếu tài liệu OS; chưa tái hiện trên Windows.

**Source:** `src-tauri/src/database/backup.rs::sync_directory()` dùng
`std::fs::File::open(dir)`; `restore.rs::sync_directory()` dùng
`OpenOptions::new().read(true).open(dir)`. Cả hai gọi `sync_all()` và không có nhánh
Windows tại baseline. Backup publication gọi helper sau rename.

Windows yêu cầu `FILE_FLAG_BACKUP_SEMANTICS` để lấy directory handle:
[Microsoft: Directory Handles](https://learn.microsoft.com/en-us/windows/win32/fileio/obtaining-a-handle-to-a-directory).
Rust cung cấp flags qua
[OpenOptionsExt](https://doc.rust-lang.org/std/os/windows/fs/trait.OpenOptionsExt.html).
Đây không phải khẳng định chỉ thêm một flag là đủ: phải kiểm tra cả flush, rename,
sharing mode và durability semantics trên OS đích.

**Tác động dự kiến:** backup/export hoặc restore báo lỗi ở bước đồng bộ thư mục;
quy trình trước migration/restore cũng có thể bị chặn khi cần tạo backup.

**Yêu cầu đóng:**

- [ ] Reproduce trên Windows bằng các helper/command hiện tại và ghi nhận error cụ thể.
- [ ] Implement publication/restore phù hợp từng OS; không bỏ qua lỗi I/O để làm test xanh.
- [ ] Windows native tests: backup, export, import, restore, overwrite và fault injection trước/sau rename.
- [ ] Kiểm tra nguồn import không đổi, rollback snapshot còn đọc được, restart phục hồi được.
- [ ] Smoke trên Windows package thực; tương tự kiểm tra Linux để tránh regression.
- [ ] Nếu chưa thể hỗ trợ Windows, ghi rõ ngoài phạm vi và loại artifact Windows khỏi release này.

## R3 — P2: Operation ID không được giữ qua IPC retry

**Độ tin cậy:** xác nhận từ source; chưa inject mất response trên app desktop.

**Source:** `src/lib/db/native/client.ts::NativeTransactionOps.create()` chỉ gửi
`input`; `src-tauri/src/database/commands.rs::transaction_create()` tự gọi
`OperationId::generate()` mỗi lần. Các mutation khác có cùng pattern.

`receipt.rs::run_idempotent()` hỗ trợ chống lặp khi nhận cùng operation ID, nhưng
IPC caller không thể cung cấp lại ID đó. Retry sau commit nhưng mất response nhận
ID mới và có thể tạo thêm hiệu ứng tài chính. Comment đầu native client và thiết kế
`specs/2026-08-17-rust-database-integrity-boundary-design.md` mô tả bảo đảm mạnh hơn
implementation hiện có. Tests `src-tauri/tests/idempotency.rs` chứng minh harness
nhận cùng ID, chưa chứng minh ID tồn tại xuyên command boundary.

**Yêu cầu đóng:**

- [ ] ID ổn định theo một user intent, được truyền và validate ở native boundary.
- [ ] Retry cùng ID/payload trả kết quả cũ; cùng ID/khác payload bị từ chối; intent mới có ID mới.
- [ ] Receipt và hiệu ứng tài chính cùng commit; kiểm tra cả batch và transfer.
- [ ] Test commit thành công nhưng caller mất response, retry qua command thật không nhân đôi.
- [ ] Xác định rõ vòng đời pending intent khi retry/reload; không chỉ sửa comment.
- [ ] Cập nhật generated contracts và các boundary tests liên quan.

## R4 — P2: Release gates chưa chứng minh từng artifact

**Độ tin cậy:** xác nhận từ cấu hình repository, không kiểm tra remote CI run mới nhất.

**Source và khoảng trống:**

- `.github/workflows/ci.yml`: Rust test/Clippy chạy Ubuntu; Playwright dùng Chromium và adapter test.
- `.github/workflows/release.yml`: tag `v*` build draft đa nền tảng, chưa tự ràng buộc quality gate trên đúng tagged SHA. `releaseDraft: true` là lớp kiểm soát hữu ích, không phải tự publish.
- Workflow release chưa truyền cấu hình signing/notarization; comment không chứng minh binary đã ký.
- `scripts/release-dogfood.mjs`: `SOFT_GATE_STEPS` chứa `pnpm test:e2e`, nên E2E fail vẫn có thể tiếp tục. Finding bổ sung khi chuẩn bị report.
- `pnpm test:release-smoke` chỉ in đường dẫn checklist/version; không thực thi desktop smoke.

**Yêu cầu đóng:**

- [ ] Release candidate có bằng chứng quality gates của đúng SHA, không chỉ một commit trước đó.
- [ ] E2E fail chặn public release; không dùng trạng thái dogfood thành công thay cho full gates.
- [ ] Mỗi OS được công bố có test native phù hợp và packaged smoke với version/hash cụ thể.
- [ ] Ghi rõ signed/notarized hay unsigned, kênh phân phối và các giới hạn cho người dùng.
- [ ] Draft được review trước publish; mọi sửa đổi sau smoke làm mất chứng nhận artifact cũ.

## R5 — Khoảng trống vận hành: Backup thường ngày còn thủ công

`README.md`, `ROADMAP.md`, locale copy và native source thống nhất rằng desktop
không tự tạo routine backup mỗi lần mở app; retention tự động chưa được nối vào
luồng chạy. Đây là giới hạn đã công bố, không phải bug cần đổi hành vi âm thầm.

Đối với beta, có thể chấp nhận nếu hướng dẫn backup và restore rõ ràng. Trước khi
khuyến nghị dùng rộng rãi lâu dài, cần quyết định chính sách backup, thông báo khi
backup quá cũ, retention và hướng dẫn giữ bản sao ngoài cùng thiết bị. Backup trên
cùng ổ đĩa không bảo vệ khỏi hỏng/mất thiết bị. Tính năng mới ở đây cần scope riêng;
không bắt buộc đưa tất cả vào patch sửa R1–R4.

## Bằng chứng kiểm tra của lượt review

| Gate | Kết quả tại baseline | Giới hạn |
| --- | --- | --- |
| `pnpm check` | 0 errors, 3 CSS `@apply` warnings ở Quick Add | Không chứng minh native runtime |
| `pnpm build` | Pass | Có cảnh báo chunk và lỗi gửi telemetry của dependency build do DNS; build vẫn exit 0 |
| Vitest, Node 22.22.3 | 783 pass / 371 fail | `better-sqlite3` đã build ABI 137, Node 22 cần ABI 127; không dùng số fail này để kết luận 371 bug |
| Vitest, Node 24.22.0, 1–2 workers | 1153 pass / 1 fail, 128 files | Fallback khớp binary SQLite; không thay thế gate với toolchain repo yêu cầu |
| Test fail còn lại | `scripts/check-native-db-cutover.test.mjs`, `spawnSync node EPERM` | Sandbox chặn child process; script chạy trực tiếp pass |
| `node scripts/check-native-db-cutover.mjs` | Pass | Chỉ kiểm tra boundary cutover |
| `node --test scripts/release-dogfood.test.mjs` | 1 test pass | Không chạy release/build package |
| Probe R1 | Fail đúng vì hai occurrence thay vì một | SQLite thật; không phải native crash test |
| `cargo test` | Dừng khi đang compile dependencies | Chưa có kết quả test, không được ghi pass |
| Coverage, Clippy, generated bindings, E2E, packaged smoke | Không chạy lại trong lượt review | Cần chạy trong phase fix |

Lần gọi Vitest đầu chỉ đặt `maxWorkers=2` gặp xung đột min/max; đã sửa invocation
thành `--minWorkers=1 --maxWorkers=2`. Đây là lỗi chạy lệnh của review, không phải
finding sản phẩm. `pnpm` hiện có là 11.25.0; phase fix phải dựng lại environment
đúng Node 22.22.3 / pnpm 10.11.0 hoặc ghi rõ toolchain khác đã được chấp nhận.

Evidence desktop lịch sử nằm ở
[2026-10-19-desktop-and-rules-verification.md](2026-10-19-desktop-and-rules-verification.md).
Đọc cả phần follow-up: native picker/import đã được kiểm tra sau lần smoke đầu.
Không đưa các lỗi lịch sử đã sửa trở lại danh sách blocker hiện tại.

Log của review nằm trong `/tmp/notchy-review-*.log`, nhưng có thể bị dọn.
Report đã giữ lại reproduction và kết quả thiết yếu; khi nghiệm thu mới, lưu bằng
chứng bền vững ngoài Git theo quy ước `artifacts/<version>/`, chỉ dùng dữ liệu tổng hợp.

## Bump version và release sau phase fix

**Có thể release sau phase fix, nhưng không tự động chỉ vì đã sửa code.**
Nếu scope cuối là sửa lỗi tương thích với dữ liệu hiện có, đề xuất **0.2.2**.
Đây là version candidate, chưa bump trong report này. Kiểm tra remote tags/releases
trước khi chọn để tránh trùng hoặc ghi đè artifact đã phát hành; local tags không đủ.
Nếu scope mở rộng thành thay đổi sản phẩm hoặc compatibility đáng kể, đánh giá lại
minor version. Migration mới tự nó không bắt buộc minor bump nếu upgrade an toàn.

### Điều kiện release candidate

- [ ] R1 và R3 đóng bằng regression tests ở đúng boundary.
- [ ] R2 đóng cho Windows, hoặc Windows bị loại rõ khỏi phạm vi release.
- [ ] R4 bảo đảm các gate bắt buộc và evidence đúng release SHA/artifact.
- [ ] Review fix diff độc lập; không còn P1 chưa xử lý trong phạm vi phát hành.
- [ ] Làm sạch environment và chạy `pnpm check`, `pnpm test`, `pnpm test:coverage` cùng coverage gate phù hợp, `pnpm test:e2e`, `pnpm build`.
- [ ] Chạy `cargo test --manifest-path src-tauri/Cargo.toml`, `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings`, `pnpm check:db-contracts`, `pnpm check:native-db-cutover`, `pnpm test:release-tooling`.
- [ ] Chạy thêm gate mà release lane yêu cầu; không coi E2E soft failure là đạt.
- [ ] Đồng bộ version ở `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`; cập nhật entry package `notchy` trong `Cargo.lock` bằng tooling. Không thay mọi chuỗi version của dependency trong lockfile.
- [ ] Viết release notes: lỗi sửa, giới hạn backup, OS hỗ trợ, upgrade/downgrade/schema compatibility và đường phục hồi.
- [ ] Build final package với version mới, ghi SHA-256 và source SHA.
- [ ] Smoke artifact cuối: fresh install, upgrade từ phiên bản thực sự đã phát hành với database có dữ liệu, CRUD, transfer, schedule retry/restart, Quick Add/tray, locale, SQLite export/import, restore và persistence.
- [ ] Upgrade smoke phải xác nhận ID/balance/transfer và schema sau khi app mở; package-manager chỉ giữ một file marker là chưa đủ.
- [ ] CI của release commit đạt, draft release có đúng artifacts/checksums và evidence.
- [ ] Chỉ publish khi các điều kiện trên đạt và có yêu cầu publish; việc tạo report này không phải lệnh tag/push/publish.

Bump version sau khi fix ổn định, trước khi build và smoke release candidate. Nếu có
thay đổi code sau đó, rebuild và kiểm tra lại phần bị ảnh hưởng; không dùng hash
của package cũ làm bằng chứng cho package mới.

## Bảng closure để agent sửa cập nhật

| ID | Trạng thái | Fix commit | Regression và native evidence | Quyết định release |
| --- | --- | --- | --- | --- |
| R1 | Open — reproduced | — | — | Block scheduled auto-posting |
| R2 | Open — static finding | — | — | Block Windows pending verification/fix |
| R3 | Open — source confirmed | — | — | Block claimed retry-safe public release |
| R4 | Open — config confirmed | — | — | Required release controls |
| R5 | Documented limitation | — | — | Beta có thể chấp nhận với policy rõ ràng |

Agent bàn giao phải báo riêng: **đã sửa**, **đã kiểm tra**, **chưa kiểm tra**, và
**artifact nào đủ điều kiện phát hành**. Không gộp “tests xanh”, “build được” và
“đã sẵn sàng release” thành cùng một kết luận.

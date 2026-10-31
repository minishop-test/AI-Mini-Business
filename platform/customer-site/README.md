# Website mẫu cho khách hàng AI Mini Business

Đây là bộ khung website cửa hàng độc lập để đóng gói thành ZIP ở giai đoạn tiếp theo. Nó không kết nối với tài khoản, dữ liệu, API key hoặc cơ sở dữ liệu của AI Mini Business.

## Có gì trong bộ mẫu?
- Trang cửa hàng công khai: danh sách sản phẩm và biểu mẫu đặt hàng.
- Cloudflare Worker API.
- Cloudflare D1 schema cho sản phẩm và đơn hàng.
- API quản trị được bảo vệ bằng secret riêng của chủ website.
- Hướng dẫn triển khai và cấu hình.

## Điều kiện trước khi triển khai
Khách hàng cần có tài khoản Cloudflare, Node.js và npm. Website này cần một Worker, một D1 database và một Pages site (hoặc static hosting tương đương). Có thể phát sinh chi phí nếu vượt hạn mức miễn phí của nhà cung cấp.

## Đóng gói ZIP
Từ thư mục `platform/customer-site`, chạy `npm install` rồi `npm run build:zip`. Mặc định, ZIP được tạo tại `dist/customer-store.zip`. Có thể truyền cấu hình khi đóng gói:

\`\`\`bash
node tools/build-zip.mjs --config ./store.json --api-url https://YOUR-WORKER.workers.dev --pages-origin https://YOUR-STORE.pages.dev --output ./dist/customer-store.zip
\`\`\`

Bộ đóng gói bao gồm mã nguồn Worker, schema D1, cấu hình Wrangler, storefront, trang quản trị và README. Nó không chứa `ADMIN_API_TOKEN`, API key hoặc dữ liệu khách hàng. Đây là ZIP mã nguồn để khách hàng tự triển khai, không phải website đã được host sẵn. Sau khi giải nén, khách hàng vẫn phải tạo D1 database, cập nhật database ID, đặt secret, triển khai Worker và tải thư mục `site` lên Pages theo hướng dẫn bên dưới.

## Chạy và triển khai
1. Tạo D1 database: `npx wrangler d1 create customer-store-db`.
2. Điền database ID vào `wrangler.toml`.
3. Áp dụng schema: `npx wrangler d1 execute customer-store-db --remote --file=./schema.sql`.
4. Cài công cụ: `npm install`.
5. Đặt secret quản trị: `npx wrangler secret put ADMIN_API_TOKEN` (tạo token dài, ngẫu nhiên; không dùng mật khẩu dễ đoán).
6. Cấu hình `ALLOWED_ORIGIN` trong `wrangler.toml` thành origin chính xác của trang Pages, không có dấu / cuối.
7. Triển khai API: `npm run deploy`.
8. Mở `site/index.html`, thay `API_BASE` bằng URL Worker đã triển khai và tải thư mục `site` lên Cloudflare Pages.

## Quản trị

Mở `admin.html` sau khi triển khai trang Pages. Nhập `ADMIN_API_TOKEN` đã đặt bằng Wrangler secret. Backend xác thực token một lần qua `POST /api/admin/login`, sau đó cấp session token ngẫu nhiên có thời hạn 30 phút. Database chỉ lưu SHA-256 hash của session token; session hết hạn tự động bị từ chối. Nút đăng xuất gọi endpoint thu hồi session. Trình duyệt chỉ giữ session token trong bộ nhớ tab, không ghi vào localStorage/sessionStorage. Nếu nghi ngờ token quản trị gốc bị lộ, hãy thay secret ngay.

Bảng `admin_sessions` đã có trong `schema.sql`; khi triển khai database mới, chỉ cần chạy schema theo hướng dẫn. Nếu đã tạo database trước đó, áp dụng migration mới:
`npx wrangler d1 execute customer-store-db --remote --file=./migrations/0002_admin_sessions.sql`.

Các endpoint:
- `GET /api/products`: danh sách sản phẩm đang hiển thị.
- `POST /api/orders`: tạo đơn hàng.
- `GET /api/admin/orders`: xem đơn hàng (admin).
- `POST /api/admin/login`: đổi token quản trị thành phiên đăng nhập ngắn hạn.\n- `POST /api/admin/logout`: thu hồi phiên hiện tại.\n- `GET /api/admin/products`: xem tất cả sản phẩm kể cả sản phẩm đang ẩn (admin).
- `POST /api/admin/products`: tạo sản phẩm (admin).
- `PATCH /api/admin/products/:id`: bật/tắt hiển thị sản phẩm (admin).
- `PATCH /api/admin/orders/:id`: cập nhật trạng thái đơn (admin).\n- `GET /api/admin/audit-log`: xem 100 hoạt động quản trị gần nhất (admin).

## Nhật ký quản trị và sao lưu

Dashboard quản trị hiển thị tối đa 100 hoạt động gần nhất. Backend ghi nhận lúc tạo sản phẩm, bật/tắt hiển thị sản phẩm và đổi trạng thái đơn hàng. Nhật ký chỉ đọc qua phiên quản trị hợp lệ; không có API công khai để sửa hoặc xóa nhật ký. Nội dung nhật ký tránh lưu email, số điện thoại hoặc ghi chú của người mua.

Database mới đã có bảng `admin_audit_log` trong `schema.sql`. Nếu database đã tồn tại, áp dụng migration:
`npx wrangler d1 execute customer-store-db --remote --file=./migrations/0003_admin_audit_log.sql`.

### Sao lưu D1

Chạy lệnh từ thư mục dự án đã giải nén:
`npx wrangler d1 export customer-store-db --remote --output=./backup-customer-store.sql`.

Giữ file sao lưu ở nơi riêng tư, mã hóa và giới hạn người có quyền truy cập. Định kỳ tạo bản sao trước khi cập nhật schema hoặc triển khai thay đổi lớn. Để khôi phục vào database mới/đã chuẩn bị, kiểm tra nội dung file trước rồi chạy:
`npx wrangler d1 execute customer-store-db --remote --file=./backup-customer-store.sql`.

Thử khôi phục trên database thử nghiệm trước khi dùng bản sao cho cửa hàng thật. File SQL có thể chứa dữ liệu cá nhân của khách mua hàng; không tải công khai lên GitHub hoặc gửi qua liên kết công khai. Xác minh cú pháp lệnh theo phiên bản Wrangler đang cài trước khi thao tác production.

## Giới hạn và an toàn
- Đây là starter template để thử nghiệm, chưa phải nền tảng thương mại điện tử production-ready.
- Chưa có đăng nhập khách hàng, thanh toán trực tuyến, email, upload ảnh, tồn kho, vận chuyển hoặc chống bot nâng cao.
- Không lưu thông tin thẻ thanh toán. Chỉ bổ sung cổng thanh toán chính thức sau khi chủ website tự đăng ký tài khoản nhà cung cấp.
- Bảo vệ ADMIN_API_TOKEN; nếu lộ, hãy thay secret ngay. Session 30 phút không thay thế việc bảo vệ token gốc.
- Đặt giới hạn chi tiêu/cảnh báo ở Cloudflare. Không bật tự động nâng cấp hoặc overage nếu chưa hiểu chi phí.
- Dữ liệu thuộc D1 database của chính khách hàng. Khách hàng phải tự sao lưu và quản lý dữ liệu.

### Cá nhân hóa ZIP theo yêu cầu
Tạo file JSON cấu hình (ví dụ `store.json`) trước khi đóng gói:
```json
{
  "storeName": "Shop Hoa Mộc",
  "tagline": "Hoa tươi cho những dịp đặc biệt",
  "primaryColor": "#2563eb",
  "products": [
    {
      "name": "Bó hoa hướng dương",
      "description": "Bó hoa tươi, gói giấy kraft",
      "priceVnd": 350000,
      "imageUrl": "https://example.com/hoa.jpg"
    }
  ]
}
```
Chạy lệnh có `--config ./store.json`. Tên cửa hàng, câu giới thiệu, màu chủ đạo và tối đa 30 sản phẩm mẫu hợp lệ sẽ được đưa vào ZIP. Sản phẩm mẫu được ghi vào `seed-products.sql`; sau khi tạo D1, khách phải chạy file SQL này một lần để nhập sản phẩm. Ảnh chỉ nhận đường dẫn HTTPS. Công cụ không tự tải ảnh hoặc xác minh quyền sử dụng ảnh. Dữ liệu cấu hình cần được kiểm tra trước khi đóng gói và không nên chứa thông tin cá nhân nhạy cảm.
\n\n## Thanh toán và bàn giao đơn hàng\n\nTrang quản trị tách riêng trạng thái thanh toán (chưa thanh toán / đã thanh toán / đã hoàn tiền) và bàn giao (chưa bàn giao / đã bàn giao). Backend từ chối đánh dấu đã bàn giao nếu đơn chưa được xác nhận đã thanh toán. Việc xác nhận tiền vẫn phải dựa trên giao dịch thực tế.\n\nDatabase mới có hai cột payment_status và delivery_status trong schema.sql. Với database đã tạo trước đó, áp dụng migration 0004_payment_delivery.sql trước khi triển khai backend mới.\n\nLưu ý: đánh dấu đã bàn giao hiện là ghi nhận thủ công, chưa tự động gửi file. Chưa có endpoint tải xuống; chỉ mở luồng tải sau khi cấu hình kho lưu trữ riêng tư và quyền truy cập theo đơn hàng.\n
 
## File bàn giao riêng tư (R2)
Tạo bucket riêng: `npx wrangler r2 bucket create customer-store-private-deliveries`. Worker dùng binding `DELIVERIES` trong wrangler.toml; bucket không bật public access. Áp dụng migration `0005_private_deliveries.sql` cho database cũ; database mới chạy schema.sql.

Quản trị viên gửi file dạng multipart/form-data với field `file` đến `POST /api/admin/orders/:id/delivery-file`. Cho phép PDF, TXT, ZIP, DOCX, PNG, JPG và SVG; giới hạn 20 MiB. File lưu trong R2, không tạo URL công khai. Sau khi đã xác nhận thanh toán và đánh dấu bàn giao, quản trị viên gọi `POST /api/admin/orders/:id/delivery-link`. Link tải có hạn 24 giờ và chỉ dùng một lần. Endpoint tải kiểm tra lại trạng thái đơn, rồi đọc object từ bucket riêng tư.

Các route này yêu cầu session quản trị hợp lệ. Không gửi file qua public R2 URL. Nếu upload thay file cũ, object cũ cần được dọn định kỳ; không xóa thủ công bucket đang dùng. Chưa có giao diện nút upload/cấp link trong admin dashboard; các endpoint là nền backend, cần nối UI ở bước kế tiếp.

## Sao lưu dữ liệu
Trước khi chạy migration hoặc cập nhật Worker, nên xuất bản sao D1:
`npx wrangler d1 export customer-store-db --remote --output=./backup-customer-store.sql`.
Giữ file backup ở nơi riêng tư; không đưa dữ liệu khách hàng vào ZIP phát hành hoặc commit lên GitHub.

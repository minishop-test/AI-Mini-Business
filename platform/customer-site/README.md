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
- `PATCH /api/admin/orders/:id`: cập nhật trạng thái đơn (admin).

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

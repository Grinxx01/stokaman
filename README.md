# Stokaman

Aplikasi kasir dan manajemen stok berbasis Express.js + TypeScript dengan pemindai barcode langsung dari kamera HP dan estimasi tanggal kadaluarsa otomatis.

## Fitur

- Kasir dengan keranjang dan pembayaran (stok otomatis berkurang)
- Manajemen stok: tambah, ubah, restock, hapus produk
- Pencatatan tanggal kadaluarsa per produk beserta peringatan (kadaluarsa / sisa <= 7 hari / stok kritis)
- Scan barcode lewat kamera HP (html5-qrcode, format EAN-13, EAN-8, UPC, Code128, dll)
- Pencarian data produk otomatis dari Open Food Facts saat scan barcode yang belum terdaftar
- Estimasi kadaluarsa otomatis berdasarkan kategori produk (susu, roti, makanan kaleng, dll)
- Riwayat transaksi

## Cara Menjalankan

1. Install dependency:

   ```
   npm install
   ```

2. Salin `.env.example` menjadi `.env` lalu isi `SUPABASE_URL` dan `SUPABASE_KEY`.

3. Setup database Supabase:

   - Buka dashboard Supabase -> SQL Editor
   - Salin seluruh isi `supabase/schema.sql` lalu jalankan
   - File ini membuat tabel `products`, `transactions`, `transaction_items`, trigger `updated_at`, dan fungsi `checkout` yang menangani pengurangan stok secara atomik

4. Jalankan:

   ```
   npm run dev
   ```

   Buka `http://localhost:3000` dari browser HP (satu jaringan WiFi) untuk memakai fitur scan kamera. Kamera butuh HTTPS saat diakses dari perangkat lain; gunakan tunnel seperti `ngrok` atau `cloudflared tunnel --url http://localhost:3000`.

## Catatan Keamanan

Tabel dibuat tanpa Row Level Security supaya bisa dipakai langsung dengan publishable key untuk penggunaan internal/pribadi. Jika aplikasi akan dipublikasikan, aktifkan RLS di Supabase dan gunakan service role key di server.

## API

| Method | Endpoint | Keterangan |
| --- | --- | --- |
| GET | `/api/products` | Daftar produk |
| GET | `/api/products/lookup/:barcode` | Cek produk di database atau Open Food Facts + saran kadaluarsa |
| POST | `/api/products` | Tambah atau perbarui produk (upsert berdasarkan barcode) |
| PATCH | `/api/products/:id` | Ubah data produk |
| POST | `/api/products/:id/restock` | Tambah/kurangi stok (`{"amount": 10}`) |
| DELETE | `/api/products/:id` | Hapus produk |
| POST | `/api/transactions` | Checkout (`{"items":[{"product_id":"...","qty":2}]}`) |
| GET | `/api/transactions` | Riwayat transaksi |

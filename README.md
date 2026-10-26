# 💸 Nyatet - Bot Telegram Pencatat Pengeluaran Otomatis

Aplikasi bot Telegram cerdas berbasis **Node.js** yang mencatat pengeluaran keuangan pribadi langsung ke **Google Sheets** sebagai database. Didukung oleh **Sumopod AI** (OpenAI-compatible) untuk mengekstrak data dari:
1. 💬 **Chat Teks** (contoh: *"beli kopi 25rb sama makan siang 45k"*)
2. 📸 **Foto Struk / Bon Belanjaan / Bukti QRIS**
3. 🎙️ **Voice Note (VN)** (contoh: *"tadi isi bensin motor lima puluh ribu"*)

---

## 🛠️ Fitur Utama
- **AI Processing (Sumopod AI)**: Menggunakan model AI canggih (seperti `gpt-4o-mini`, `deepseek-chat`, dll) melalui endpoint Sumopod AI untuk ekstraksi pengeluaran cerdas berformat JSON.
- **Auto-Formatting Google Sheets**: Otomatis membuat tabel dengan kolom:
  `Tanggal | Waktu | Nominal (Rp) | Kategori | Keterangan | Catatan Tambahan | Sumber Input | Pengirim`
- **Multi-item Parsing**: Jika ada lebih dari satu barang dalam 1 pesan atau 1 struk, bot akan mencatat masing-masing baris secara otomatis.
- **Whitelist Keamanan**: Fitur opsional untuk membatasi bot agar hanya merespons akun Telegram pemilik (`ALLOWED_TELEGRAM_USER_IDS`).

---

## 🚀 Panduan Setup Langkah Demi Langkah

### 1. Dapatkan Telegram Bot Token
1. Buka aplikasi Telegram dan cari bot **`@BotFather`**.
2. Kirim perintah `/newbot` dan ikuti panduan (beri nama bot dan username yang berakhiran `bot`).
3. Salin token API yang diberikan (contoh: `7123456789:AAH...`).

### 2. Dapatkan Sumopod AI API Key
1. Buka [Sumopod AI](https://ai.sumopod.com/).
2. Login ke akun kamu.
3. Masuk ke menu **AI** $\rightarrow$ **API Keys** $\rightarrow$ **Create Key** (`+ API Key`).
4. Salin API Key (`sk-...`) yang dihasilkan dan pastikan ada balance/kredit aktif.

### 3. Setup Google Sheets & Service Account
1. **Buat Google Sheet Baru**:
   - Buka [Google Sheets](https://sheets.new).
   - Beri nama (misal: *Keuangan Pribadi*).
   - Salin **Spreadsheet ID** dari URL browser:
     `https://docs.google.com/spreadsheets/d/`**`<SPREADSHEET_ID_KAMU>`**`/edit`
2. **Buat Service Account (Google Cloud)**:
   - Buka [Google Cloud Console](https://console.cloud.google.com/).
   - Buat Project baru (atau pilih project yang ada).
   - Masuk ke **APIs & Services** $\rightarrow$ **Library**, cari **Google Sheets API**, lalu klik **Enable**.
   - Masuk ke **APIs & Services** $\rightarrow$ **Credentials** $\rightarrow$ **Create Credentials** $\rightarrow$ **Service Account**.
   - Beri nama service account (misal: `bot-nyatet`), klik **Done**.
   - Klik service account yang baru dibuat, masuk ke tab **Keys** $\rightarrow$ **Add Key** $\rightarrow$ **Create new key** $\rightarrow$ pilih **JSON**.
   - File JSON kredensial akan otomatis terdownload ke komputer kamu.
   - Simpan file tersebut di folder project ini dengan nama `service-account.json`.
3. **Share Google Sheet ke Service Account**:
   - Buka file `service-account.json`, cari nilai `"client_email"` (contoh: `bot-nyatet@project-id.iam.gserviceaccount.com`).
   - Buka Google Sheet kamu, klik tombol **Share / Bagikan** di kanan atas.
   - Masukkan email service account tersebut dengan akses **Editor**, lalu simpan.

---

## ⚙️ Konfigurasi Environment (`.env`)

1. Salin template `.env.example` menjadi `.env`:
   ```bash
   cp .env.example .env
   ```
2. Buka file `.env` dan lengkapi nilainya:
   ```env
   TELEGRAM_BOT_TOKEN=token_bot_kamu_dari_botfather
   SUMOPOD_API_KEY=sk-sumopod_api_key_kamu
   SUMOPOD_BASE_URL=https://ai.sumopod.com/v1
   SUMOPOD_MODEL=gpt-4o-mini
   GOOGLE_SPREADSHEET_ID=spreadsheet_id_kamu
   GOOGLE_SHEET_NAME=Pengeluaran
   GOOGLE_SERVICE_ACCOUNT_KEY_FILE=./service-account.json
   ALLOWED_TELEGRAM_USER_IDS=
   ```

---

## 🏃 Menjalankan Aplikasi

### Di Komputer Lokal (Development)
```bash
# Jalankan bot dengan auto-reload
npm run dev

# Atau jalankan biasa
npm start
```

### Di Server / VPS (Production)
Disarankan menggunakan **PM2** agar bot tetap berjalan di background dan otomatis restart jika server reboot:
```bash
# Install PM2 secara global di VPS (jika belum ada)
npm install -g pm2

# Jalankan bot
pm2 start src/index.js --name "bot-nyatet"

# Simpan proses agar otomatis jalan saat boot
pm2 save
pm2 startup
```

---

## 💬 Contoh Penggunaan di Telegram

### 1. Mencatat Pengeluaran
- **Teks**: `beli kopi kenangan 28rb` atau `isi bensin 45k bayar qris`
- **Foto**: Kirimkan foto struk belanjaan Indomaret / Alfamart / bon restoran / struk QRIS.
- **Voice Note**: Tahan mic Telegram dan bicara santai: *"Tadi beli martabak manis tiga puluh lima ribu"*.

### 2. Melihat Laporan & Rekap Keuangan
- `/rekap` : Membuka dashboard laporan interaktif (bisa klik tombol Hari Ini, 7 Hari, Bulan Ini, Tahun Ini).
- `/hari` : Melihat total dan rincian pengeluaran hari ini.
- `/minggu` : Melihat rekap 7 hari terakhir.
- `/bulan` : Melihat rekap bulan ini beserta breakdown per kategori.
- `/tahun` : Melihat total pengeluaran tahun berjalan.

### 3. Analisa Mendalam (Deep Financial Analysis)
- `/analisa` : Meminta Sumopod AI menganalisis kebiasaan belanja, deteksi kebocoran finansial (latte factor), titik rawan, rekomendasi aksi hemat konkret, dan skor kesehatan finansial.
- Kamu juga bisa menyertakan periode: `/analisa minggu` atau `/analisa tahun`.

### 4. Edit & Hapus Transaksi Tertentu
- `/list` : Menampilkan daftar transaksi terakhir lengkap dengan nomor baris `[#...]`.
- `/hapus <nomor_baris>` : Menghapus baris transaksi dari Google Sheet (contoh: `/hapus 8`).
- `/edit <nomor_baris> <perubahan>` : Mengubah data transaksi dengan bantuan AI (contoh: `/edit 8 ganti nominal jadi 35rb bayar bca`).

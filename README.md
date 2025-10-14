# Mainra Games - Content Management System

## Deskripsi
Website Mainra Games dengan sistem manajemen konten untuk mengelola game secara lokal. Sistem ini memungkinkan pengelolaan konten game melalui halaman admin tanpa memerlukan database server.

## Fitur
- ✅ Halaman admin untuk mengelola konten game
- ✅ Tambah, edit, dan hapus game
- ✅ Upload otomatis file JSON yang diperbarui
- ✅ Responsive design untuk desktop dan mobile
- ✅ Data game dinamis di halaman utama
- ✅ Form validation dan error handling

## Struktur File

## Struktur Proyek dan Alur Data

- Halaman publik:
  - index.html — menampilkan highlight dan 3 game terbaru (via js/games-loader.js).
  - games.html — menampilkan Highlight Game + daftar game, dilengkapi helper carousel minimal.
  - services.html, learning.html, privacy-policy.html, terms-of-use.html, dsb.
- Halaman admin:
  - admin.html — untuk tambah/edit/hapus game dan set Highlight.
  - Script: js/game-scraper.js (ambil data dasar Play Store), js/admin.js (UI admin & penyimpanan).
- Data:
  - games-data.json — sumber data default yang dikomit ke repo.
  - localStorage — override lokal di browser untuk perubahan cepat tanpa server.
    - Key yang dipakai: 'mainra-games' dan 'mainra-games-data' (keduanya disimpan untuk kompatibilitas).
- Sinkronisasi:
  - js/games-sync.js — memakai BroadcastChannel dan CustomEvent agar perubahan dari admin tersebar ke tab/halaman lain.
  - js/games-loader.js — membaca data dari localStorage terlebih dulu, lalu fallback ke games-data.json.

## Cara Kerja

1. Admin mengubah data di admin.html
   - Perubahan disimpan ke localStorage ('mainra-games' dan 'mainra-games-data').
   - Event sinkronisasi dikirim (BroadcastChannel + CustomEvent) agar tab lain segera merender ulang.
2. Halaman publik membaca data
   - Cek localStorage dulu → bila tidak ada, ambil dari games-data.json.
   - Render Highlight + daftar game. Di homepage hanya 3 game terbaru.

## Praktik Terbaik

- Setelah puas dengan perubahan di admin, klik Export JSON untuk menghasilkan games-data.json baru dan commit ke repo.
- Jangan menyisipkan kelas atau data dummy langsung ke HTML (seperti dummy JSON atau class simulasi) — gunakan file JS/JSON yang sudah ada.
- Pastikan urutan script:
  - games-loader.js → games-sync.js → nav.js (untuk halaman publik)
  - game-scraper.js → admin.js (untuk halaman admin)

## Catatan Perapihan & Perbaikan

- Memindahkan/menjaga logika sinkronisasi hanya di js/games-sync.js.
- Menghapus blok class/logic yang tersisip salah di js/games-loader.js.
- Membersihkan games.html dari data dummy dan class simulasi, serta menambahkan helper carousel minimal yang valid.
- Menambahkan setupSyncListeners dan broadcast perubahan pada js/admin.js, serta menyimpan ke 2 key localStorage untuk kompatibilitas.
- Membersihkan src/main/webapp/js/game-manager.js agar tidak mengandung tag </script> dan tidak memanggil fungsi yang tidak ada.


## Proteksi Halaman Admin di Vercel

Agar hanya pengguna yang memiliki akses yang dapat membuka halaman admin (admin.html), repo ini sudah disiapkan dengan Basic Auth berbasis Vercel Serverless Function.

Ringkasnya:
- File api/basic-auth.js melakukan challenge HTTP Basic Auth dan, jika sukses, memberi cookie HttpOnly admin_auth=1.
- File vercel.json mengarahkan setiap akses ke /admin.html menuju fungsi tersebut kecuali sudah punya cookie admin_auth=1.

Langkah setup di Vercel:
1. Deploy project ini ke Vercel (New Project → Import dari GitHub/ZIP).
2. Buka Project Settings → Environment Variables, tambahkan:
   - ADMIN_USER = username-admin-anda
   - ADMIN_PASS = password-kuat-anda
3. Redeploy (atau lakukan Deploy ulang) agar environment variables aktif.
4. Akses https://<project>.vercel.app/admin.html → browser akan memunculkan Basic Auth prompt. Masukkan kredensial dari langkah 2.
5. Jika benar, Anda akan diarahkan ke halaman admin dan cookie admin_auth=1 akan diset (berlaku 7 hari).

Catatan:
- Untuk keluar (logout), hapus cookie admin_auth dari browser (mis. via DevTools → Application → Cookies) atau gunakan jendela penyamaran.
- Fungsi ini bekerja tanpa mengubah admin.html sehingga perubahan minimal dan aman dari sisi klien.
- Pastikan project berjalan dengan HTTPS (default di Vercel) agar Secure cookie berfungsi.
- Endpoint PHP (api/playstore-scraper.php) mungkin tidak berjalan di Vercel tanpa runtime tambahan. Admin tetap bisa menambahkan game karena scraper sisi-klien memiliki fallback melalui proxy CORS.

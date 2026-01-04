# Mainra Games

## Deskripsi
Website Mainra Games menampilkan koleksi game dari Mainra Team. Website ini bersifat statis dan mengambil data dari file `games-data.json`.

## Fitur
- ✅ Menampilkan game unggulan (Highlight)
- ✅ Daftar game yang responsif
- ✅ Desain modern untuk desktop dan mobile
- ✅ Data game dinamis dari JSON

## Struktur File
- `index.html` — Halaman utama menampilkan highlight dan 3 game terbaru.
- `games.html` — Daftar lengkap game dan highlight.
- `Assets/data/games-data.json` — Sumber data game.
- `Assets/js/games-loader.js` — Logika untuk memuat dan merender data game ke halaman.
- `Assets/js/nav.js` — Kontrol navigasi dan menu mobile.
- `Assets/css/mainra.css` — Gaya visual website.
- `Assets/img/` — Folder berisi gambar dan ikon website.

## Cara Kerja
1. Data game dikelola melalui file `Assets/data/games-data.json`.
2. Halaman web membaca file JSON tersebut saat dimuat.
3. Konten dirender secara dinamis ke dalam elemen-elemen HTML yang sesuai.

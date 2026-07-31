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
- `app-ads.txt` — Daftar authorized seller untuk inventory aplikasi di Google AdMob.
- `sellers.json` — Referensi seller lokal dengan publisher ID AdMob.

## Cara Kerja
1. Data game dikelola melalui file `Assets/data/games-data.json`.
2. Halaman web membaca file JSON tersebut saat dimuat.
3. Konten dirender secara dinamis ke dalam elemen-elemen HTML yang sesuai.

## AdMob sellers.json dan app-ads.txt

Publisher ID yang digunakan project ini adalah `pub-5867723400368399`. File `app-ads.txt` sudah berisi otorisasi Google AdMob yang sesuai:

```text
google.com, pub-5867723400368399, DIRECT, f08c47fec0942fa0
```

`sellers.json` yang ada di root project menyimpan referensi seller dengan `seller_type` `PUBLISHER` dan nama `Mainra Games`. Untuk akun publisher seperti ini, file tersebut bukan file yang harus di-host sendiri agar AdMob mengenal seller. Google menerbitkan file sellers.json authoritative di `https://realtimebidding.google.com/sellers.json`.

Agar informasi seller muncul transparan di file Google:

1. Buka AdMob → **Settings** → **Account**.
2. Pada **Seller information (sellers.json)**, pilih **Transparent** lalu simpan.
3. Tambahkan `mainragames.com` sebagai business domain di AdMob hanya setelah domain tersebut diverifikasi. Domain tidak boleh menggunakan `https://`, `www`, subdomain, atau trailing slash.
4. Pastikan nama `Mainra Games` sama persis dengan nama pada payments profile AdMob. Jangan mengubah nama di file repository untuk menggantikan pengaturan tersebut.
5. Tunggu hingga 7 hari, lalu cari `pub-5867723400368399` pada file sellers.json Google untuk memverifikasi hasilnya.

File lokal ini sekarang mencatat `domain` dan `is_confidential: false` sebagai referensi konfigurasi transparan yang diinginkan. Namun, file ini bukan sumber authoritative AdMob dan tidak memverifikasi kepemilikan domain. Status transparansi, nama seller, dan domain authoritative tetap dikendalikan dari AdMob; verifikasi domain harus dilakukan di sana terlebih dahulu.

# Mainra Games

## Deskripsi
Website Mainra Games menampilkan koleksi game dari Mainra Team. Website ini statis, datanya dikelola melalui **Supabase CMS** dan di-cache di file `games-data.json`.

## Fitur
- ✅ Menampilkan game unggulan (Highlight)
- ✅ Daftar game yang responsif
- ✅ Desain modern untuk desktop dan mobile
- ✅ Data game dinamis dari Supabase (fallback ke JSON lokal)
- ✅ Dashboard admin di `/mrmainra/` untuk kelola game, highlight, dan balasan review

## Struktur File
- `index.html` — Halaman utama menampilkan highlight dan 3 game terbaru.
- `games.html` — Daftar lengkap game dan highlight.
- `Assets/data/games-data.json` — Cache data game (dihasilkan dari Supabase oleh GitHub Actions).
- `Assets/js/games-loader.js` — Logika untuk memuat data game (Supabase → fallback JSON) dan merendernya.
- `Assets/js/supabase-config.js` — URL project + publishable key Supabase (nilai publik, aman untuk browser).
- `Assets/js/supabase-client.js` — Inisialisasi `window.supabaseClient`.
- `mrmainra/index.html` + `mrmainra/assets/admin.js|admin.css` — Dashboard admin (login Supabase Auth, RLS gated, Games, Analytics & Reviews, Social Broadcast, Contact Form Inbox, Admins).
- `Assets/js/nav.js` — Kontrol navigasi dan menu mobile.
- `Assets/css/mainra.css` — Gaya visual website.
- `Assets/img/` — Folder berisi gambar dan ikon website.
- `supabase/` — Migration SQL, seed, dan Edge Functions (`sync-playstore`, `sync-reviews`, `sync-tracks`, `sync-voided-purchases`, `sync-inappproducts`, `sync-store-listings`, `sync-vitals`, `sync-conversions`, `verify-purchase`, `process-review-queue`, `sync-buffer`, `ai-social-assistant`, `manage-admins`).
- `supabase/migrations/0018_game_tracks_and_releases.sql` — Kolom metadata track, staged rollout status, version, dan changelog/release notes resmi dari Play Console.
- `supabase/migrations/0019_game_voided_purchases.sql` — Tabel transaksi dibatalkan, di-refund, dan chargeback/fraud (IAP).
- `supabase/migrations/0020_game_inapp_products.sql` — Tabel katalog In-App Products (IAP), SKU, harga lokal, deskripsi, dan etalase toko.
- `supabase/migrations/0021_game_store_listings.sql` — Tabel multi-language store listings (title, short description, full description, video promo).
- `supabase/migrations/0022_game_vitals_metrics.sql` — Tabel metrik stabilitas Android Vitals (Crash Rate, ANR Rate, Bad Behavior Thresholds).
- `tools/sync-supabase.js` — Mirror JSON → Supabase (insert-only, aman untuk edit admin).
- `tools/pull-supabase.js` — Bangun ulang `games-data.json` dari Supabase.
- `tools/sync-playstore-reviews.js` — Tarik review Play Store & posting balasan admin (butuh Play Developer API).
- `tools/sync-playstore-tracks.js` — Tarik track rilis, status staged rollout, dan changelog resmi via Play Developer API (`edits.tracks`).
- `tools/sync-playstore-voided-purchases.js` — Tarik riwayat voided purchases, deteksi refund abuse, dan fraud/chargeback via Play Developer API (`purchases.voidedpurchases`).
- `tools/sync-playstore-inappproducts.js` — Tarik katalog SKU produk in-game, harga IDR/USD, dan status IAP via Play Developer API (`inappproducts`).
- `tools/sync-playstore-listings.js` — Sinkronisasi 2 arah deskripsi toko dan metadata multibahasa via Play Developer API (`edits.listings`).
- `tools/sync-playstore-vitals.js` — Tarik metrik stabilitas teknis crash rate & ANR rate via Google Play Developer Reporting API (`vitals.crashrate`, `vitals.anrrate`).
- `app-ads.txt` — Daftar authorized seller untuk inventory aplikasi di Google AdMob.
- `sellers.json` — Referensi seller lokal dengan publisher ID AdMob.

## Cara Kerja (CMS)
1. **Sumber kebenaran data game adalah Supabase** (project `mainragames.com`, table `games`, `game_reviews`, `site_settings`, `admin_users`).
2. Halaman publik membaca langsung dari Supabase via publishable key; bila gagal/offline, fallback ke `Assets/data/games-data.json`.
3. GitHub Actions harian (`update-games.yml`): scrape Play Store → mirror game baru ke Supabase (insert-only) → tarik konten terbaru dari Supabase untuk membangun ulang `games-data.json` → commit bila berubah.
4. Dashboard admin (`/mrmainra/`) dipakai untuk edit game, atur featured/highlight, dan membalas review. akses dibatasi RLS: hanya user yang terdaftar di `public.admin_users`.
5. Balasan review untuk game Play Store disimpan sebagai draft di `game_reviews.reply_text`; job sync (Actions atau tombol Fetch) mem-posting-nya ke Google Play via Play Developer API bila `GOOGLE_SERVICE_ACCOUNT_JSON` diset.

## Setup Admin & Supabase
1. **Grant admin**: login Supabase → Authentication → tambahkan user, lalu jalankan:
   ```sql
   insert into public.admin_users (user_id, email)
   select id, email from auth.users where email = 'email-anda@example.com';
   ```
2. **Secrets GitHub Actions** (Settings → Secrets and variables → Actions):
   - `SUPABASE_URL` = `https://mjuzjvyatunjmgaiqtdv.supabase.co`
   - `SUPABASE_SECRET_KEY` = service role key (`sb_secret_…` / legacy `service_role`) — **jangan pernah** ditulis ke file repo.
   - `GOOGLE_SERVICE_ACCOUNT_JSON` (opsional, untuk auto-post reply): JSON service account dari Google Cloud yang di-invite di Play Console dengan permission "Reply to reviews" lalu: `supabase secrets set GOOGLE_SERVICE_ACCOUNT_JSON=...` untuk Edge Function juga.
3. Deploy ulang Edge Functions bila diubah: `supabase functions deploy sync-playstore --no-verify-jwt && supabase functions deploy sync-reviews --no-verify-jwt && supabase functions deploy sync-tracks --no-verify-jwt && supabase functions deploy sync-voided-purchases --no-verify-jwt && supabase functions deploy sync-inappproducts --no-verify-jwt && supabase functions deploy sync-store-listings --no-verify-jwt && supabase functions deploy sync-vitals --no-verify-jwt && supabase functions deploy process-review-queue --no-verify-jwt`.
4. Dashboard: buka `https://mainragames.github.io/mrmainra/` (atau `https://mainragames.com/mrmainra/` setelah deploy) dan login.

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

File lokal ini sekarang mencatat `contact_email`, `contact_address`, `version`, `domain`, dan `is_confidential: false` sebagai referensi konfigurasi transparan yang diinginkan. Identifier TAG-ID sengaja tidak dicantumkan karena belum tersedia dan nilai `f08c47fec0942fa0` pada `app-ads.txt` bukan TAG-ID. Metadata dummy `ext.notice` juga tidak digunakan. File ini bukan sumber authoritative AdMob dan tidak memverifikasi kepemilikan domain. Status transparansi, nama seller, dan domain authoritative tetap dikendalikan dari AdMob; verifikasi domain harus dilakukan di sana terlebih dahulu.

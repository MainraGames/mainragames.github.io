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
- `learning.html` — Halaman Mainra Learning Community.
- `services.html` — Halaman layanan Mainra Games.
- `privacy-policy.html` — Halaman kebijakan privasi.
- `terms-of-use.html` — Halaman syarat dan ketentuan penggunaan.
- `Assets/data/games-data.json` — Cache data game (dihasilkan dari Supabase oleh GitHub Actions).
- `Assets/js/games-loader.js` — Logika untuk memuat data game (Supabase → fallback JSON) dan merendernya.
- `Assets/js/supabase-config.js` — URL project + publishable key Supabase (nilai publik, aman untuk browser).
- `Assets/js/supabase-client.js` — Inisialisasi `window.supabaseClient`.
- `mrmainra/index.html` + `mrmainra/assets/admin.js|admin.css` — Dashboard admin (login Supabase Auth, RLS gated, Games, Analytics & Reviews, Social Broadcast, Contact Form Inbox, Admins).
- `Assets/js/nav.js` — Kontrol navigasi dan menu mobile.
- `Assets/js/site.js` — Script halaman publik: carousel highlight, tahun footer otomatis, dan integrasi validasi form kontak.
- `Assets/js/contact-validation.js` — Aturan validasi form kontak publik (batas panjang mengikuti CHECK di migrasi `0024`); dipakai browser sekaligus diuji oleh `tools/tests/contact-inbox.test.mjs`.
- `Assets/css/mainra.css` — Gaya visual website.
- `Assets/img/` — Folder berisi gambar dan ikon website.
- `supabase/` — Migration SQL, seed, dan Edge Functions (`sync-playstore`, `sync-reviews`, `sync-tracks`, `sync-voided-purchases`, `sync-inappproducts`, `sync-store-listings`, `sync-vitals`, `sync-conversions`, `verify-purchase`, `upload-image`, `process-review-queue`, `sync-buffer`, `ai-social-assistant`, `manage-admins`).
- `supabase/migrations/0018_game_tracks_and_releases.sql` — Kolom metadata track, staged rollout status, version, dan changelog/release notes resmi dari Play Console.
- `supabase/migrations/0019_game_voided_purchases.sql` — Tabel transaksi dibatalkan, di-refund, dan chargeback/fraud (IAP).
- `supabase/migrations/0020_game_inapp_products.sql` — Tabel katalog In-App Products (IAP), SKU, harga lokal, deskripsi, dan etalase toko.
- `supabase/migrations/0021_game_store_listings.sql` — Tabel multi-language store listings (title, short description, full description, video promo).
- `supabase/migrations/0022_game_vitals_metrics.sql` — Tabel metrik stabilitas Android Vitals (Crash Rate, ANR Rate, Bad Behavior Thresholds).
- `supabase/migrations/0023_game_conversion_and_purchase_verification.sql` — Tabel `game_conversion_metrics` (funnel store listing: visitors, acquisitions, conversion rate per negara/sumber trafik) dan `game_purchase_verifications` (verifikasi + acknowledgment IAP sisi server).
- `supabase/migrations/0024_harden_contact_messages.sql` — CHECK panjang field `contact_messages` (nama 1-100, email 5-120, subjek ≤200, pesan 1-3000) dan policy insert publik yang hanya menerima `status = 'unread'` tanpa `reply_notes`.
- `supabase/migrations/0025_harden_review_queue_and_contact.sql` — Cabut EXECUTE helper pgmq (`read_/archive_/delete_review_queue`, `trigger_process_review_queue`) dari `anon`/`authenticated` lalu re-grant ke `service_role`, pin `search_path`, secret worker `review_queue_secret`, plus rate limit 5 pesan/jam per email dan `created_at` yang ditetapkan server pada `contact_messages`.
- `tools/sync-supabase.js` — Mirror JSON → Supabase (insert-only, aman untuk edit admin).
- `tools/pull-supabase.js` — Bangun ulang `games-data.json` dari Supabase.
- `tools/sync-playstore-reviews.js` — Tarik review Play Store & posting balasan admin (butuh Play Developer API).
- `tools/sync-playstore-tracks.js` — Tarik track rilis, status staged rollout, dan changelog resmi via Play Developer API (`edits.tracks`).
- `tools/sync-playstore-voided-purchases.js` — Tarik riwayat voided purchases, deteksi refund abuse, dan fraud/chargeback via Play Developer API (`purchases.voidedpurchases`).
- `tools/sync-playstore-inappproducts.js` — Tarik katalog SKU produk in-game, harga IDR/USD, dan status IAP via Play Developer API (`inappproducts`).
- `tools/sync-playstore-listings.js` — Sinkronisasi 2 arah deskripsi toko dan metadata multibahasa via Play Developer API (`edits.listings`).
- `tools/sync-playstore-vitals.js` — Tarik metrik stabilitas teknis crash rate & ANR rate via Google Play Developer Reporting API (`vitals.crashrate`, `vitals.anrrate`).
- `tools/*-utils.js` — Helper murni (mapping/parsing respons API Play, utilitas HTTP & data game) yang dipakai script sync dan diuji langsung oleh `tools/tests/`.
- `tools/tests/` — Suite pengujian Node (`npm test` dari folder `tools`, 38 test); termasuk `security-invariants.test.mjs` yang menegakkan invariant keamanan worker review-queue, kunci Gemini, dan migrasi `0025`.
- `app-ads.txt` — Daftar authorized seller untuk inventory aplikasi di Google AdMob.
- `sellers.json` — Referensi seller lokal dengan publisher ID AdMob.
- `sitemap.xml` — Daftar URL untuk crawler mesin pencari.
- `robots.txt` — Aturan crawl (mengizinkan `/`, termasuk `/app-ads.txt`).
- `CNAME` — Domain kustom GitHub Pages (`mainragames.com`).
- `.github/workflows/` — Workflow CI: `scheduled-sync.yml` (test + sync terjadwal) dan `vercel-diag.yml` (diagnostik).

## Cara Kerja (CMS)
1. **Sumber kebenaran data game adalah Supabase** (project `mainragames.com`, table `games`, `game_reviews`, `site_settings`, `admin_users`).
2. Halaman publik membaca langsung dari Supabase via publishable key; bila gagal/offline, fallback ke `Assets/data/games-data.json`.
3. GitHub Actions dua kali sehari (`scheduled-sync.yml`, `cron: '0 0,12 * * *'` = 00:00 & 12:00 UTC / 07:00 & 19:00 WIB). Job `test` menjalankan `npm test` dari folder `tools` lebih dulu; job `sync` (butuh job `test` lulus) lalu: scrape Play Store → mirror game baru ke Supabase (insert-only) → tarik konten terbaru dari Supabase untuk membangun ulang `games-data.json` → commit bila berubah.
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
   - `IAP_VERIFY_SECRET` (**wajib** untuk Edge Function `verify-purchase`): fungsi ini *fail-closed* — bila secret belum di-set, semua request dibalas **HTTP 503** dan verifikasi pembelian berhenti total. Set sebelum deploy: `supabase secrets set IAP_VERIFY_SECRET=...`.
   - Worker `process-review-queue` **tidak butuh env tambahan**: shared secret-nya dibaca dari tabel `site_settings` baris `review_queue_secret`, yang dibuat otomatis oleh migrasi `0025`. Trigger `pg_net` mengirimkannya sebagai header `x-worker-secret`, dan permintaan tanpa secret yang cocok ditolak dengan HTTP 401.

   > Setelah `IAP_VERIFY_SECRET` di-set, deploy ulang `verify-purchase`, kalau tidak semua verifikasi pembelian akan gagal dengan HTTP 503.
3. Deploy ulang Edge Functions bila diubah. Ulangi `supabase functions deploy <nama-fungsi> --no-verify-jwt` untuk **setiap folder** di `supabase/functions/` (14 fungsi): `sync-playstore`, `sync-reviews`, `sync-tracks`, `sync-voided-purchases`, `sync-inappproducts`, `sync-store-listings`, `sync-vitals`, `sync-conversions`, `verify-purchase`, `upload-image`, `process-review-queue`, `sync-buffer`, `ai-social-assistant`, `manage-admins`.
4. Dashboard: buka `https://mainragames.github.io/mrmainra/` (atau `https://mainragames.com/mrmainra/` setelah deploy) dan login.

## AdMob sellers.json dan app-ads.txt

Publisher ID yang digunakan project ini adalah `pub-5867723400368399`. File `app-ads.txt` sudah berisi otorisasi Google AdMob yang sesuai:

```text
google.com, pub-5867723400368399, DIRECT, f08c47fec0942fa0
```

`sellers.json` yang ada di root project menyimpan referensi seller dengan `seller_type` `PUBLISHER` dan nama `Faris Miqdad Al Barro'` (yaitu nama pemilik akun publisher pada file lokal ini). Untuk akun publisher seperti ini, file tersebut bukan file yang harus di-host sendiri agar AdMob mengenal seller. Google menerbitkan file sellers.json authoritative di `https://realtimebidding.google.com/sellers.json`.

Agar informasi seller muncul transparan di file Google:

1. Buka AdMob → **Settings** → **Account**.
2. Pada **Seller information (sellers.json)**, pilih **Transparent** lalu simpan.
3. Tambahkan `mainragames.com` sebagai business domain di AdMob hanya setelah domain tersebut diverifikasi. Domain tidak boleh menggunakan `https://`, `www`, subdomain, atau trailing slash.
4. Pastikan nama seller yang tampil di AdMob sama persis dengan nama pada payments profile AdMob. File repository hanya referensi lokal (namanya `Faris Miqdad Al Barro'`) — jangan mengubah file itu sebagai pengganti pengaturan di AdMob.
5. Tunggu hingga 7 hari, lalu cari `pub-5867723400368399` pada file sellers.json Google untuk memverifikasi hasilnya.

File lokal ini sekarang mencatat `contact_email`, `contact_address`, `version`, `domain`, dan `is_confidential: false` sebagai referensi konfigurasi transparan yang diinginkan. Identifier TAG-ID sengaja tidak dicantumkan karena belum tersedia dan nilai `f08c47fec0942fa0` pada `app-ads.txt` bukan TAG-ID. Metadata dummy `ext.notice` juga tidak digunakan. File ini bukan sumber authoritative AdMob dan tidak memverifikasi kepemilikan domain. Status transparansi, nama seller, dan domain authoritative tetap dikendalikan dari AdMob; verifikasi domain harus dilakukan di sana terlebih dahulu.

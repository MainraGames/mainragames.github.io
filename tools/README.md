# Tools untuk Update Games dari Google Play Store

Script ini digunakan untuk mengambil data game secara otomatis dari Google Play Store developer page dan memperbarui file `Assets/data/games-data.json`.

## Developer ID
- **ID**: `6814346565652097883`
- **URL**: https://play.google.com/store/apps/dev?id=6814346565652097883

## Instalasi

1. Install dependencies:
```bash
cd tools
npm install
```

## Metode yang Tersedia

### Metode 1: Google Play Scraper (default, dipakai CI) ⭐
Menggunakan library `google-play-scraper`. **Ini jalur default:** workflow `scheduled-sync.yml` menjalankan `npm run update-games`.

```bash
npm run update-games
```

**Keuntungan:**
- Ringan (tanpa membuka browser) dan cepat
- Jalur yang benar-benar dipakai CI, jadi selalu teruji terjadwal

**Kekurangan:**
- Bergantung pada library pihak ketiga yang bisa berubah sewaktu-waktu
- Bila muncul error "gplay.developer is not a function", gunakan metode Puppeteer di bawah

### Metode 2: Puppeteer (fallback otomatis)
Menggunakan Puppeteer untuk scraping langsung dari halaman Google Play Store. Dipakai otomatis sebagai fallback ketika `google-play-scraper` gagal, dan sudah terdaftar di `dependencies` `package.json` sehingga tidak perlu install terpisah.

```bash
npm run update-games:puppeteer
```

**Keuntungan:**
- Mengambil data langsung dari halaman web, tidak bergantung pada API internal library
- Mendukung lazy loading dan scroll otomatis

**Kekurangan:**
- Lebih berat dan lebih lambat karena perlu membuka browser

### Metode 3: Alternatif (RapidAPI)
Menggunakan RapidAPI untuk scraping (berbayar).

```bash
npm run update-games:alternative
```

**Untuk menggunakan RapidAPI:**
1. Daftar di [RapidAPI](https://rapidapi.com/)
2. Subscribe ke Google Play Store API
3. Set environment variable:
```bash
export RAPIDAPI_KEY=your_api_key_here
```

## Cara Penggunaan

### Manual Update (Sekali) - Recommended
```bash
cd tools
npm install
npm run update-games
```

**Paksa jalur Puppeteer (bila `google-play-scraper` gagal):**
```bash
npm run update-games:puppeteer
```

### Otomatis dengan GitHub Actions
Workflow-nya **sudah ada** di `.github/workflows/scheduled-sync.yml` — tidak perlu membuat file baru. Ringkasan alurnya:

```yaml
on:
  schedule:
    - cron: '0 0,12 * * *' # 00:00 & 12:00 UTC (07:00 & 19:00 WIB)
  workflow_dispatch:

jobs:
  test:
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
        working-directory: tools
      - run: npm test
        working-directory: tools

  sync:
    needs: test
    steps:
      - run: npm run update-games   # jalur google-play-scraper (fallback otomatis ke Puppeteer)
        working-directory: tools
      # dilanjutkan sync Supabase, review, tracks, voided purchases, IAP, listings, vitals, conversions,
      # lalu rebuild games-data.json dan commit bila berubah.
```

### Otomatis dengan Cron (Local/Server)
Tambahkan ke crontab:
```bash
0 0,12 * * * cd /path/to/project/tools && npm run update-games
```

## Struktur Data Output

Data akan disimpan di `Assets/data/games-data.json` dengan format:

`id` berisi **string package name** Android (sama dengan `appId`), bukan angka. Contoh nyata:

```json
{
  "games": [
    {
      "id": "com.MainraGames.Popit3DFidget",
      "title": "Nama Game",
      "short_description": "Deskripsi singkat dari Play Store",
      "description": "Deskripsi game",
      "image": "URL gambar",
      "screenshots": ["URL screenshot 1", "URL screenshot 2"],
      "playLink": "https://play.google.com/store/apps/details?id=com.MainraGames.Popit3DFidget",
      "category": "Game",
      "status": "Released",
      "releaseDate": "2024-01-15",
      "featured": true,
      "platform": "Android",
      "rating": 4.5,
      "appId": "com.MainraGames.Popit3DFidget"
    }
  ],
  "highlight": {
    "gameId": "com.MainraGames.Popit3DFidget",
    "customTitle": "Nama Game",
    "customDescription": "Deskripsi custom",
    "youtubeUrl": "",
    "stats": {
      "gameplay": "50+",
      "characters": "25+",
      "worlds": "5+"
    },
    "active": true,
    "lastUpdated": "2024-01-15T10:00:00.000Z"
  }
}
```

## Skrip Lain

Selain script update game, folder `tools/` memuat script sync berikut (semua dapat dijalankan dengan `npm run <script>` dari folder `tools`):

| npm script | File / perintah | Keterangan |
| --- | --- | --- |
| `update-games` | `update-games-from-playstore.js` | Scrape developer page via `google-play-scraper`; fallback otomatis ke Puppeteer bila gagal |
| `update-games:puppeteer` | `update-games-playstore-puppeteer.js` | Paksa scraping via Puppeteer |
| `update-games:alternative` | `update-games-alternative.js` | Scraping via RapidAPI (berbayar, butuh `RAPIDAPI_KEY`) |
| `sync-supabase` | `sync-supabase.js` | Mirror JSON → Supabase (insert-only, aman untuk edit admin) |
| `pull-supabase` | `pull-supabase.js` | Bangun ulang `Assets/data/games-data.json` dari Supabase |
| `sync-reviews` | `sync-playstore-reviews.js` | Tarik review Play Store & posting balasan admin |
| `sync-tracks` | `sync-playstore-tracks.js` | Track rilis, staged rollout, dan changelog resmi |
| `sync-voided-purchases` | `sync-playstore-voided-purchases.js` | Riwayat voided purchases, refund abuse, fraud/chargeback |
| `sync-inappproducts` | `sync-playstore-inappproducts.js` | Katalog SKU In-App Products (IAP) & harga lokal |
| `sync-listings` | `sync-playstore-listings.js` | Store listings multi-bahasa |
| `sync-vitals` | `sync-playstore-vitals.js` | Metrik Android Vitals (crash rate & ANR rate) |
| `sync-conversions` | `sync-playstore-conversions.js` | Funnel konversi store listing (visitors, acquisitions, conversion rate) |
| `test` | `node --test tests/*.test.mjs` | Jalankan suite pengujian (lihat bawah) |

Helper murni yang dipakai ulang script di atas dan oleh test ada di file `*-utils.js` (mis. `game-data-utils.js`, `http-utils.js`, `conversion-utils.js`, `purchase-verifier-utils.js`).

## Pengujian

```bash
cd tools
npm install   # atau npm ci
npm test
```

`npm test` menjalankan **38 test** di `tools/tests/*.test.mjs` (Node test runner bawaan, tanpa framework tambahan). Cakupannya meliputi mapping/parsing tiap sumber data Play (review, tracks, voided purchases, IAP, listings, vitals, conversions), validasi form kontak, ketahanan sync, dan `security-invariants.test.mjs` yang menegakkan invariant keamanan: worker `process-review-queue` wajib punya gate autentikasi sebelum membuat service-role client, daftar kunci Gemini tidak boleh mengirim kunci mentah ke response, `verify-purchase` harus fail-closed tanpa `IAP_VERIFY_SECRET`, dan migrasi `0025` harus mencabut EXECUTE fungsi pgmq dari `anon`/`authenticated` serta mem-pin `search_path`.

## Troubleshooting

### Error: Cannot find module 'puppeteer'
```bash
cd tools
npm install
```

### Error: gplay.developer is not a function
**Solusi:** Gunakan metode Puppeteer:
```bash
npm run update-games:puppeteer
```

### Error: Timeout atau tidak menemukan aplikasi
- Pastikan koneksi internet stabil
- Coba jalankan lagi (kadang Google Play Store lambat)
- Pastikan Developer ID benar: `6814346565652097883`

### Error: Puppeteer tidak bisa download Chromium
```bash
# Set environment variable untuk skip download
export PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
npm ci
# Puppeteer sudah menjadi dependency di package.json; install chromium manual hanya bila perlu
```

### Data tidak ter-update
- Periksa console log untuk error
- Pastikan file `Assets/data/games-data.json` bisa ditulis
- Cek apakah developer ID benar

## Catatan Penting

⚠️ **Penting:**
- Google Play Store tidak menyediakan API publik resmi
- Script ini menggunakan library pihak ketiga yang mungkin berubah
- Pastikan untuk menguji script secara berkala
- Pertimbangkan rate limiting jika menjalankan terlalu sering

## Alternatif Manual

Jika script otomatis tidak bekerja, Anda bisa:
1. Buka halaman developer di Google Play Store
2. Copy informasi setiap game
3. Update manual file `Assets/data/games-data.json`


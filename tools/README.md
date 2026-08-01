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

### Metode 1: Puppeteer (Recommended) ⭐
Menggunakan Puppeteer untuk scraping langsung dari Google Play Store. **Ini adalah metode yang paling reliable.**

```bash
npm run update-games:puppeteer
```

**Keuntungan:**
- Paling reliable dan up-to-date
- Tidak bergantung pada library pihak ketiga yang mungkin outdated
- Bisa mengambil data langsung dari halaman web
- Mendukung lazy loading dan scroll otomatis

**Kekurangan:**
- Memerlukan install Puppeteer (lebih besar ukurannya)
- Sedikit lebih lambat karena perlu membuka browser

### Metode 2: Google Play Scraper
Menggunakan library `google-play-scraper` (mungkin tidak bekerja karena library outdated).

```bash
npm run update-games
```

**Catatan:** Jika error "gplay.developer is not a function", gunakan metode Puppeteer di atas.

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

**Untuk menggunakan Puppeteer:**
```bash
npm install puppeteer
```

## Cara Penggunaan

### Manual Update (Sekali) - Recommended
```bash
cd tools
npm install
npm run update-games:puppeteer
```

**Atau jika Puppeteer tidak bekerja:**
```bash
npm run update-games
```

### Otomatis dengan GitHub Actions
Buat file `.github/workflows/update-games.yml`:

```yaml
name: Update Games from Play Store

on:
  schedule:
    - cron: '0 0 * * *' # Setiap hari jam 00:00 UTC
  workflow_dispatch: # Bisa dijalankan manual

jobs:
  update:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: '24'
      - run: |
          cd tools
          npm install
          npm run update-games:puppeteer
      - run: |
          git config --local user.email "action@github.com"
          git config --local user.name "GitHub Action"
          git add Assets/data/games-data.json
          git diff --staged --quiet || git commit -m "Auto-update games from Play Store"
          git push
```

### Otomatis dengan Cron (Local/Server)
Tambahkan ke crontab:
```bash
0 0 * * * cd /path/to/project/tools && npm run update-games:puppeteer
```

## Struktur Data Output

Data akan disimpan di `Assets/data/games-data.json` dengan format:

```json
{
  "games": [
    {
      "id": 1234567890,
      "title": "Nama Game",
      "description": "Deskripsi game",
      "image": "URL gambar",
      "screenshots": ["URL screenshot 1", "URL screenshot 2"],
      "playLink": "https://play.google.com/store/apps/details?id=...",
      "category": "Game",
      "status": "Released",
      "releaseDate": "2024-01-15",
      "featured": true,
      "platform": "Android",
      "rating": 4.5,
      "appId": "com.example.game"
    }
  ],
  "highlight": {
    "gameId": 1234567890,
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
npm install puppeteer
# Atau install chromium secara manual
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


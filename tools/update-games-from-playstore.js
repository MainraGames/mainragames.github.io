/**
 * Script untuk mengambil data game dari Google Play Store
 * Developer ID: 6814346565652097883
 * 
 * Cara penggunaan:
 * 1. Install dependencies: npm install
 * 2. Jalankan script: node tools/update-games-from-playstore.js
 * 
 * Script ini akan mengambil semua aplikasi dari developer page
 * dan memperbarui file Assets/data/games-data.json
 */

const path = require('path');
const {
    getStableGameId,
    readGamesData,
    resolveHighlightGameId,
    validateGames,
    writeGamesData
} = require('./game-data-utils');

// Developer ID dari Google Play Store
const DEVELOPER_ID = '6814346565652097883';
const DEVELOPER_URL = `https://play.google.com/store/apps/dev?id=${DEVELOPER_ID}`;

// Path ke file games-data.json
const GAMES_DATA_PATH = path.join(__dirname, '..', 'Assets', 'data', 'games-data.json');

/**
 * Mengambil data aplikasi dari Google Play Store menggunakan Google Play Scraper
 * Alternatif: Menggunakan API pihak ketiga atau scraping manual
 */
async function fetchGamesFromPlayStore() {
    try {
        // Opsi 1: Menggunakan google-play-scraper (perlu install: npm install google-play-scraper)
        const gplay = require('google-play-scraper');
        
        console.log('Mengambil data aplikasi dari Google Play Store...');
        console.log('Developer ID:', DEVELOPER_ID);
        
        // Cek method yang tersedia
        let apps = [];
        
        // Coba method developer dengan destructuring
        if (typeof gplay.developer === 'function') {
            apps = await gplay.developer({
                devId: DEVELOPER_ID,
                lang: 'en',
                country: 'us'
            });
        } 
        // Coba dengan method list jika developer tidak ada
        else if (typeof gplay.list === 'function') {
            // Method list memerlukan collection, coba dengan 'TOP_FREE_GAMES'
            // Tapi ini tidak spesifik untuk developer, jadi kita skip
            throw new Error('Method developer tidak tersedia, mencoba metode alternatif...');
        }
        // Coba dengan method search untuk mencari developer
        else if (typeof gplay.search === 'function') {
            // Search tidak bisa langsung untuk developer, jadi kita skip
            throw new Error('Method developer tidak tersedia, mencoba metode alternatif...');
        }
        else {
            // Coba akses langsung sebagai object
            const { developer } = gplay;
            if (typeof developer === 'function') {
                apps = await developer({
                    devId: DEVELOPER_ID,
                    lang: 'en',
                    country: 'us'
                });
            } else {
                throw new Error('Method developer tidak ditemukan di library google-play-scraper');
            }
        }
        
        if (!apps || apps.length === 0) {
            console.log('⚠️  Tidak ada aplikasi ditemukan dengan google-play-scraper');
            console.log('Mencoba metode alternatif...');
            return await fetchGamesWithManualScraping();
        }
        
        console.log(`✅ Ditemukan ${apps.length} aplikasi`);
        
        // Transform data ke format yang sesuai dengan games-data.json
        const games = apps.map((app, index) => {
            return {
                id: getStableGameId(app.appId),
                title: app.title,
                description: app.summary || app.description || '',
                image: app.icon || app.screenshots?.[0] || '',
                screenshots: app.screenshots || [],
                playLink: app.url || `https://play.google.com/store/apps/details?id=${app.appId}`,
                category: app.genre || 'Game',
                status: 'Released',
                releaseDate: app.updated ? new Date(app.updated).toISOString().split('T')[0] : new Date().toISOString().split('T')[0],
                featured: index < 3, // 3 game pertama sebagai featured
                platform: 'Android',
                rating: app.score || app.ratings || null,
                appId: app.appId
            };
        });
        
        return games;
        
    } catch (error) {
        console.error('❌ Error mengambil data dari Google Play Store:', error.message);
        console.error('Stack:', error.stack);
        
        // Fallback: Coba menggunakan Puppeteer
        console.log('🔄 Mencoba metode alternatif dengan Puppeteer...');
        return await fetchGamesWithManualScraping();
    }
}

/**
 * Metode alternatif: Menggunakan Puppeteer untuk scraping
 * Catatan: Memerlukan install puppeteer: npm install puppeteer
 */
async function fetchGamesWithManualScraping() {
    try {
        // Coba menggunakan script Puppeteer yang sudah dibuat
        try {
            const puppeteerScript = require('./update-games-playstore-puppeteer');
            console.log('📦 Menggunakan script Puppeteer...');
            return await puppeteerScript.fetchGamesFromPlayStore();
        } catch (e) {
            console.log('⚠️  Script Puppeteer tidak tersedia, mencoba require langsung...');
        }
        
        // Fallback: Coba menggunakan Puppeteer langsung
        let puppeteer;
        try {
            puppeteer = require('puppeteer');
        } catch (e) {
            console.log('⚠️  Puppeteer tidak terinstall. Install dengan: npm install puppeteer');
            console.log('💡 Atau jalankan: npm run update-games:puppeteer');
            return await fetchGamesWithFetch();
        }
        
        console.log('🌐 Menggunakan Puppeteer untuk scraping...');
        
        const browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        
        // Set user agent untuk menghindari deteksi bot
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log(`📱 Mengakses: ${DEVELOPER_URL}`);
        await page.goto(DEVELOPER_URL, { waitUntil: 'networkidle2', timeout: 30000 });
        
        // Tunggu sampai konten dimuat
        await page.waitForSelector('a[href*="/store/apps/details"]', { timeout: 15000 });
        
        // Extract data aplikasi
        const apps = await page.evaluate(() => {
            const appElements = Array.from(document.querySelectorAll('a[href*="/store/apps/details"]'));
            const uniqueApps = new Map();
            
            appElements.forEach(link => {
                const href = link.getAttribute('href');
                const match = href.match(/id=([^&]+)/);
                if (match) {
                    let appId;
                    try {
                        appId = decodeURIComponent(match[1]);
                    } catch {
                        return;
                    }
                    if (!uniqueApps.has(appId)) {
                        const titleElement = link.querySelector('span[itemprop="name"]') || 
                                            link.querySelector('.WsMG1c') ||
                                            link.querySelector('span');
                        const title = titleElement?.textContent?.trim() || '';
                        
                        const iconElement = link.querySelector('img[itemprop="image"]') ||
                                          link.querySelector('img[alt*="Icon"]') ||
                                          link.querySelector('img');
                        const icon = iconElement?.getAttribute('src') || 
                                  iconElement?.getAttribute('data-src') || '';
                        
                        if (title && appId) {
                            uniqueApps.set(appId, {
                                appId,
                                title,
                                icon,
                                url: href.startsWith('http') ? href : `https://play.google.com${href}`
                            });
                        }
                    }
                }
            });
            
            return Array.from(uniqueApps.values());
        });
        
        await browser.close();
        
        if (apps.length === 0) {
            console.log('⚠️  Tidak ada aplikasi ditemukan dengan Puppeteer');
            return await fetchGamesWithFetch();
        }
        
        console.log(`✅ Ditemukan ${apps.length} aplikasi dengan Puppeteer`);
        
        // Transform ke format yang sesuai
        const games = apps.map((app, index) => {
            return {
                id: getStableGameId(app.appId),
                title: app.title,
                description: '', // Akan diisi manual atau dengan detail scraping
                image: app.icon,
                screenshots: [],
                playLink: app.url,
                category: 'Game',
                status: 'Released',
                releaseDate: new Date().toISOString().split('T')[0],
                featured: index < 3,
                platform: 'Android',
                rating: null,
                appId: app.appId
            };
        });
        
        return games;
        
    } catch (error) {
        console.error('❌ Error pada Puppeteer scraping:', error.message);
        return await fetchGamesWithFetch();
    }
}

/**
 * Metode fallback: Menggunakan fetch dengan parsing HTML sederhana
 * Catatan: Metode ini mungkin tidak bekerja karena CORS
 */
async function fetchGamesWithFetch() {
    try {
        console.log('🔄 Mencoba metode fetch...');
        
        // Catatan: Fetch langsung tidak akan bekerja karena CORS
        // Tapi kita bisa memberikan instruksi manual
        console.log('⚠️  Fetch langsung tidak bekerja karena CORS policy');
        console.log('💡 Solusi:');
        console.log('   1. Install Puppeteer: npm install puppeteer');
        console.log('   2. Atau gunakan backend service untuk scraping');
        console.log('   3. Atau update manual file Assets/data/games-data.json');
        
        // Return empty untuk sekarang
        return [];
        
    } catch (error) {
        console.error('❌ Error pada fetch:', error.message);
        return [];
    }
}

/**
 * Memperbarui file games-data.json dengan data baru
 */
async function updateGamesData() {
    try {
        // Baca data existing untuk mempertahankan highlight
        const existingData = readGamesData(GAMES_DATA_PATH);
        if (existingData.games.length > 0) {
            console.log('Data existing ditemukan, mempertahankan highlight...');
        }
        
        // Ambil data baru dari Play Store
        const newGames = await fetchGamesFromPlayStore();
        
        validateGames(newGames);

        const highlightGameId = resolveHighlightGameId(existingData, newGames) || newGames[0].id;
        const highlightGame = newGames.find(game => game.id === highlightGameId);
        existingData.highlight = {
            ...(existingData.highlight || {}),
            gameId: highlightGame.id,
            customTitle: existingData.highlight?.customTitle || highlightGame.title,
            customDescription: existingData.highlight?.customDescription || highlightGame.description,
            youtubeUrl: existingData.highlight?.youtubeUrl || "",
            stats: existingData.highlight?.stats || {
                gameplay: "50+",
                characters: "25+",
                worlds: "5+"
            },
            active: existingData.highlight?.active ?? true,
            lastUpdated: new Date().toISOString()
        };
        existingData.games = newGames;

        // Tulis melalui file sementara agar kegagalan tidak meninggalkan JSON setengah tertulis.
        writeGamesData(GAMES_DATA_PATH, existingData);
        
        console.log(`✅ Berhasil memperbarui ${newGames.length} game ke ${GAMES_DATA_PATH}`);
        console.log(`📝 Highlight game: ${existingData.highlight.customTitle}`);
        
    } catch (error) {
        console.error('Error memperbarui games-data.json:', error);
        process.exit(1);
    }
}

// Jalankan script
if (require.main === module) {
    updateGamesData()
        .then(() => {
            console.log('✅ Script selesai!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('❌ Error:', error);
            process.exit(1);
        });
}

module.exports = { updateGamesData, fetchGamesFromPlayStore };


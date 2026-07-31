/**
 * Script alternatif untuk mengambil data game dari Google Play Store
 * Menggunakan metode fetch dengan parsing HTML atau API pihak ketiga
 * 
 * Opsi yang tersedia:
 * 1. Menggunakan RapidAPI Google Play Store API (berbayar)
 * 2. Menggunakan puppeteer untuk scraping (lebih kompleks)
 * 3. Manual update dengan format JSON yang sudah disediakan
 */

const path = require('path');
const {
    getStableGameId,
    readGamesData,
    resolveHighlightGameId,
    validateGames,
    writeGamesData
} = require('./game-data-utils');

const DEVELOPER_ID = '6814346565652097883';
const GAMES_DATA_PATH = path.join(__dirname, '..', 'Assets', 'data', 'games-data.json');

/**
 * Menggunakan RapidAPI Google Play Store API
 * Memerlukan API key dari RapidAPI
 */
async function fetchWithRapidAPI() {
    const RAPIDAPI_KEY = process.env.RAPIDAPI_KEY; // Set di environment variable
    const RAPIDAPI_HOST = 'google-play-store-api.p.rapidapi.com';
    
    if (!RAPIDAPI_KEY) {
        console.log('⚠️  RAPIDAPI_KEY tidak ditemukan di environment variable');
        console.log('   Set RAPIDAPI_KEY untuk menggunakan metode ini');
        return [];
    }
    
    try {
        const response = await fetch(
            `https://${RAPIDAPI_HOST}/apps?devId=${DEVELOPER_ID}`,
            {
                headers: {
                    'X-RapidAPI-Key': RAPIDAPI_KEY,
                    'X-RapidAPI-Host': RAPIDAPI_HOST
                }
            }
        );
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        return data.apps || [];
        
    } catch (error) {
        console.error('Error menggunakan RapidAPI:', error.message);
        return [];
    }
}

/**
 * Menggunakan Puppeteer untuk scraping (memerlukan install: npm install puppeteer)
 */
async function fetchWithPuppeteer() {
    try {
        const puppeteer = require('puppeteer');
        
        console.log('Membuka browser dengan Puppeteer...');
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        
        const url = `https://play.google.com/store/apps/dev?id=${DEVELOPER_ID}`;
        console.log(`Mengakses: ${url}`);
        
        await page.goto(url, { waitUntil: 'networkidle2' });
        
        // Tunggu sampai konten dimuat
        await page.waitForSelector('a[href*="/store/apps/details"]', { timeout: 10000 });
        
        // Extract data aplikasi
        const apps = await page.evaluate(() => {
            const appLinks = Array.from(document.querySelectorAll('a[href*="/store/apps/details"]'));
            return appLinks.map(link => {
                const href = link.getAttribute('href');
                const match = href.match(/[?&]id=([^&]+)/);
                if (!match) return null;

                let appId;
                try {
                    appId = decodeURIComponent(match[1]);
                } catch {
                    return null;
                }

                const title = link.querySelector('span')?.textContent?.trim() || '';
                const icon = link.querySelector('img')?.getAttribute('src') || '';
                
                return {
                    appId,
                    title,
                    icon,
                    url: href.startsWith('http') ? href : `https://play.google.com${href}`
                };
            });
        });
        
        await browser.close();
        
        console.log(`Ditemukan ${apps.length} aplikasi`);
        return apps;
        
    } catch (error) {
        console.error('Error menggunakan Puppeteer:', error.message);
        console.log('Install Puppeteer: npm install puppeteer');
        return [];
    }
}

/**
 * Template untuk manual update
 * Copy data dari Google Play Store dan paste ke sini
 */
function getManualGamesData() {
    // Format data manual
    // Anda bisa copy-paste data dari Google Play Store dan format seperti ini
    return [
        {
            id: "com.Mainra.GamePengenalanBinatang",
            title: "Game Pengenalan Binatang",
            description: "Petualangan seru mengenal berbagai jenis binatang",
            image: "https://play-lh.googleusercontent.com/RsT5E894y68QTWBKGntX8r_t-XILwtHITWvDG9dXztrHsvtsC-9GYZycdNehkheapQA=w240-h480-rw",
            playLink: "https://play.google.com/store/apps/details?id=com.Mainra.GamePengenalanBinatang",
            category: "Educational",
            status: "Released",
            releaseDate: "2024-01-15",
            featured: true,
            platform: "Android",
            rating: 4.5,
            appId: "com.Mainra.GamePengenalanBinatang"
        }
        // Tambahkan game lain di sini
    ];
}

/**
 * Update games data
 */
async function updateGamesData() {
    let games = [];
    
    // Coba metode RapidAPI dulu
    if (process.env.RAPIDAPI_KEY) {
        console.log('Mencoba menggunakan RapidAPI...');
        games = await fetchWithRapidAPI();
    }
    
    // Jika RapidAPI tidak tersedia, coba Puppeteer
    if (games.length === 0) {
        console.log('Mencoba menggunakan Puppeteer...');
        games = await fetchWithPuppeteer();
    }
    
    // Jika masih kosong, gunakan data manual
    if (games.length === 0) {
        console.log('Menggunakan data manual...');
        games = getManualGamesData();
    }
    
    // Transform ke format yang sesuai
    const formattedGames = games.map((app, index) => ({
        id: getStableGameId(app.appId),
        title: app.title,
        description: app.description || app.summary || '',
        image: app.icon || app.image || '',
        screenshots: app.screenshots || [],
        playLink: app.url || `https://play.google.com/store/apps/details?id=${app.appId}`,
        category: app.category || app.genre || 'Game',
        status: 'Released',
        releaseDate: app.releaseDate || new Date().toISOString().split('T')[0],
        featured: index < 3,
        platform: 'Android',
        rating: app.rating || app.score || null,
        appId: app.appId
    }));
    
    validateGames(formattedGames);
    const existingData = readGamesData(GAMES_DATA_PATH);

    // Resolve a legacy numeric highlight before replacing the old game list.
    const highlightGameId = resolveHighlightGameId(existingData, formattedGames) || formattedGames[0].id;
    existingData.games = formattedGames;
    const highlightGame = formattedGames.find(game => game.id === highlightGameId);
    existingData.highlight = {
        ...(existingData.highlight || {}),
        gameId: highlightGame.id,
        customTitle: existingData.highlight?.customTitle || highlightGame.title,
        customDescription: existingData.highlight?.customDescription || highlightGame.description,
        youtubeUrl: existingData.highlight?.youtubeUrl || "",
        stats: existingData.highlight?.stats || { gameplay: "50+", characters: "25+", worlds: "5+" },
        active: existingData.highlight?.active ?? true,
        lastUpdated: new Date().toISOString()
    };

    writeGamesData(GAMES_DATA_PATH, existingData);
    console.log(`✅ Berhasil memperbarui ${formattedGames.length} game`);
}

if (require.main === module) {
    updateGamesData()
        .then(() => process.exit(0))
        .catch(error => {
            console.error('❌ Error:', error);
            process.exit(1);
        });
}

module.exports = { updateGamesData };


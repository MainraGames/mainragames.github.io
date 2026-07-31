/**
 * Script untuk mengambil data game dari Google Play Store menggunakan Puppeteer
 * Developer ID: 6814346565652097883
 * 
 * Cara penggunaan:
 * 1. Install dependencies: npm install puppeteer
 * 2. Jalankan script: node tools/update-games-playstore-puppeteer.js
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
 * Mengambil data aplikasi dari Google Play Store menggunakan Puppeteer
 */
async function fetchGamesFromPlayStore() {
    let browser;
    try {
        const puppeteer = require('puppeteer');
        
        console.log('🚀 Memulai scraping Google Play Store...');
        console.log(`📱 Developer URL: ${DEVELOPER_URL}`);
        
        browser = await puppeteer.launch({ 
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        });
        
        const page = await browser.newPage();
        
        // Set viewport dan user agent
        await page.setViewport({ width: 1920, height: 1080 });
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        console.log('📥 Mengakses halaman developer...');
        await page.goto(DEVELOPER_URL, { 
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        
        // Tunggu sampai konten dimuat dengan berbagai selector
        console.log('⏳ Menunggu konten dimuat...');
        
        // Coba berbagai selector untuk menemukan konten
        const selectors = [
            'a[href*="/store/apps/details"]',
            'a[href*="details?id="]',
            '[data-testid*="app"]',
            '.Si6ae',
            'a[href*="id="]'
        ];
        
        let selectorFound = false;
        for (const selector of selectors) {
            try {
                await page.waitForSelector(selector, { timeout: 10000 });
                console.log(`✅ Selector ditemukan: ${selector}`);
                selectorFound = true;
                break;
            } catch (e) {
                console.log(`⚠️  Selector tidak ditemukan: ${selector}`);
            }
        }
        
        if (!selectorFound) {
            // Ambil screenshot untuk debugging
            await page.screenshot({ path: 'debug-screenshot.png', fullPage: true });
            console.log('📸 Screenshot disimpan sebagai debug-screenshot.png');
            
            // Coba ambil HTML untuk debugging
            const html = await page.content();
            console.log('📄 Panjang HTML:', html.length);
            
            // Cek apakah ada elemen dengan href yang mengandung "details"
            const hasDetailsLinks = await page.evaluate(() => {
                const links = Array.from(document.querySelectorAll('a[href*="details"]'));
                return links.length;
            });
            console.log(`🔗 Link dengan "details" ditemukan: ${hasDetailsLinks}`);
        }
        
        // Tunggu lebih lama untuk memastikan konten ter-load
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Scroll untuk memuat semua aplikasi (lazy loading)
        console.log('📜 Scroll untuk memuat semua aplikasi...');
        await autoScroll(page);
        
        // Tunggu lagi setelah scroll
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        // Extract data aplikasi dengan berbagai selector
        console.log('🔍 Mengekstrak data aplikasi...');
        const apps = await page.evaluate(() => {
            // Coba berbagai selector untuk menemukan link aplikasi
            const selectors = [
                'a[href*="/store/apps/details"]',
                'a[href*="details?id="]',
                'a[href*="id="]',
                '[data-testid*="app"] a',
                '.Si6ae a',
                'a[href*="play.google.com/store/apps"]'
            ];
            
            let appElements = [];
            for (const selector of selectors) {
                const elements = Array.from(document.querySelectorAll(selector));
                if (elements.length > 0) {
                    console.log(`Found ${elements.length} elements with selector: ${selector}`);
                    appElements = elements;
                    break;
                }
            }
            
            // Jika masih kosong, coba cari semua link
            if (appElements.length === 0) {
                const allLinks = Array.from(document.querySelectorAll('a[href]'));
                appElements = allLinks.filter(link => {
                    const href = link.getAttribute('href') || '';
                    return href.includes('details') || href.includes('id=');
                });
                console.log(`Found ${appElements.length} links with details or id`);
            }
            
            const uniqueApps = new Map();
            
            appElements.forEach((link, index) => {
                try {
                    const href = link.getAttribute('href') || '';
                    if (!href) return;
                    
                    // Extract app ID dari berbagai format URL
                    let appId = null;
                    const idMatch = href.match(/[?&]id=([^&]+)/);
                    if (idMatch) {
                        try {
                            appId = decodeURIComponent(idMatch[1]);
                        } catch {
                            return;
                        }
                    } else {
                        // Coba format lain
                        const pathMatch = href.match(/\/details\/([^\/\?]+)/);
                        if (pathMatch) {
                            appId = pathMatch[1];
                        }
                    }
                    
                    if (!appId) return;
                    
                    // Skip jika sudah ada
                    if (uniqueApps.has(appId)) return;
                    
                    // Cari title - prioritaskan yang memiliki spasi (judul yang benar)
                    let title = '';
                    let titleCandidates = [];
                    
                    // Helper function untuk mengecek apakah teks memiliki spasi (prioritas tinggi)
                    function hasSpaces(text) {
                        return text && text.includes(' ') && text.trim().split(/\s+/).length >= 2;
                    }
                    
                    // Helper function untuk mengecek apakah teks valid sebagai judul (lebih fleksibel)
                    function isValidTitle(text) {
                        if (!text || text.length < 1 || text.length > 100) return false;
                        // Abaikan teks yang sama persis dengan appId
                        if (text === appId) return false;
                        // Abaikan teks yang hanya angka atau simbol saja
                        if (/^[\d\s\-_\.]+$/.test(text) && text.length < 3) return false;
                        // Abaikan teks yang terlalu panjang (kemungkinan deskripsi)
                        if (text.length > 60) return false;
                        // Abaikan teks yang dimulai dengan kata-kata deskriptif
                        const descStarters = ['join', 'play', 'discover', 'explore', 'experience', 'dive into', 'embark on'];
                        const lowerText = text.toLowerCase();
                        for (const starter of descStarters) {
                            if (lowerText.startsWith(starter) && text.length > 30) return false;
                        }
                        return true;
                    }
                    
                    // Helper function untuk mengecek apakah teks mirip dengan appId (harus dihindari)
                    function isLikeAppId(text) {
                        if (!text) return false;
                        // Jika teks tanpa spasi, panjang > 15, dan banyak titik, kemungkinan appId
                        if (!text.includes(' ') && text.includes('.') && text.split('.').length > 2 && text.length > 15) return true;
                        // Jika teks sama dengan appId
                        if (text === appId) return true;
                        // Jika appId mengandung teks dan teks panjang tanpa spasi
                        if (appId.includes(text) && text.length > 15 && !text.includes(' ')) return true;
                        return false;
                    }
                    
                    // 1. Cari di dalam link dan parent dengan berbagai selector
                    const titleSelectors = [
                        'span[itemprop="name"]',
                        '.WsMG1c',
                        '.Si6ae',
                        'span.VfPpkd-rymPhb-ibnC6b',
                        'div[class*="title"]',
                        'span[class*="title"]',
                        'h2',
                        'h3',
                        'div[aria-label]',
                        'span[aria-label]',
                        'span',
                        'div'
                    ];
                    
                    // Cari di dalam link
                    for (const selector of titleSelectors) {
                        const titleElement = link.querySelector(selector);
                        if (titleElement) {
                            const text = titleElement.textContent?.trim() || '';
                            if (isValidTitle(text) && !isLikeAppId(text)) {
                                titleCandidates.push({ text, hasSpace: hasSpaces(text), source: 'link', length: text.length });
                            }
                        }
                    }
                    
                    // Cari di parent element
                    const parent = link.closest('[class*="card"]') || 
                                  link.closest('[class*="item"]') || 
                                  link.closest('[class*="app"]') ||
                                  link.parentElement;
                    if (parent) {
                        for (const selector of titleSelectors) {
                            const titleElement = parent.querySelector(selector);
                            if (titleElement) {
                                const text = titleElement.textContent?.trim() || '';
                                if (isValidTitle(text) && !isLikeAppId(text)) {
                                    titleCandidates.push({ text, hasSpace: hasSpaces(text), source: 'parent', length: text.length });
                                }
                            }
                        }
                    }
                    
                    // Cari di sibling elements
                    const siblings = Array.from(link.parentElement?.children || []);
                    for (const sibling of siblings) {
                        if (sibling !== link) {
                            const text = sibling.textContent?.trim() || '';
                            if (isValidTitle(text) && !isLikeAppId(text) && text.length > 2) {
                                titleCandidates.push({ text, hasSpace: hasSpaces(text), source: 'sibling', length: text.length });
                            }
                        }
                    }
                    
                    // Hapus duplikat berdasarkan text
                    const uniqueCandidates = [];
                    const seenTexts = new Set();
                    for (const candidate of titleCandidates) {
                        const normalized = candidate.text.toLowerCase().trim();
                        if (!seenTexts.has(normalized)) {
                            seenTexts.add(normalized);
                            uniqueCandidates.push(candidate);
                        }
                    }
                    titleCandidates = uniqueCandidates;
                    
                    // Prioritaskan title yang memiliki spasi
                    const titlesWithSpaces = titleCandidates.filter(c => c.hasSpace);
                    if (titlesWithSpaces.length > 0) {
                        // Ambil yang terpanjang dari yang memiliki spasi (lebih lengkap)
                        titlesWithSpaces.sort((a, b) => b.length - a.length);
                        title = titlesWithSpaces[0].text;
                    } else if (titleCandidates.length > 0) {
                        // Jika tidak ada yang memiliki spasi, ambil yang terpanjang (lebih mungkin benar)
                        titleCandidates.sort((a, b) => b.length - a.length);
                        title = titleCandidates[0].text;
                    }
                    
                    // Fallback: jika masih tidak ada, coba ambil teks dari link atau parent secara langsung
                    if (!title || title.length < 2) {
                        // Coba ambil semua teks dari link (tapi filter yang terlalu panjang)
                        const linkText = link.textContent?.trim() || '';
                        if (linkText && linkText.length > 2 && linkText.length < 100 && !isLikeAppId(linkText)) {
                            title = linkText;
                        } else {
                            // Coba ambil dari parent
                            const parentText = parent?.textContent?.trim() || '';
                            if (parentText && parentText.length > 2 && parentText.length < 100 && !isLikeAppId(parentText)) {
                                // Ambil baris pertama atau potong jika terlalu panjang
                                const firstLine = parentText.split('\n')[0] || parentText.substring(0, 50);
                                if (firstLine.length > 2) {
                                    title = firstLine.trim();
                                }
                            }
                        }
                    }
                    
                    // Final fallback: gunakan appId name (bagian terakhir setelah titik) jika benar-benar tidak ada
                    if (!title || title.length < 2) {
                        const appName = appId.split('.').pop() || appId;
                        // Capitalize first letter
                        title = appName.charAt(0).toUpperCase() + appName.slice(1);
                    }
                    
                    // Pastikan title tidak kosong
                    title = title.trim();
                    if (!title) {
                        title = appId.split('.').pop() || appId;
                    }
                    
                    // Log jika title tidak memiliki spasi (untuk debugging)
                    if (!hasSpaces(title) && title.length > 5) {
                        console.log(`⚠️  Title tanpa spasi untuk ${appId}: "${title}"`);
                    }
                    
                    // Cari icon - coba berbagai cara (untuk game biasa, tetap kecil)
                    let icon = '';
                    const iconSelectors = [
                        'img[itemprop="image"]',
                        'img[alt*="Icon"]',
                        'img[alt*="icon"]',
                        'img.Q4vdJd',
                        'img[class*="icon"]',
                        'img[class*="Icon"]',
                        'img'
                    ];
                    
                    // Cari di dalam link
                    for (const selector of iconSelectors) {
                        const iconElement = link.querySelector(selector);
                        if (iconElement) {
                            icon = iconElement.getAttribute('src') || 
                                  iconElement.getAttribute('data-src') ||
                                  iconElement.getAttribute('data-ils') ||
                                  iconElement.getAttribute('data-srcset')?.split(',')[0]?.trim() || '';
                            if (icon && (icon.startsWith('http') || icon.startsWith('//'))) {
                                if (icon.startsWith('//')) icon = 'https:' + icon;
                                
                                // Normalisasi icon - pastikan format benar dan selalu gunakan s256-rw
                                if (icon.includes('play-lh.googleusercontent.com')) {
                                    // Bersihkan URL dari parameter ganda atau salah
                                    const baseUrl = icon.split('?')[0].split('=')[0];
                                    
                                    // SELALU gunakan s256-rw untuk konsistensi
                                    // Ganti semua parameter size (s64, s128, s256, s512, dll) dengan s256-rw
                                    if (icon.includes('=w') || icon.includes('=h') || icon.match(/=s\d+-rw/)) {
                                        // Jika ada parameter width/height atau size apapun, ganti dengan s256-rw
                                        icon = baseUrl + '=s256-rw';
                                    } else {
                                        // Jika tidak ada parameter, tambahkan s256-rw
                                        icon = baseUrl + '=s256-rw';
                                    }
                                }
                                break;
                            }
                        }
                    }
                    
                    // Jika tidak ada, cari di parent
                    if (!icon) {
                        const parent = link.closest('[class*="card"]') || link.closest('[class*="item"]') || link.parentElement;
                        if (parent) {
                            for (const selector of iconSelectors) {
                                const iconElement = parent.querySelector(selector);
                                if (iconElement) {
                                    icon = iconElement.getAttribute('src') || 
                                          iconElement.getAttribute('data-src') ||
                                          iconElement.getAttribute('data-ils') || '';
                                    if (icon && (icon.startsWith('http') || icon.startsWith('//'))) {
                                        if (icon.startsWith('//')) icon = 'https:' + icon;
                                        
                                        // Normalisasi icon - pastikan format benar dan selalu gunakan s256-rw
                                        if (icon.includes('play-lh.googleusercontent.com')) {
                                            const baseUrl = icon.split('?')[0].split('=')[0];
                                            
                                            // SELALU gunakan s256-rw untuk konsistensi
                                            // Ganti semua parameter size dengan s256-rw
                                            if (icon.includes('=w') || icon.includes('=h') || icon.match(/=s\d+-rw/)) {
                                                icon = baseUrl + '=s256-rw';
                                            } else {
                                                icon = baseUrl + '=s256-rw';
                                            }
                                        }
                                        break;
                                    }
                                }
                            }
                        }
                    }
                    
                    // Cari rating jika ada
                    const ratingElement = link.closest('[class*="card"]')?.querySelector('[aria-label*="star"]') ||
                                         link.closest('[class*="card"]')?.querySelector('[class*="rating"]') ||
                                         link.closest('.VfPpkd-rymPhb')?.querySelector('.w2kbF');
                    const ratingText = ratingElement?.textContent?.trim() || ratingElement?.getAttribute('aria-label') || '';
                    const ratingMatch = ratingText.match(/(\d+\.?\d*)/);
                    const rating = ratingMatch ? parseFloat(ratingMatch[1]) : null;
                    
                    // Normalize URL
                    let url = href;
                    if (!url.startsWith('http')) {
                        url = `https://play.google.com${url.startsWith('/') ? url : '/' + url}`;
                    }
                    
                    uniqueApps.set(appId, {
                        appId,
                        title,
                        icon: icon || '',
                        url: url,
                        rating
                    });
                } catch (e) {
                    // Skip jika error
                    console.error(`Error processing app ${index}:`, e.message);
                }
            });
            
            return Array.from(uniqueApps.values());
        });
        
        // Ambil screenshot sebelum close untuk debugging
        if (apps.length === 0) {
            await page.screenshot({ path: 'debug-no-apps.png', fullPage: true });
            console.log('📸 Screenshot disimpan sebagai debug-no-apps.png');
            
            // Ambil informasi debug
            const debugInfo = await page.evaluate(() => {
                return {
                    title: document.title,
                    url: window.location.href,
                    allLinks: Array.from(document.querySelectorAll('a[href]')).length,
                    detailsLinks: Array.from(document.querySelectorAll('a[href*="details"]')).length,
                    idLinks: Array.from(document.querySelectorAll('a[href*="id="]')).length,
                    bodyText: document.body.innerText.substring(0, 500)
                };
            });
            console.log('🔍 Debug Info:', JSON.stringify(debugInfo, null, 2));
        }
        
        await browser.close();
        
        if (apps.length === 0) {
            throw new Error('Tidak ada aplikasi ditemukan. Mungkin struktur halaman berubah atau perlu waktu loading lebih lama. Cek file debug-no-apps.png untuk melihat halaman yang di-scrape.');
        }
        
        console.log(`✅ Ditemukan ${apps.length} aplikasi`);
        
        // Transform data ke format yang sesuai dengan games-data.json
        const games = apps.map((app, index) => {
            return {
                id: getStableGameId(app.appId),
                title: app.title,
                description: '', // Bisa diisi dengan detail scraping jika diperlukan
                image: app.icon || '',
                screenshots: [],
                playLink: app.url,
                category: 'Game',
                status: 'Released',
                releaseDate: new Date().toISOString().split('T')[0],
                featured: index < 3, // 3 game pertama sebagai featured
                platform: 'Android',
                rating: app.rating || null,
                appId: app.appId
            };
        });
        
        return games;
        
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('❌ Error mengambil data dari Google Play Store:', error.message);
        throw error;
    }
}

/**
 * Auto scroll untuk memuat konten lazy loading
 */
async function autoScroll(page) {
    await page.evaluate(async () => {
        await new Promise((resolve) => {
            let totalHeight = 0;
            const distance = 100;
            const timer = setInterval(() => {
                const scrollHeight = document.body.scrollHeight;
                window.scrollBy(0, distance);
                totalHeight += distance;

                if (totalHeight >= scrollHeight) {
                    clearInterval(timer);
                    resolve();
                }
            }, 100);
        });
    });
}

/**
 * Mengambil detail game dari halaman detail Google Play Store
 * Untuk mendapatkan judul yang benar dan screenshot HD
 */
async function fetchGameDetails(page, appUrl) {
    try {
        console.log(`📥 Mengambil detail dari: ${appUrl}`);
        await page.goto(appUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const details = await page.evaluate(() => {
            // Ambil judul yang benar (bukan deskripsi)
            let title = '';
            const titleSelectors = [
                'h1[itemprop="name"]',
                'h1.Fd93Bb',
                'h1',
                '[data-testid="app-title"]',
                'span[itemprop="name"]'
            ];
            
            for (const selector of titleSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    title = element.textContent?.trim() || '';
                    if (title && title.length > 0 && title.length < 100) {
                        break;
                    }
                }
            }
            
            // Ambil icon kecil (bukan screenshot)
            let icon = '';
            const iconSelectors = [
                'img[itemprop="image"]',
                'img[alt*="Icon"]',
                'img[alt*="icon"]',
                '.T75of img',
                'img.Q4vdJd'
            ];
            
            for (const selector of iconSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    let src = element.getAttribute('src') || 
                             element.getAttribute('data-src') ||
                             element.getAttribute('data-ils') || '';
                    if (src) {
                        // Pastikan icon kecil (bukan screenshot)
                        if (!src.includes('screenshot') && !src.includes('w1920') && !src.includes('w1280')) {
                            // Pastikan size kecil
                            if (src.includes('=s')) {
                                src = src.replace(/=s\d+-rw/, '=s256-rw');
                            } else {
                                src = src.split('?')[0] + '=s256-rw';
                            }
                            icon = src;
                            break;
                        }
                    }
                }
            }
            
            // Ambil deskripsi
            let description = '';
            const descSelectors = [
                '[data-testid="app-description"]',
                'div[itemprop="description"]',
                '.bARER',
                '.DWPxHb'
            ];
            
            for (const selector of descSelectors) {
                const element = document.querySelector(selector);
                if (element) {
                    description = element.textContent?.trim() || '';
                    if (description && description.length > 50) {
                        // Ambil hanya paragraf pertama
                        description = description.split('\n')[0] || description.substring(0, 200);
                        break;
                    }
                }
            }
            
            // Ambil screenshot HD
            const screenshots = [];
            const screenshotSelectors = [
                'img[data-src*="screenshot"]',
                'img[alt*="Screenshot"]',
                'img[alt*="screenshot"]',
                'button[data-screenshot-index] img',
                '.Vq1ZA img'
            ];
            
            for (const selector of screenshotSelectors) {
                const images = Array.from(document.querySelectorAll(selector));
                for (const img of images) {
                    let src = img.getAttribute('src') || 
                             img.getAttribute('data-src') ||
                             img.getAttribute('data-ils') || '';
                    
                    if (src) {
                        // Ubah ke resolusi HD (hapus parameter size atau ubah ke resolusi tinggi)
                        // Format Google Play: sXXX-rw dimana XXX adalah size
                        src = src.replace(/=s\d+-rw/, '=w1920-h1080-rw'); // HD resolution
                        src = src.replace(/=w\d+-h\d+-rw/, '=w1920-h1080-rw');
                        
                        if (!screenshots.includes(src) && src.startsWith('http')) {
                            screenshots.push(src);
                        }
                    }
                }
                
                if (screenshots.length > 0) break;
            }
            
            // Jika tidak ada screenshot, coba ambil dari carousel
            if (screenshots.length === 0) {
                const carouselImages = Array.from(document.querySelectorAll('img[src*="screenshot"], img[data-src*="screenshot"]'));
                for (const img of carouselImages) {
                    let src = img.getAttribute('src') || img.getAttribute('data-src') || '';
                    if (src) {
                        src = src.replace(/=s\d+-rw/, '=w1920-h1080-rw');
                        if (!screenshots.includes(src) && src.startsWith('http')) {
                            screenshots.push(src);
                        }
                    }
                }
            }
            
            return { title, description, icon, screenshots: screenshots.slice(0, 5) }; // Max 5 screenshots
        });
        
        return details;
    } catch (error) {
        console.error(`⚠️  Error mengambil detail dari ${appUrl}:`, error.message);
        return null;
    }
}

/**
 * Memperbarui file games-data.json dengan data baru
 */
async function updateGamesData() {
    let browser;
    try {
        // Baca data existing untuk mempertahankan highlight
        const existingData = readGamesData(GAMES_DATA_PATH);
        if (existingData.games.length > 0) {
            console.log('📂 Data existing ditemukan, mempertahankan highlight...');
        }
        
        // Ambil data baru dari Play Store
        const newGames = await fetchGamesFromPlayStore();
        
        validateGames(newGames);

        // Tentukan game yang akan di-highlight, mempertahankan pilihan lama bila masih tersedia.
        const highlightGameId = resolveHighlightGameId(existingData, newGames) || newGames[0].id;
        const highlightGame = newGames.find(game => game.id === highlightGameId);
        
        // Ambil detail lengkap untuk highlight game (judul benar + screenshot HD)
        console.log(`\n🎯 Mengambil detail untuk highlight game: ${highlightGame.title}`);
        const puppeteer = require('puppeteer');
        browser = await puppeteer.launch({ 
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        
        const gameDetails = await fetchGameDetails(page, highlightGame.playLink);
        
        if (gameDetails) {
            // Update highlight game dengan data yang lebih akurat
            if (gameDetails.title && gameDetails.title.length > 0) {
                highlightGame.title = gameDetails.title;
                highlightGame.description = gameDetails.description || highlightGame.description;
            }
            
            // JANGAN ganti icon - biarkan icon dari listing page tetap digunakan
            // Icon kecil sudah benar dari fetchGamesFromPlayStore(), jangan diganti
            // Hanya update screenshots HD untuk carousel highlight
            
            // Update screenshots HD (untuk carousel highlight)
            if (gameDetails.screenshots && gameDetails.screenshots.length > 0) {
                highlightGame.screenshots = gameDetails.screenshots;
                // Screenshot hanya untuk carousel di highlight section, bukan untuk image di list
            }
        }
        
        await browser.close();
        browser = null;
        
        // Update games
        existingData.games = newGames;

        // Update highlight dengan data yang sudah diperbaiki
        existingData.highlight = {
            ...(existingData.highlight || {}),
            gameId: highlightGame.id,
            customTitle: highlightGame.title,
            customDescription: highlightGame.description || `Mainkan ${highlightGame.title} sekarang!`,
            youtubeUrl: existingData.highlight?.youtubeUrl || "",
            stats: existingData.highlight?.stats || {
                gameplay: "50+",
                characters: "25+",
                worlds: "5+"
            },
            active: existingData.highlight?.active ?? true,
            lastUpdated: new Date().toISOString()
        };

        // Revalidate after enriching the highlight with scraped screenshots.
        validateGames(existingData.games);
        writeGamesData(GAMES_DATA_PATH, existingData);
        
        console.log(`\n✅ Berhasil memperbarui ${newGames.length} game ke ${GAMES_DATA_PATH}`);
        console.log(`📝 Highlight game: ${existingData.highlight.customTitle}`);
        if (highlightGame.screenshots && highlightGame.screenshots.length > 0) {
            console.log(`🖼️  Screenshot HD: ${highlightGame.screenshots.length} gambar`);
        }
        console.log('\n📋 Daftar game yang diperbarui:');
        newGames.forEach((game, index) => {
            console.log(`   ${index + 1}. ${game.title} - ${game.playLink}`);
        });
        
    } catch (error) {
        if (browser) {
            await browser.close();
        }
        console.error('❌ Error memperbarui games-data.json:', error);
        process.exit(1);
    }
}

// Jalankan script
if (require.main === module) {
    updateGamesData()
        .then(() => {
            console.log('\n✅ Script selesai!');
            process.exit(0);
        })
        .catch((error) => {
            console.error('\n❌ Error:', error.message);
            console.error('\n💡 Tips:');
            console.error('   1. Pastikan Puppeteer terinstall: npm install puppeteer');
            console.error('   2. Pastikan koneksi internet stabil');
            console.error('   3. Coba jalankan lagi jika error terjadi');
            process.exit(1);
        });
}

module.exports = { updateGamesData, fetchGamesFromPlayStore };


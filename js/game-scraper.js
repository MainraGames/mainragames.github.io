async function scrapePlayStoreData(url) {
    // Try to fetch Play Store page via CORS-friendly proxies and parse minimal info
    const extractPackage = (u) => {
        try { const m = u.match(/[?&]id=([^&#]+)/i); return m ? m[1] : null; } catch { return null; }
    };
    const pkg = extractPackage(url);
    if (!pkg) {
        return { success: false, error: 'Invalid Play Store URL' };
    }

    const buildPlayUrl = (p) => `https://play.google.com/store/apps/details?id=${p}`;

    const fetchHtml = async () => {
        const target = buildPlayUrl(pkg);
        // 1) Try allorigins
        try {
            const proxy1 = `https://api.allorigins.win/raw?url=${encodeURIComponent(target)}`;
            const res1 = await fetch(proxy1);
            if (res1.ok) return await res1.text();
        } catch (_) {}
        // 2) Try r.jina.ai mirror (read-only)
        try {
            const proxy2 = `https://r.jina.ai/http://play.google.com/store/apps/details?id=${encodeURIComponent(pkg)}`;
            const res2 = await fetch(proxy2);
            if (res2.ok) return await res2.text();
        } catch (_) {}
        throw new Error('Unable to fetch Play Store page');
    };

    const parseHtml = (html) => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const pick = (sel) => doc.querySelector(sel);
        let title = pick('meta[property="og:title"]')?.getAttribute('content')
                 || pick('meta[name="twitter:title"]')?.getAttribute('content')
                 || pick('h1[itemprop="name"]')?.textContent
                 || pick('h1[aria-level="1"]')?.textContent
                 || pick('h1')?.textContent
                 || '';
        if (title) {
            title = title.replace(/\s*-+\s*Apps on Google Play\s*$/i, '').trim();
        }
        const image = pick('meta[property="og:image"]')?.getAttribute('content')
                    || pick('img[alt="Icon image"]')?.getAttribute('src')
                    || pick('img[itemprop="image"]')?.getAttribute('src')
                    || '';
        let description = pick('meta[property="og:description"]')?.getAttribute('content')
                       || pick('meta[name="description"]')?.getAttribute('content')
                       || '';
        if (description) {
            description = description.replace(/\s*-+\s*Apps on Google Play\s*$/i, '').trim();
        }
        return { title, image, description };
    };

    const normalizeImageUrl = (u) => {
        if (!u) return '';
        try {
            let s = String(u).trim();
            if (s.startsWith('//')) s = 'https:' + s;
            if (s.startsWith('/')) s = 'https://play.google.com' + s;
            // Upgrade common Play Store icon sizes
            s = s.replace(/=w\d+(-h\d+)?-rw$/i, '=w512-h512-rw');
            s = s.replace(/=s\d+-rw$/i, '=s512-rw');
            return s;
        } catch { return u; }
    };

    try {
        // First try server-side scraper if available (more reliable, bypasses CORS)
        try {
            const res = await fetch('api/playstore-scraper.php', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: buildPlayUrl(pkg) })
            });
            if (res.ok) {
                const json = await res.json();
                if (json && json.success && json.data) {
                    return {
                        success: true,
                        data: {
                            title: (json.data.title || '').trim(),
                            image: normalizeImageUrl(json.data.image || ''),
                            description: (json.data.description || '').trim(),
                            playLink: json.data.playLink || buildPlayUrl(pkg)
                        }
                    };
                }
            }
        } catch (_) { /* ignore and fallback to client-side scraping */ }

        // Fallback: client-side fetch via CORS-friendly proxies
        const html = await fetchHtml();
        const { title, image, description } = parseHtml(html);
        if (!title && !image) {
            // Not enough data, let caller fallback
            return { success: false, error: 'Could not extract title/icon' };
        }
        return { success: true, data: { title: (title || '').trim(), image: normalizeImageUrl(image || ''), description: (description || '').trim(), playLink: buildPlayUrl(pkg) } };
    } catch (error) {
        console.error('Error scraping Play Store:', error);
        return { success: false, error: 'Failed to extract game data from Play Store' };
    }
}

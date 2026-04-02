/**
 * HiAnime Scraper
 * Fetches anime data from HiAnime (formerly 9anime)
 * Uses Capacitor native HTTP to bypass CORS restrictions.
 */

import { http } from '../utils/http.js';

const HIANIME_BASE = 'https://hianime.to';

export class HiAnimeScraper {
    /**
     * Search for anime on HiAnime
     */
    static async search(query) {
        try {
            const searchUrl = `${HIANIME_BASE}/search?keyword=${encodeURIComponent(query)}`;
            const html = await http.getHTML(searchUrl);
            return this.parseSearchResults(html);
        } catch (error) {
            console.error('HiAnime search error:', error);
            return [];
        }
    }

    /**
     * Get episode list for an anime
     */
    static async getEpisodes(animeUrl) {
        try {
            const fullUrl = animeUrl.startsWith('http') ? animeUrl : `${HIANIME_BASE}${animeUrl}`;
            const html = await http.getHTML(fullUrl);
            return this.parseEpisodeList(html);
        } catch (error) {
            console.error('HiAnime episode fetch error:', error);
            return [];
        }
    }

    /**
     * Get streaming URL for an episode
     */
    static async getStreamUrl(episodeUrl) {
        try {
            const fullUrl = episodeUrl.startsWith('http') ? episodeUrl : `${HIANIME_BASE}${episodeUrl}`;
            const html = await http.getHTML(fullUrl);
            
            const hlsMatch = html.match(/"file":"([^"]+\.m3u8)"/);
            if (hlsMatch) {
                return { url: hlsMatch[1], type: 'hls', quality: 'auto' };
            }
            return null;
        } catch (error) {
            console.error('HiAnime stream URL fetch error:', error);
            return null;
        }
    }

    /**
     * Parse search results HTML
     */
    static parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Look for anime items in search results
        // This selector may need updating if HiAnime changes their layout
        const items = doc.querySelectorAll('.flw-item, .anime-card, [data-anime-id]');

        items.forEach(item => {
            try {
                const titleEl = item.querySelector('h3 a, .title a, [data-title]');
                const coverEl = item.querySelector('img, [data-src]');
                const linkEl = item.querySelector('a[href*="/watch/"]');

                if (titleEl && linkEl) {
                    results.push({
                        id: linkEl.href.split('/').pop(),
                        title: titleEl.textContent.trim() || titleEl.getAttribute('data-title'),
                        coverImage: coverEl?.src || coverEl?.getAttribute('data-src') || '',
                        url: linkEl.href,
                        source: 'hianime'
                    });
                }
            } catch (e) {
                console.debug('Parse error on item:', e);
            }
        });

        return results;
    }

    /**
     * Parse episode list HTML
     */
    static parseEpisodeList(html) {
        const episodes = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Look for episode links
        const episodeLinks = doc.querySelectorAll('a[href*="/ep-"]');

        episodeLinks.forEach((link, index) => {
            try {
                const episodeNum = link.textContent.match(/\d+/)?.[0] || (index + 1);
                episodes.push({
                    episode: parseInt(episodeNum),
                    url: link.href,
                    title: `Episode ${episodeNum}`
                });
            } catch (e) {
                console.debug('Episode parse error:', e);
            }
        });

        return episodes.sort((a, b) => a.episode - b.episode);
    }
}

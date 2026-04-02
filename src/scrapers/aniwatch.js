/**
 * AniWatch Scraper
 * Scrapes anime content from aniwatch.to
 * Uses Capacitor native HTTP to bypass CORS restrictions.
 */

import { http } from '../utils/http.js';

const BASE_URL = 'https://aniwatch.to';

export class AniWatchScraper {
    /**
     * Search for anime on aniwatch.to
     */
    static async search(query) {
        try {
            const searchUrl = `${BASE_URL}/search?keyword=${encodeURIComponent(query)}`;
            const html = await http.getHTML(searchUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const results = [];
            const items = doc.querySelectorAll('.film-poster, .ani-search-item, [class*="poster"], .search-item');

            for (let item of items) {
                try {
                    const titleElem = item.querySelector('h3, .title, .name, a[title]');
                    const linkElem = item.querySelector('a[href]');
                    const imgElem = item.querySelector('img');

                    if (!titleElem || !linkElem) continue;

                    const title = titleElem.textContent?.trim() || titleElem.getAttribute('title') || '';
                    const url = linkElem.getAttribute('href') || '';
                    const coverUrl = imgElem?.getAttribute('src') || imgElem?.getAttribute('data-src') || '';

                    if (!title || !url) continue;

                    // Extract slug from URL
                    const slugMatch = url.match(/\/(?:anime|watch)\/([a-z0-9-]+)/i);
                    const slug = slugMatch ? slugMatch[1] : url;

                    results.push({
                        id: slug,
                        title,
                        type: 'anime',
                        source: 'aniwatch',
                        sourceId: slug,
                        coverUrl: coverUrl.startsWith('http') ? coverUrl : `${BASE_URL}${coverUrl}`,
                        url: url.startsWith('http') ? url : `${BASE_URL}${url}`,
                        slug,
                        description: ''
                    });

                    if (results.length >= 20) break;
                } catch (e) {
                    console.debug('Error parsing item:', e);
                    continue;
                }
            }

            return results;
        } catch (error) {
            console.error('AniWatch search error:', error);
            return [];
        }
    }

    /**
     * Get episodes for an anime
     * @param {string} id - Anime ID/slug
     * @param {string} url - Anime URL (optional)
     * @returns {Promise<Array>} Episodes with episode number, title, url
     */
    static async getEpisodes(id, url = '') {
        try {
            const animeUrl = url || `${BASE_URL}/watch/${id}`;
            const html = await http.getHTML(animeUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const episodes = [];

            // Try multiple selectors for episode lists
            const episodeElements = doc.querySelectorAll(
                '.episodes-list > div, .ep-item, [class*="episode"], .episode-item, .ep-card'
            );

            for (let elem of episodeElements) {
                try {
                    const linkElem = elem.querySelector('a[href]');
                    const titleElem = elem.querySelector('a[title]') || elem;
                    const episodeMatch = titleElem.textContent?.match(/Episode\s*(\d+)/i) || 
                                        titleElem.getAttribute('title')?.match(/(\d+)/);

                    if (!linkElem) continue;

                    const episodeNum = episodeMatch ? parseInt(episodeMatch[1]) : episodes.length + 1;
                    const epUrl = linkElem.getAttribute('href') || '';

                    episodes.push({
                        number: episodeNum,
                        title: titleElem.textContent?.trim() || `Episode ${episodeNum}`,
                        url: epUrl.startsWith('http') ? epUrl : `${BASE_URL}${epUrl}`,
                        id: `${id}-ep${episodeNum}`
                    });
                } catch (e) {
                    console.debug('Error parsing episode:', e);
                    continue;
                }
            }

            return episodes.sort((a, b) => a.number - b.number);
        } catch (error) {
            console.error('AniWatch getEpisodes error:', error);
            return [];
        }
    }

    /**
     * Get streaming URL for an episode
     * @param {string} episodeId - Episode ID
     * @param {string} episodeUrl - Episode URL
     * @returns {Promise<Object>} Stream info with m3u8 URL
     */
    static async getStreamUrl(episodeId, episodeUrl) {
        try {
            const html = await http.getHTML(episodeUrl);

            const m3u8Match = html.match(/["']?(https?:[^"'\s]+\.m3u8[^"'\s]*)/i);
            const sourceMatch = html.match(/src:\s*["'](https?:[^"']+)["']/i);
            const playerMatch = html.match(/url:\s*["'](https?:[^"']+)["']/i);

            const streamUrl = m3u8Match?.[1] || sourceMatch?.[1] || playerMatch?.[1] || null;

            if (!streamUrl) {
                console.warn('No stream URL found for episode:', episodeId);
                return { url: null, quality: '720p', type: 'hls' };
            }

            return {
                url: streamUrl,
                quality: '720p',
                type: streamUrl.includes('m3u8') ? 'hls' : 'mp4',
                episodeId
            };
        } catch (error) {
            console.error('AniWatch getStreamUrl error:', error);
            return { url: null, quality: '720p', type: 'hls' };
        }
    }

    /**
     * Get anime details
     * @param {string} id - Anime ID/slug
     * @param {string} url - Anime URL (optional)
     * @returns {Promise<Object>} Anime details
     */
    static async getDetails(id, url = '') {
        try {
            const animeUrl = url || `${BASE_URL}/watch/${id}`;
            const html = await http.getHTML(animeUrl);
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            const titleElem = doc.querySelector('h1, .title, [class*="title"]');
            const descElem = doc.querySelector('.description, [class*="synopsis"], [class*="desc"]');
            const genreElems = doc.querySelectorAll('[class*="genre"] a, .tag');
            const coverElem = doc.querySelector('[class*="poster"] img, [class*="cover"] img');

            const details = {
                id,
                title: titleElem?.textContent?.trim() || id,
                description: descElem?.textContent?.trim() || '',
                genres: Array.from(genreElems).map(g => g.textContent?.trim()).filter(Boolean),
                coverUrl: coverElem?.getAttribute('src') || coverElem?.getAttribute('data-src') || '',
                source: 'aniwatch',
                type: 'anime',
                rating: 'N/A',
                status: 'Unknown'
            };

            return details;
        } catch (error) {
            console.error('AniWatch getDetails error:', error);
            return {
                id,
                title: id,
                description: '',
                genres: [],
                coverUrl: '',
                source: 'aniwatch',
                type: 'anime',
                rating: 'N/A',
                status: 'Unknown'
            };
        }
    }
}

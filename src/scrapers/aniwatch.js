/**
 * AniWatch Scraper - Direct HTML scraping of aniwatch.to
 * Parses search results, anime details, episode lists, and streaming sources
 * directly from the website HTML. Uses Capacitor native HTTP to bypass CORS.
 *
 * Key selectors (aniwatch.to / zoro-lineage layout):
 *  - Search results: .film_list-wrap .flw-item
 *  - Anime card: .film-poster img[data-src], .film-name a, .fd-infor, .tick-sub/dub/eps
 *  - Detail page: #ani_detail .anis-content
 *  - Episodes AJAX: /ajax/v2/episode/list/{id} → .ss-list .ep-item
 *  - Servers AJAX: /ajax/v2/episode/servers?episodeId={id}
 *  - Sources AJAX: /ajax/v2/episode/sources?id={serverId}
 */

import { http } from '../utils/http.js';

const ANIWATCH_BASE = 'https://aniwatch.to';

export class AniWatchScraper {
    static async search(query) {
        try {
            const url = `${ANIWATCH_BASE}/search?keyword=${encodeURIComponent(query)}`;
            const html = await http.getHTML(url, {
                'Referer': `${ANIWATCH_BASE}/`,
                'X-Requested-With': 'XMLHttpRequest'
            });
            return this.parseSearchResults(html);
        } catch (error) {
            console.error('AniWatch search error:', error);
            return [];
        }
    }

    static parseSearchResults(html) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const items = doc.querySelectorAll('.film_list-wrap .flw-item');
        items.forEach(item => {
            try {
                const nameEl = item.querySelector('.film-name a, .film-detail .dynamic-name');
                const posterEl = item.querySelector('.film-poster img');
                const linkEl = item.querySelector('.film-poster > a, .film-name a');
                const typeEl = item.querySelector('.fd-infor .fdi-item:first-child, .fd-infor span:first-child');
                const durationEl = item.querySelector('.fdi-duration, .fd-infor .fdi-item:nth-child(2)');
                const subEl = item.querySelector('.tick-sub');
                const dubEl = item.querySelector('.tick-dub');
                const epsEl = item.querySelector('.tick-eps');

                if (!nameEl) return;

                const title = nameEl.textContent.trim();
                const href = (linkEl?.getAttribute('href') || '').replace(/^\//, '');
                const slug = href.replace(/^watch\//, '');
                const poster = posterEl?.getAttribute('data-src') || posterEl?.getAttribute('src') || '';

                // Extract the numeric ID from the slug (e.g., "naruto-shippuuden-355" → "355")
                const idMatch = slug.match(/-(\d+)$/);
                const animeId = idMatch ? idMatch[1] : slug;

                results.push({
                    id: slug || href,
                    title,
                    type: 'anime',
                    source: 'aniwatch',
                    sourceId: slug,
                    coverUrl: poster,
                    url: `${ANIWATCH_BASE}/${slug}`,
                    slug,
                    animeId,
                    description: '',
                    episodes: {
                        sub: subEl?.textContent?.trim() || null,
                        dub: dubEl?.textContent?.trim() || null,
                        total: epsEl?.textContent?.trim() || null
                    },
                    animeType: typeEl?.textContent?.trim() || '',
                    duration: durationEl?.textContent?.trim() || '',
                    rating: 'N/A'
                });
            } catch (e) {
                console.debug('AniWatch parse error on item:', e);
            }
        });

        return results;
    }

    static async getDetails(id) {
        try {
            const cleanId = id.replace(/^\/+/, '');
            const url = `${ANIWATCH_BASE}/${cleanId}`;
            const html = await http.getHTML(url, {
                'Referer': `${ANIWATCH_BASE}/`
            });
            return this.parseDetailPage(html, cleanId);
        } catch (error) {
            console.error('AniWatch getDetails error:', error);
            return {
                id, title: id, description: '', genres: [], coverUrl: '',
                source: 'aniwatch', type: 'anime', rating: 'N/A', status: 'Unknown'
            };
        }
    }

    static parseDetailPage(html, id) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const container = doc.querySelector('#ani_detail .anis-content') || doc.querySelector('.anis-content') || doc;

        const title = container.querySelector('.film-name, .anisc-detail .film-name')?.textContent?.trim() || id;
        const poster = container.querySelector('.film-poster img')?.getAttribute('src')
            || container.querySelector('.film-poster img')?.getAttribute('data-src') || '';
        const description = (container.querySelector('.film-description .text, .film-description')?.textContent?.trim() || '').replace(/\s+/g, ' ');

        // Parse info items
        const infoItems = container.querySelectorAll('.item-title, .anisc-info .item');
        let status = 'Unknown', rating = 'N/A';
        const genres = [];

        infoItems.forEach(item => {
            const label = item.querySelector('.item-head, .name:first-child, span:first-child')?.textContent?.trim()?.toLowerCase() || '';
            const value = item.querySelector('.name, span:last-child')?.textContent?.trim() || '';

            if (label.includes('status')) status = value;
            if (label.includes('score') || label.includes('mal')) rating = value;
        });

        // Extract genres
        const genreLinks = container.querySelectorAll('.item-list a[href*="/genre/"], a[href*="/genre/"]');
        genreLinks.forEach(a => {
            const g = a.textContent.trim();
            if (g) genres.push(g);
        });

        // Get sub/dub/quality badges
        const subCount = container.querySelector('.tick-sub')?.textContent?.trim() || '';
        const dubCount = container.querySelector('.tick-dub')?.textContent?.trim() || '';
        const quality = container.querySelector('.tick-quality, .tick-qulity')?.textContent?.trim() || '';

        return {
            id,
            title,
            description,
            genres,
            coverUrl: poster,
            source: 'aniwatch',
            type: 'anime',
            rating,
            status,
            quality,
            subEpisodes: subCount,
            dubEpisodes: dubCount
        };
    }

    static async getEpisodes(id) {
        try {
            const cleanId = id.replace(/^\/+/, '');
            // Extract numeric ID from slug
            const idMatch = cleanId.match(/-(\d+)$/);
            const numericId = idMatch ? idMatch[1] : cleanId;

            // The episodes are loaded via AJAX endpoint
            const ajaxUrl = `${ANIWATCH_BASE}/ajax/v2/episode/list/${numericId}`;
            const resp = await http.get(ajaxUrl, {
                'Referer': `${ANIWATCH_BASE}/watch/${cleanId}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            });

            // The AJAX response is JSON with an 'html' field containing episode HTML
            let htmlContent = '';
            try {
                const json = resp.json || JSON.parse(resp.data);
                htmlContent = json.html || json.result || '';
            } catch {
                // If not JSON, treat entire response as HTML
                htmlContent = resp.data || '';
            }

            return this.parseEpisodeList(htmlContent, cleanId);
        } catch (error) {
            console.error('AniWatch getEpisodes error:', error);
            return [];
        }
    }

    static parseEpisodeList(html, animeSlug) {
        const episodes = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Episodes are in .ss-list .ep-item or .episodes-list a
        const items = doc.querySelectorAll('.ep-item, .ssl-item a, a[data-number]');
        items.forEach(item => {
            try {
                const epNum = item.getAttribute('data-number')
                    || item.querySelector('.ssli-order, .episode-number')?.textContent?.trim();
                const epTitle = item.getAttribute('title')
                    || item.querySelector('.ep-name, .ssli-detail .ep-name')?.textContent?.trim()
                    || '';
                const href = item.getAttribute('href') || '';
                const epId = item.getAttribute('data-id')
                    || href.replace(/^\/+/, '').replace(/.*\?ep=/, '')
                    || '';
                const isFiller = item.classList.contains('ssl-item-filler')
                    || item.getAttribute('data-filler') === 'true';

                const number = parseInt(epNum) || (episodes.length + 1);

                episodes.push({
                    number,
                    title: epTitle || `Episode ${number}`,
                    url: href.startsWith('http') ? href : (href ? `${ANIWATCH_BASE}${href}` : ''),
                    id: epId || `${animeSlug}?ep=${number}`,
                    episodeId: epId,
                    isFiller
                });
            } catch (e) {
                console.debug('Episode parse error:', e);
            }
        });

        return episodes.sort((a, b) => a.number - b.number);
    }

    static async getStreamUrl(episodeId) {
        try {
            const cleanId = episodeId.replace(/^\/+/, '');

            // Step 1: Get the server list for this episode
            const serversUrl = `${ANIWATCH_BASE}/ajax/v2/episode/servers?episodeId=${encodeURIComponent(cleanId)}`;
            const serversResp = await http.get(serversUrl, {
                'Referer': `${ANIWATCH_BASE}/watch/${cleanId}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            });

            let serversHtml = '';
            try {
                const json = serversResp.json || JSON.parse(serversResp.data);
                serversHtml = json.html || json.result || '';
            } catch {
                serversHtml = serversResp.data || '';
            }

            // Parse server options and pick the best one
            const serverId = this.parseServers(serversHtml);
            if (!serverId) {
                console.warn('No server found for episode:', episodeId);
                return { url: null, quality: 'auto', type: 'hls' };
            }

            // Step 2: Get the actual source URL from the server
            const sourcesUrl = `${ANIWATCH_BASE}/ajax/v2/episode/sources?id=${encodeURIComponent(serverId)}`;
            const sourcesResp = await http.get(sourcesUrl, {
                'Referer': `${ANIWATCH_BASE}/watch/${cleanId}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            });

            let sourcesData = {};
            try {
                sourcesData = sourcesResp.json || JSON.parse(sourcesResp.data);
            } catch {
                console.warn('Failed to parse sources response');
                return { url: null, quality: 'auto', type: 'hls' };
            }

            const link = sourcesData.link || sourcesData.url || '';
            if (!link) {
                return { url: null, quality: 'auto', type: 'hls' };
            }

            // The link may be a direct HLS URL or an embed page
            // If it's an embed, we need to extract the actual stream URL
            if (link.includes('.m3u8')) {
                return {
                    url: link,
                    quality: 'auto',
                    type: 'hls',
                    episodeId: cleanId
                };
            }

            // Try to extract from embed page
            try {
                const embedHtml = await http.getHTML(link, {
                    'Referer': `${ANIWATCH_BASE}/`
                });
                const m3u8Match = embedHtml.match(/file\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                    || embedHtml.match(/source\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                    || embedHtml.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)/i);

                if (m3u8Match) {
                    return {
                        url: m3u8Match[1],
                        quality: 'auto',
                        type: 'hls',
                        episodeId: cleanId
                    };
                }

                // Check for MP4 sources
                const mp4Match = embedHtml.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)/i);
                if (mp4Match) {
                    return {
                        url: mp4Match[1],
                        quality: 'auto',
                        type: 'mp4',
                        episodeId: cleanId
                    };
                }
            } catch (e) {
                console.debug('Embed extraction failed:', e);
            }

            // Return the embed link as fallback (player can try iframe approach)
            return {
                url: link,
                quality: 'auto',
                type: link.includes('.mp4') ? 'mp4' : 'hls',
                episodeId: cleanId
            };
        } catch (error) {
            console.error('AniWatch getStreamUrl error:', error);
            return { url: null, quality: 'auto', type: 'hls' };
        }
    }

    static parseServers(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Prefer sub servers, then dub, then raw
        const serverTypes = [
            '.servers-sub .server-item, [data-type="sub"] .server-item',
            '.servers-dub .server-item, [data-type="dub"] .server-item',
            '.server-item'
        ];

        for (const selector of serverTypes) {
            const servers = doc.querySelectorAll(selector);
            for (const server of servers) {
                const id = server.getAttribute('data-id') || server.getAttribute('data-server-id');
                if (id) return id;
            }
        }

        return null;
    }
}

/**
 * AniWatch Scraper - Direct HTML scraping with mirror fallback
 * Tries multiple AniWatch/Zoro-lineage mirrors until one responds.
 * Uses Capacitor native HTTP to bypass CORS on Android.
 *
 * Selectors (Zoro-lineage layout):
 *  - Search: .film_list-wrap .flw-item
 *  - Card: .film-poster img[data-src], .film-name a.dynamic-name, .tick-sub/dub
 *  - Detail: #ani_detail .anis-content
 *  - Episodes AJAX: /ajax/v2/episode/list/{id}
 *  - Servers AJAX: /ajax/v2/episode/servers?episodeId={id}
 *  - Sources AJAX: /ajax/v2/episode/sources?id={serverId}
 */

import { http } from '../utils/http.js';

// Mirror list — tried in order; first successful response wins.
// aniwatch.to is the canonical domain but is Cloudflare-blocked from many IPs.
const MIRRORS = [
    'https://aniwatchtv.to',
    'https://aniwatch.to',
    'https://aniwatch.sbs'
];

export class AniWatchScraper {
    // Cache the working mirror so subsequent calls are fast
    static _workingBase = null;

    /**
     * Try a request against each mirror until one succeeds.
     * Returns { base, result } where result is the http response.
     */
    static async _tryMirrors(pathFn, headersFn, method = 'getHTML') {
        const bases = this._workingBase
            ? [this._workingBase, ...MIRRORS.filter(m => m !== this._workingBase)]
            : [...MIRRORS];

        let lastError = null;
        for (const base of bases) {
            try {
                const url = pathFn(base);
                const headers = headersFn ? headersFn(base) : {};
                const result = method === 'get'
                    ? await http.get(url, headers)
                    : await http.getHTML(url, headers);
                // Validate we got a real response (not empty / Cloudflare block page)
                const data = method === 'get' ? (result.data || '') : (result || '');
                if (!data || data.length < 100) {
                    throw new Error(`Empty or blocked response from ${base}`);
                }
                // If this was a Cloudflare challenge page, skip it
                if (typeof data === 'string' && data.includes('Just a moment') && data.includes('cf-browser-verification')) {
                    throw new Error(`Cloudflare challenge from ${base}`);
                }
                this._workingBase = base;
                return { base, result };
            } catch (err) {
                lastError = err;
                console.warn(`[AniWatch] Mirror ${base} failed:`, err.message || err);
            }
        }
        throw lastError || new Error('All AniWatch mirrors failed');
    }

    static _getBase() {
        return this._workingBase || MIRRORS[0];
    }

    // ─── Search ───

    static async search(query) {
        try {
            const { base, result: html } = await this._tryMirrors(
                base => `${base}/search?keyword=${encodeURIComponent(query)}`,
                base => ({ 'Referer': `${base}/` })
            );
            return this.parseSearchResults(html, base);
        } catch (error) {
            console.error('AniWatch search error:', error);
            return [];
        }
    }

    static parseSearchResults(html, base) {
        const siteBase = base || this._getBase();
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const items = doc.querySelectorAll('.film_list-wrap .flw-item');
        if (!items.length) {
            // Fallback: try alternate container
            const altItems = doc.querySelectorAll('.flw-item');
            if (altItems.length) {
                return this._parseItems(altItems, siteBase);
            }
            return results;
        }
        return this._parseItems(items, siteBase);
    }

    static _parseItems(items, siteBase) {
        const results = [];
        items.forEach(item => {
            try {
                const nameEl = item.querySelector('.film-name a.dynamic-name, .film-name a, .dynamic-name');
                const posterEl = item.querySelector('.film-poster img');
                const linkEl = item.querySelector('.film-poster-ahref, .film-poster > a, .film-name a');
                const typeEl = item.querySelector('.fd-infor .fdi-item:first-child, .fd-infor span:first-child');
                const durationEl = item.querySelector('.fdi-duration, .fd-infor .fdi-item:nth-child(2)');
                const subEl = item.querySelector('.tick-sub, .tick-item.tick-sub');
                const dubEl = item.querySelector('.tick-dub, .tick-item.tick-dub');
                const epsEl = item.querySelector('.tick-eps, .tick-item.tick-eps');

                if (!nameEl) return;

                const title = nameEl.getAttribute('title') || nameEl.textContent.trim();
                let href = (linkEl?.getAttribute('href') || '').replace(/\?ref=.*$/, '');
                const slug = href.replace(/^\/+/, '').replace(/^watch\//, '');
                const poster = posterEl?.getAttribute('data-src') || posterEl?.getAttribute('src') || '';

                // Numeric ID from slug (e.g., "road-of-naruto-18220" → "18220")
                const idMatch = slug.match(/-(\d+)$/);
                const animeId = idMatch ? idMatch[1] : (linkEl?.getAttribute('data-id') || slug);

                results.push({
                    id: slug || href,
                    title,
                    type: 'anime',
                    source: 'aniwatch',
                    sourceId: slug,
                    coverImage: poster,
                    coverUrl: poster,
                    url: `${siteBase}/${slug}`,
                    slug,
                    animeId,
                    description: '',
                    episodes: {
                        sub: subEl?.textContent?.replace(/[^\d]/g, '') || null,
                        dub: dubEl?.textContent?.replace(/[^\d]/g, '') || null,
                        total: epsEl?.textContent?.replace(/[^\d]/g, '') || null
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

    // ─── Details ───

    static async getDetails(id) {
        try {
            const cleanId = id.replace(/^\/+/, '').replace(/\?ref=.*$/, '');
            const { base, result: html } = await this._tryMirrors(
                base => `${base}/${cleanId}`,
                base => ({ 'Referer': `${base}/` })
            );
            return this.parseDetailPage(html, cleanId, base);
        } catch (error) {
            console.error('AniWatch getDetails error:', error);
            return {
                id, title: id, description: '', genres: [], coverUrl: '',
                coverImage: '', source: 'aniwatch', type: 'anime', rating: 'N/A', status: 'Unknown'
            };
        }
    }

    static parseDetailPage(html, id, base) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const container = doc.querySelector('#ani_detail .anis-content') ||
                          doc.querySelector('.anis-content') ||
                          doc.querySelector('#ani_detail') || doc;

        const title = container.querySelector('.film-name, .anisc-detail .film-name')?.textContent?.trim() || id;
        const poster = container.querySelector('.film-poster img')?.getAttribute('src')
            || container.querySelector('.film-poster img')?.getAttribute('data-src') || '';
        const description = (container.querySelector('.film-description .text, .film-description')
            ?.textContent?.trim() || '').replace(/\s+/g, ' ');

        const infoItems = container.querySelectorAll('.item-title, .anisc-info .item');
        let status = 'Unknown', rating = 'N/A';
        const genres = [];

        infoItems.forEach(item => {
            const label = item.querySelector('.item-head, .name:first-child, span:first-child')
                ?.textContent?.trim()?.toLowerCase() || '';
            const value = item.querySelector('.name, span:last-child')?.textContent?.trim() || '';
            if (label.includes('status')) status = value;
            if (label.includes('score') || label.includes('mal')) rating = value;
        });

        const genreLinks = container.querySelectorAll('.item-list a[href*="/genre/"], a[href*="/genre/"]');
        genreLinks.forEach(a => {
            const g = a.textContent.trim();
            if (g) genres.push(g);
        });

        return {
            id, title, description, genres,
            coverUrl: poster, coverImage: poster,
            source: 'aniwatch', type: 'anime',
            rating, status
        };
    }

    // ─── Episodes (AJAX) ───

    static async getEpisodes(id) {
        try {
            const cleanId = id.replace(/^\/+/, '').replace(/\?ref=.*$/, '');
            const idMatch = cleanId.match(/-(\d+)$/);
            const numericId = idMatch ? idMatch[1] : cleanId;

            const { base, result: resp } = await this._tryMirrors(
                base => `${base}/ajax/v2/episode/list/${numericId}`,
                base => ({
                    'Referer': `${base}/watch/${cleanId}`,
                    'X-Requested-With': 'XMLHttpRequest',
                    'Accept': 'application/json, text/javascript, */*; q=0.01'
                }),
                'get'
            );

            let htmlContent = '';
            try {
                const json = resp.json || (typeof resp.data === 'string' ? JSON.parse(resp.data) : resp.data);
                htmlContent = json.html || json.result || '';
            } catch {
                htmlContent = resp.data || '';
            }

            return this.parseEpisodeList(htmlContent, cleanId, base);
        } catch (error) {
            console.error('AniWatch getEpisodes error:', error);
            return [];
        }
    }

    static parseEpisodeList(html, animeSlug, base) {
        const siteBase = base || this._getBase();
        const episodes = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        const items = doc.querySelectorAll('.ep-item, .ssl-item.ep-item, a[data-number]');
        items.forEach(item => {
            try {
                const epNum = item.getAttribute('data-number')
                    || item.querySelector('.ssli-order, .episode-number')?.textContent?.trim();
                const epTitle = item.getAttribute('title')
                    || item.querySelector('.ep-name, .ssli-detail .ep-name, .e-dynamic-name')?.textContent?.trim()
                    || '';
                const href = item.getAttribute('href') || '';
                const epId = item.getAttribute('data-id')
                    || href.match(/\?ep=(\d+)/)?.[1]
                    || '';
                const isFiller = item.classList?.contains('ssl-item-filler')
                    || item.getAttribute('data-filler') === 'true';

                const number = parseInt(epNum) || (episodes.length + 1);

                episodes.push({
                    number,
                    title: epTitle || `Episode ${number}`,
                    url: href.startsWith('http') ? href : (href ? `${siteBase}${href}` : ''),
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

    // ─── Stream URL ───

    static async getStreamUrl(episodeId) {
        try {
            const cleanId = String(episodeId).replace(/^\/+/, '');
            const base = this._getBase();

            // Step 1: Get servers
            const serversUrl = `${base}/ajax/v2/episode/servers?episodeId=${encodeURIComponent(cleanId)}`;
            const serversResp = await http.get(serversUrl, {
                'Referer': `${base}/watch/${cleanId}`,
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

            const serverId = this.parseServers(serversHtml);
            if (!serverId) {
                console.warn('No server found for episode:', episodeId);
                return { url: null, quality: 'auto', type: 'hls' };
            }

            // Step 2: Get source URL
            const sourcesUrl = `${base}/ajax/v2/episode/sources?id=${encodeURIComponent(serverId)}`;
            const sourcesResp = await http.get(sourcesUrl, {
                'Referer': `${base}/watch/${cleanId}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            });

            let sourcesData = {};
            try {
                sourcesData = sourcesResp.json || JSON.parse(sourcesResp.data);
            } catch {
                return { url: null, quality: 'auto', type: 'hls' };
            }

            const link = sourcesData.link || sourcesData.url || '';
            if (!link) return { url: null, quality: 'auto', type: 'hls' };

            if (link.includes('.m3u8')) {
                return { url: link, quality: 'auto', type: 'hls', episodeId: cleanId };
            }

            // Try extracting stream from embed page
            try {
                const embedHtml = await http.getHTML(link, { 'Referer': `${base}/` });
                const m3u8Match = embedHtml.match(/file\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                    || embedHtml.match(/source\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                    || embedHtml.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)/i);
                if (m3u8Match) return { url: m3u8Match[1], quality: 'auto', type: 'hls', episodeId: cleanId };

                const mp4Match = embedHtml.match(/["'](https?:\/\/[^"']*\.mp4[^"']*)/i);
                if (mp4Match) return { url: mp4Match[1], quality: 'auto', type: 'mp4', episodeId: cleanId };
            } catch (e) {
                console.debug('Embed extraction failed:', e);
            }

            return { url: link, quality: 'auto', type: link.includes('.mp4') ? 'mp4' : 'hls', episodeId: cleanId };
        } catch (error) {
            console.error('AniWatch getStreamUrl error:', error);
            return { url: null, quality: 'auto', type: 'hls' };
        }
    }

    static parseServers(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

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

/**
 * AniWatch Scraper - Uses local anivault-backend (aniwatch npm package)
 * The backend runs in Termux at localhost:6969 and handles all the
 * HiAnime/AniWatch scraping via the `aniwatch` npm package by ghoshRitesh12.
 * Falls back to direct mirror scraping if backend is unreachable.
 */

import { http } from '../utils/http.js';

// Local backend (Termux) — primary source
const BACKEND_URL = 'http://localhost:6969/api';
const BACKEND_RECHECK_MS = 15000;

// Mirror fallback for direct scraping if backend is down
const MIRRORS = [
    'https://aniwatchtv.to',
    'https://aniwatch.to',
    'https://aniwatch.sbs'
];

export class AniWatchScraper {
    static _backendAvailable = null; // null = untested, true/false
    static _backendLastCheck = 0;
    static _workingMirror = null;

    // ─── Backend helpers ───

    static async _backendGet(path) {
        const url = `${BACKEND_URL}${path}`;
        const result = await http.get(url, { 'Accept': 'application/json' }, 5000);
        if (result.status < 200 || result.status >= 300) {
            throw new Error(`Backend HTTP ${result.status}`);
        }
        const data = result.json || JSON.parse(result.data);
        if (data?.success === false) throw new Error(data.error || 'Backend returned error');
        return data?.data ?? data;
    }

    static async _checkBackend(force = false) {
        const now = Date.now();
        if (!force && this._backendAvailable !== null && (now - this._backendLastCheck) < BACKEND_RECHECK_MS) {
            return this._backendAvailable;
        }

        this._backendLastCheck = now;
        try {
            const health = await http.get(`${BACKEND_URL}/health`, { 'Accept': 'application/json' }, 3000);
            const parsed = health.json || JSON.parse(health.data || '{}');
            this._backendAvailable = health.status >= 200 && health.status < 300 &&
                (parsed?.status === 'ok' || parsed?.success === true);
            if (this._backendAvailable) {
                console.log('[AniWatch] Backend available at localhost:6969');
            } else {
                console.log('[AniWatch] Backend health check failed, using direct scraping');
            }
        } catch (e) {
            this._backendAvailable = false;
            console.log('[AniWatch] Backend not available, using direct scraping:', e?.message || e);
        }
        return this._backendAvailable;
    }

    // ─── Search ───

    static async search(query) {
        try {
            // Try backend first
            if (await this._checkBackend()) {
                try {
                    const data = await this._backendGet(`/search?q=${encodeURIComponent(query)}`);
                    return this._mapBackendSearchResults(data);
                } catch (e) {
                    console.warn('[AniWatch] Backend search failed, trying mirrors:', e.message);
                    this._backendAvailable = false;
                    this._backendLastCheck = Date.now();
                }
            }
            // Fallback: direct mirror scraping
            return await this._searchDirect(query);
        } catch (error) {
            console.error('AniWatch search error:', error);
            return [];
        }
    }

    static _mapBackendSearchResults(data) {
        const animes = data?.animes || data?.results || data?.mostPopularAnimes || [];
        if (!Array.isArray(animes)) return [];
        return animes.map(a => ({
            id: a.id || '',
            title: a.name || a.title || '',
            type: 'anime',
            source: 'aniwatch',
            sourceId: a.id || '',
            coverImage: a.poster || a.image || '',
            coverUrl: a.poster || a.image || '',
            url: a.id ? `https://aniwatchtv.to/${a.id}` : '',
            slug: a.id || '',
            animeId: a.id?.match(/-(\d+)$/)?.[1] || a.id || '',
            description: '',
            episodes: {
                sub: a.episodes?.sub || null,
                dub: a.episodes?.dub || null,
                total: a.episodes?.sub || null
            },
            animeType: a.type || '',
            duration: a.duration || '',
            rating: a.rating || 'N/A'
        }));
    }

    // ─── Details ───

    static async getDetails(id) {
        try {
            const cleanId = id.replace(/^\/+/, '').replace(/\?ref=.*$/, '');
            if (await this._checkBackend()) {
                try {
                    const data = await this._backendGet(`/anime/${cleanId}`);
                    return this._mapBackendInfo(data, cleanId);
                } catch (e) {
                    console.warn('[AniWatch] Backend info failed:', e.message);
                    this._backendAvailable = false;
                    this._backendLastCheck = Date.now();
                }
            }
            return await this._getDetailsDirect(cleanId);
        } catch (error) {
            console.error('AniWatch getDetails error:', error);
            return {
                id, title: id, description: '', genres: [], coverUrl: '',
                coverImage: '', source: 'aniwatch', type: 'anime', rating: 'N/A', status: 'Unknown'
            };
        }
    }

    static _mapBackendInfo(data, id) {
        const anime = data.anime || data;
        const info = anime.info || anime;
        const moreInfo = anime.moreInfo || {};
        return {
            id,
            title: info.name || info.title || id,
            description: info.description || '',
            genres: moreInfo.genres || info.genres || [],
            coverUrl: info.poster || info.image || '',
            coverImage: info.poster || info.image || '',
            source: 'aniwatch',
            type: 'anime',
            rating: info.stats?.rating || moreInfo.malscore || 'N/A',
            status: moreInfo.status || 'Unknown',
            quality: info.stats?.quality || '',
            studios: Array.isArray(moreInfo.studios) ? moreInfo.studios.join(', ') : (moreInfo.studios || ''),
            duration: moreInfo.duration || info.stats?.duration || '',
            aired: moreInfo.aired || '',
            premiered: moreInfo.premiered || ''
        };
    }

    // ─── Episodes ───

    static async getEpisodes(id) {
        try {
            const cleanId = this._extractAnimeSlug(id);
            if (await this._checkBackend()) {
                try {
                    const data = await this._backendGet(`/anime/${cleanId}/episodes`);
                    return this._mapBackendEpisodes(data, cleanId);
                } catch (e) {
                    console.warn('[AniWatch] Backend episodes failed:', e.message);
                    this._backendAvailable = false;
                    this._backendLastCheck = Date.now();
                }
            }
            return await this._getEpisodesDirect(cleanId);
        } catch (error) {
            console.error('AniWatch getEpisodes error:', error);
            return [];
        }
    }

    static _mapBackendEpisodes(data, animeSlug) {
        const episodes = data?.episodes || data || [];
        if (!Array.isArray(episodes)) return [];
        return episodes.map((ep, index) => {
            const number = Number(ep.number) || (index + 1);
            const normalizedEpisodeId = this._extractEpisodeId(ep.episodeId || ep.id || number);
            return {
                number,
                title: ep.title || `Episode ${number}`,
                url: `https://aniwatchtv.to/watch/${animeSlug}?ep=${normalizedEpisodeId || number}`,
                id: normalizedEpisodeId || `${animeSlug}?ep=${number}`,
                episodeId: normalizedEpisodeId || '',
                sourceEpisodeId: ep.episodeId || '',
                isFiller: ep.isFiller || false
            };
        }).sort((a, b) => a.number - b.number);
    }

    // ─── Stream URL (direct mirror only — backend doesn't do streaming) ───

    static async getStreamUrl(episodeId, audioType = null) {
        try {
            const cleanId = this._extractEpisodeId(episodeId);
            if (!cleanId) return { url: null, quality: 'auto', type: 'hls' };
            const base = this._workingMirror || MIRRORS[0];

            const serversUrl = `${base}/ajax/v2/episode/servers?episodeId=${encodeURIComponent(cleanId)}`;
            const serversResp = await http.get(serversUrl, {
                'Referer': `${base}/watch/?ep=${cleanId}`,
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

            // Try ALL servers, filtered by audio type preference
            const allServers = this._parseAllServers(serversHtml);
            if (allServers.length === 0) return { url: null, quality: 'auto', type: 'hls' };

            let servers = allServers;
            if (audioType) {
                const preferred = allServers.filter(s => s.type === audioType);
                const others = allServers.filter(s => s.type !== audioType);
                servers = [...preferred, ...others];
            }

            for (const server of servers) {
                const serverId = server.id;
                const serverAudioType = server.type;
                try {
                    const sourcesUrl = `${base}/ajax/v2/episode/sources?id=${encodeURIComponent(serverId)}`;
                    const sourcesResp = await http.get(sourcesUrl, {
                        'Referer': `${base}/watch/?ep=${cleanId}`,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*; q=0.01'
                    });

                    let sourcesData = {};
                    try { sourcesData = sourcesResp.json || JSON.parse(sourcesResp.data); } catch {}

                    const link = sourcesData.link || sourcesData.url || '';
                    if (!link) continue;

                    // Direct m3u8
                    if (link.includes('.m3u8')) {
                        return { url: link, quality: 'auto', type: 'hls', episodeId: cleanId, audioType: serverAudioType };
                    }

                    // Direct mp4
                    if (link.includes('.mp4')) {
                        return { url: link, quality: 'auto', type: 'mp4', episodeId: cleanId, audioType: serverAudioType };
                    }

                    // Embed URL → extract m3u8 via getSources API
                    if (link.includes('megacloud') || link.includes('embed')) {
                        const m3u8 = await this._extractMegacloudStream(link);
                        if (m3u8) {
                            return { url: m3u8.url, quality: 'auto', type: 'hls', episodeId: cleanId, tracks: m3u8.tracks, embedUrl: link, audioType: serverAudioType };
                        }
                    }

                    // Fallback: try scraping embed HTML for m3u8 refs
                    try {
                        const embedHtml = await http.getHTML(link, { 'Referer': `${base}/` });
                        const m3u8Match = embedHtml.match(/file\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                            || embedHtml.match(/source\s*[:=]\s*["']([^"']*\.m3u8[^"']*)/i)
                            || embedHtml.match(/["'](https?:\/\/[^"']*\.m3u8[^"']*)/i);
                        if (m3u8Match) return { url: m3u8Match[1], quality: 'auto', type: 'hls', episodeId: cleanId, audioType: serverAudioType };
                    } catch {}

                    // Last resort: iframe embed
                    if (link.startsWith('http')) {
                        return { url: link, quality: 'auto', type: 'iframe', episodeId: cleanId, audioType: serverAudioType };
                    }
                } catch (e) {
                    console.warn('Server failed:', serverId, e.message);
                }
            }

            return { url: null, quality: 'auto', type: 'hls' };
        } catch (error) {
            console.error('AniWatch getStreamUrl error:', error);
            return { url: null, quality: 'auto', type: 'hls' };
        }
    }

    /**
     * Extract actual m3u8 stream URL from megacloud embed.
     * 1. Fetch embed page with ?_debug=true to get the client key
     * 2. Call getSources endpoint with client key to get unencrypted sources
     */
    static async _extractMegacloudStream(embedUrl) {
        try {
            const url = new URL(embedUrl);
            const debugUrl = `${url.origin}${url.pathname}${url.search ? url.search + '&' : '?'}_debug=true`;

            const embedHtml = await http.getHTML(debugUrl, {
                'Referer': 'https://aniwatchtv.to/',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            // Extract client key: 48-char alphanumeric token
            const keyMatch = embedHtml.match(/[a-zA-Z0-9]{48}/);
            if (!keyMatch) {
                console.warn('[MegaCloud] No client key found in embed page');
                return null;
            }
            const clientKey = keyMatch[0];

            // Build getSources URL: same path prefix + /getSources?id=<videoId>&_k=<clientKey>
            const pathParts = url.pathname.split('/').filter(Boolean);
            const videoId = pathParts.pop();
            const basePath = '/' + pathParts.join('/');
            const sourcesUrl = `${url.origin}${basePath}/getSources?id=${videoId}&_k=${clientKey}`;

            const sourcesResp = await http.get(sourcesUrl, {
                'Referer': embedUrl,
                'X-Requested-With': 'XMLHttpRequest',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            });

            let data = {};
            try { data = sourcesResp.json || JSON.parse(sourcesResp.data); } catch {}

            // If sources is encrypted (string), we can't decrypt client-side
            if (typeof data.sources === 'string') {
                console.warn('[MegaCloud] Sources are encrypted, cannot extract');
                return null;
            }

            // Unencrypted sources array
            if (Array.isArray(data.sources) && data.sources.length > 0) {
                const src = data.sources[0];
                const fileUrl = src.file || src.url || '';
                if (fileUrl.includes('.m3u8') || fileUrl.includes('.mp4')) {
                    console.log('[MegaCloud] Extracted stream:', fileUrl.substring(0, 80) + '...');
                    return {
                        url: fileUrl,
                        tracks: Array.isArray(data.tracks) ? data.tracks : []
                    };
                }
            }

            return null;
        } catch (e) {
            console.warn('[MegaCloud] Extraction failed:', e.message);
            return null;
        }
    }

    // ─── Direct mirror scraping fallbacks ───

    static async _tryMirrors(pathFn, headersFn, method = 'getHTML') {
        const bases = this._workingMirror
            ? [this._workingMirror, ...MIRRORS.filter(m => m !== this._workingMirror)]
            : [...MIRRORS];

        let lastError = null;
        for (const base of bases) {
            try {
                const url = pathFn(base);
                const headers = headersFn ? headersFn(base) : {};
                const result = method === 'get'
                    ? await http.get(url, headers)
                    : await http.getHTML(url, headers);
                const data = method === 'get' ? (result.data || '') : (result || '');
                if (!data || data.length < 100) throw new Error(`Empty response from ${base}`);
                if (typeof data === 'string' && data.includes('Just a moment') && data.includes('cf-browser-verification')) {
                    throw new Error(`Cloudflare challenge from ${base}`);
                }
                this._workingMirror = base;
                return { base, result };
            } catch (err) {
                lastError = err;
                console.warn(`[AniWatch] Mirror ${base} failed:`, err.message || err);
            }
        }
        throw lastError || new Error('All AniWatch mirrors failed');
    }

    static async _searchDirect(query) {
        const { base, result: html } = await this._tryMirrors(
            b => `${b}/search?keyword=${encodeURIComponent(query)}`,
            b => ({ 'Referer': `${b}/` })
        );
        return this._parseSearchHTML(html, base);
    }

    static _parseSearchHTML(html, base) {
        const results = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const items = doc.querySelectorAll('.flw-item');

        items.forEach(item => {
            try {
                const nameEl = item.querySelector('.film-name a.dynamic-name, .film-name a, .dynamic-name');
                const posterEl = item.querySelector('.film-poster img');
                const linkEl = item.querySelector('.film-poster-ahref, .film-poster > a, .film-name a');
                const subEl = item.querySelector('.tick-sub, .tick-item.tick-sub');
                const dubEl = item.querySelector('.tick-dub, .tick-item.tick-dub');
                if (!nameEl) return;

                const title = nameEl.getAttribute('title') || nameEl.textContent.trim();
                const href = (linkEl?.getAttribute('href') || '').replace(/\?ref=.*$/, '');
                const slug = href.replace(/^\/+/, '').replace(/^watch\//, '');
                const poster = posterEl?.getAttribute('data-src') || posterEl?.getAttribute('src') || '';
                const idMatch = slug.match(/-(\d+)$/);

                results.push({
                    id: slug, title, type: 'anime', source: 'aniwatch',
                    coverImage: poster, coverUrl: poster,
                    url: `${base}/${slug}`, slug,
                    animeId: idMatch ? idMatch[1] : slug,
                    episodes: {
                        sub: subEl?.textContent?.replace(/[^\d]/g, '') || null,
                        dub: dubEl?.textContent?.replace(/[^\d]/g, '') || null
                    },
                    rating: 'N/A'
                });
            } catch (e) { console.debug('Parse error:', e); }
        });
        return results;
    }

    static async _getDetailsDirect(id) {
        const { base, result: html } = await this._tryMirrors(
            b => `${b}/${id}`, b => ({ 'Referer': `${b}/` })
        );
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const container = doc.querySelector('#ani_detail') || doc;
        const title = container.querySelector('.film-name')?.textContent?.trim() || id;
        const poster = container.querySelector('.film-poster img')?.getAttribute('src')
            || container.querySelector('.film-poster img')?.getAttribute('data-src') || '';
        const desc = container.querySelector('.film-description .text, .film-description')?.textContent?.trim() || '';
        return {
            id, title, description: desc, genres: [],
            coverUrl: poster, coverImage: poster,
            source: 'aniwatch', type: 'anime', rating: 'N/A', status: 'Unknown'
        };
    }

    static async _getEpisodesDirect(id) {
        const idMatch = id.match(/-(\d+)$/);
        const numericId = idMatch ? idMatch[1] : id;
        const { base, result: resp } = await this._tryMirrors(
            b => `${b}/ajax/v2/episode/list/${numericId}`,
            b => ({
                'Referer': `${b}/watch/${id}`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01'
            }),
            'get'
        );
        let htmlContent = '';
        try {
            const json = resp.json || JSON.parse(resp.data);
            htmlContent = json.html || json.result || '';
        } catch { htmlContent = resp.data || ''; }

        const episodes = [];
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        doc.querySelectorAll('.ep-item, a[data-number]').forEach(item => {
            const epNum = item.getAttribute('data-number');
            const epTitle = item.getAttribute('title') || item.querySelector('.ep-name')?.textContent?.trim() || '';
            const href = item.getAttribute('href') || '';
            const epId = item.getAttribute('data-id') || href.match(/\?ep=(\d+)/)?.[1] || '';
            const number = parseInt(epNum) || (episodes.length + 1);
            episodes.push({
                number, title: epTitle || `Episode ${number}`,
                url: href.startsWith('http') ? href : (href ? `${base}${href}` : ''),
                id: epId || `${id}?ep=${number}`, episodeId: epId,
                isFiller: item.classList?.contains('ssl-item-filler') || false
            });
        });
        return episodes.sort((a, b) => a.number - b.number);
    }

    static _parseServers(html) {
        const servers = this._parseAllServers(html);
        return servers.length > 0 ? servers[0].id : null;
    }

    /**
     * Parse all server entries from the servers HTML, returning typed objects.
     * @returns {Array<{id: string, type: string}>} — type is 'sub', 'dub', or 'raw'
     */
    static _parseAllServers(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const servers = [];
        const seen = new Set();

        const typeGroups = [
            { selector: '.servers-sub .server-item[data-id]', type: 'sub' },
            { selector: '.servers-raw .server-item[data-id]', type: 'raw' },
            { selector: '.servers-dub .server-item[data-id]', type: 'dub' },
        ];

        for (const { selector, type } of typeGroups) {
            for (const s of doc.querySelectorAll(selector)) {
                const id = s.getAttribute('data-id') || s.getAttribute('data-server-id');
                if (id && /^\d+$/.test(String(id)) && !seen.has(id)) {
                    seen.add(id);
                    servers.push({ id: String(id), type });
                }
            }
        }

        // Fallback: untyped servers default to 'sub'
        for (const sel of ['.server-item[data-id]', '.server-item[data-server-id]']) {
            for (const s of doc.querySelectorAll(sel)) {
                const id = s.getAttribute('data-id') || s.getAttribute('data-server-id');
                if (id && /^\d+$/.test(String(id)) && !seen.has(id)) {
                    seen.add(id);
                    servers.push({ id: String(id), type: 'sub' });
                }
            }
        }

        return servers;
    }

    static _extractEpisodeId(value) {
        if (value === null || value === undefined) return '';
        const text = String(value).trim();
        if (!text) return '';
        if (/^\d+$/.test(text)) return text;

        const epMatch = text.match(/[?&]ep=(\d+)/i);
        if (epMatch) return epMatch[1];

        const idMatch = text.match(/[?&]id=(\d+)/i);
        if (idMatch) return idMatch[1];

        try {
            const parsed = new URL(text);
            const epFromUrl = parsed.searchParams.get('ep');
            if (epFromUrl && /^\d+$/.test(epFromUrl)) return epFromUrl;
            const idFromUrl = parsed.searchParams.get('id');
            if (idFromUrl && /^\d+$/.test(idFromUrl)) return idFromUrl;
        } catch (_) {}

        const tailMatch = text.match(/(\d+)$/);
        if (tailMatch) return tailMatch[1];

        return '';
    }

    static _extractAnimeSlug(value) {
        if (!value) return '';
        let text = String(value).trim();
        if (!text) return '';

        if (/^https?:\/\//i.test(text)) {
            try {
                const parsed = new URL(text);
                text = parsed.pathname || '';
            } catch (_) {
                return '';
            }
        }

        text = text.replace(/^\/+/, '').replace(/^watch\//, '');
        text = text.split('?')[0].split('#')[0].replace(/\/+$/, '');
        if (/^[a-z0-9-]+-\d+$/i.test(text)) return text;
        const slugMatch = text.match(/([a-z0-9-]+-\d+)$/i);
        return slugMatch ? slugMatch[1] : '';
    }
}

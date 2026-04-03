/**
 * DownloadManager — processes queued downloads in IndexedDB.
 *
 * Manga chapters: fetches every page image, converts to data-URL, stores in
 * a "downloadedPages" field on the download record so the reader can show
 * them offline.
 *
 * Anime episodes: uses native CDNDownloader plugin (hidden WebView on
 * megacloud.blog origin) to fetch HLS segments through Chrome's real engine,
 * bypassing both TLS fingerprint blocking and CORS origin restrictions.
 */

import { db } from '../db/indexeddb.js';
import { SearchCoordinator } from '../scrapers/coordinator.js';

const POLL_INTERVAL = 3000;

class _DownloadManager {
    constructor() {
        this._running = false;
        this._timer = null;
        this._currentId = null;
        this._aborted = false;
        this._cdnPlugin = null;
        this._cdnReady = false;
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._tick();
        console.log('[DL] DownloadManager started');
    }

    stop() {
        this._running = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        console.log('[DL] DownloadManager stopped');
    }

    async cancel(downloadId) {
        if (this._currentId === downloadId) {
            this._aborted = true;
        }
        try {
            await db.updateDownload(downloadId, { status: 'failed', error: 'Cancelled' });
        } catch (_) {}
    }

    async retry(downloadId) {
        try {
            await db.updateDownload(downloadId, { status: 'queued', progress: 0, error: null });
        } catch (_) {}
    }

    /** Check if a download exists for a given library item + episode token */
    async getDownloadForEpisode(libraryId, episodeToken) {
        const all = await db.getDownloads();
        return all.find(d =>
            d.libraryId === libraryId &&
            d.episodeOrChapterId &&
            d.episodeOrChapterId.startsWith(episodeToken) &&
            d.status === 'completed' &&
            d.videoDataUrl
        ) || null;
    }

    // ── internal loop ──

    async _tick() {
        if (!this._running) return;
        try {
            const item = await this._nextQueued();
            if (item) {
                await this._process(item);
                if (this._running) { this._timer = setTimeout(() => this._tick(), 200); }
                return;
            }
        } catch (err) {
            console.error('[DL] tick error', err);
        }
        if (this._running) {
            this._timer = setTimeout(() => this._tick(), POLL_INTERVAL);
        }
    }

    async _nextQueued() {
        const all = await db.getDownloads();
        return all.find(d => d.status === 'queued') || null;
    }

    async _process(item) {
        this._currentId = item.id;
        this._aborted = false;
        await db.updateDownload(item.id, { status: 'downloading', progress: 0 });

        try {
            const type = item.itemType || 'anime';
            if (type === 'manga') {
                await this._downloadManga(item);
            } else {
                await this._downloadAnime(item);
            }

            if (this._aborted) throw new Error('Cancelled');
            await db.updateDownload(item.id, { status: 'completed', progress: 100 });
            console.log(`[DL] completed ${item.id}`);
        } catch (err) {
            console.error(`[DL] failed ${item.id}`, err);
            await db.updateDownload(item.id, {
                status: 'failed',
                error: err.message || 'Download failed'
            }).catch(() => {});
        } finally {
            this._currentId = null;
        }
    }

    // ── Manga: fetch all pages as data-URLs ──

    async _downloadManga(item) {
        const chapterId = item.sourceId || item.localPath || item.episodeOrChapterId;
        const source = item.source || 'mangakatana';

        const pages = await SearchCoordinator.getChapterPages(chapterId, source);
        if (!pages || pages.length === 0) throw new Error('No pages found for chapter');

        const downloadedPages = [];
        for (let i = 0; i < pages.length; i++) {
            if (this._aborted) throw new Error('Cancelled');

            try {
                const dataUrl = await this._fetchAsDataUrl(pages[i]);
                downloadedPages.push(dataUrl);
            } catch (e) {
                console.warn(`[DL] page ${i + 1} failed:`, e.message);
                downloadedPages.push(null);
            }

            const progress = Math.round(((i + 1) / pages.length) * 100);
            await db.updateDownload(item.id, { progress });
        }

        await db.updateDownload(item.id, {
            downloadedPages,
            totalPages: pages.length,
            fileSize: downloadedPages.reduce((s, p) => s + (p ? p.length : 0), 0)
        });
    }

    // ── Anime: download HLS stream as offline video ──

    async _downloadAnime(item) {
        const episodeId = item.sourceId || item.localPath || item.episodeOrChapterId;
        const source = item.source || 'aniwatch';

        await db.updateDownload(item.id, { progress: 2 });

        // 1. Resolve stream URL
        const streamData = await SearchCoordinator.getAnimeStreamUrl(episodeId, source);
        if (!streamData || !streamData.url) throw new Error('Could not resolve stream URL');

        // If it's an iframe-only stream, we can't download it
        if (streamData.type === 'iframe') {
            throw new Error('This episode uses an embed player and cannot be downloaded for offline viewing.');
        }

        await db.updateDownload(item.id, { progress: 5 });

        const m3u8Url = streamData.url;

        // 2. Fetch master m3u8
        const m3u8Text = await this._fetchText(m3u8Url);
        if (this._aborted) throw new Error('Cancelled');

        // 3. Parse — if master playlist, pick a quality; if media playlist, use directly
        let mediaUrl = m3u8Url;
        let mediaText = m3u8Text;

        if (m3u8Text.includes('#EXT-X-STREAM-INF')) {
            const lines = m3u8Text.split('\n');
            let bestLine = null;
            let bestBw = Infinity;
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/#EXT-X-STREAM-INF.*BANDWIDTH=(\d+)/);
                if (match) {
                    const bw = parseInt(match[1], 10);
                    const nextLine = lines[i + 1]?.trim();
                    if (nextLine && !nextLine.startsWith('#')) {
                        if (bw < bestBw) {
                            bestBw = bw;
                            bestLine = nextLine;
                        }
                    }
                }
            }
            if (bestLine) {
                mediaUrl = new URL(bestLine, m3u8Url).href;
                mediaText = await this._fetchText(mediaUrl);
            }
        }

        if (this._aborted) throw new Error('Cancelled');
        await db.updateDownload(item.id, { progress: 10 });

        // 4. Parse media playlist for .ts segment URLs
        const segments = [];
        const lines = mediaText.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#')) {
                segments.push(new URL(trimmed, mediaUrl).href);
            }
        }

        if (segments.length === 0) throw new Error('No video segments found in playlist');
        console.log(`[DL] Found ${segments.length} segments to download`);

        // 5. Download segments via CDN plugin (hidden WebView on megacloud.blog)
        const chunks = [];
        let totalBytes = 0;
        let failedCount = 0;
        for (let i = 0; i < segments.length; i++) {
            if (this._aborted) throw new Error('Cancelled');

            try {
                const buf = await this._fetchSegment(segments[i]);
                chunks.push(buf);
                totalBytes += buf.byteLength;
                failedCount = 0;
            } catch (e) {
                failedCount++;
                console.warn(`[DL] segment ${i + 1}/${segments.length} failed:`, e.message);
                if (failedCount > 3 && chunks.length === 0) {
                    throw new Error(`CDN blocked downloads (${e.message}). Try again later.`);
                }
            }

            // Small delay between segments
            if (i < segments.length - 1) {
                await new Promise(r => setTimeout(r, 50));
            }

            // Progress: 10–90% for segment downloads
            const progress = 10 + Math.round(((i + 1) / segments.length) * 80);
            await db.updateDownload(item.id, { progress });
        }

        if (chunks.length === 0) throw new Error('Failed to download any video segments');

        // 6. Concatenate into single blob
        const blob = new Blob(chunks, { type: 'video/mp2t' });
        console.log(`[DL] Total video size: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);

        await db.updateDownload(item.id, { progress: 92 });

        // 7. Convert to data URL for IndexedDB storage
        const videoDataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });

        await db.updateDownload(item.id, {
            progress: 98,
            videoDataUrl,
            fileSize: totalBytes,
            streamType: 'offline'
        });
    }

    // ── Shared helpers ──

    /**
     * Initialize the native CDNDownloader plugin (hidden WebView on megacloud.blog).
     * Must be called before downloading anime segments.
     */
    async _ensureCDNPlugin() {
        if (this._cdnReady) return true;
        try {
            this._cdnPlugin = window.Capacitor?.Plugins?.CDNDownloader || null;
            if (!this._cdnPlugin) {
                console.warn('[DL] CDNDownloader plugin not available');
                return false;
            }
            console.log('[DL] Initializing CDN downloader (hidden WebView)...');
            await this._cdnPlugin.init({ originUrl: 'https://megacloud.blog/' });
            this._cdnReady = true;
            console.log('[DL] CDN downloader ready');
            return true;
        } catch (e) {
            console.warn('[DL] CDN plugin init failed:', e.message || e);
            return false;
        }
    }

    /** Fetch text (m3u8 playlists) via CDN plugin or fallback to patched fetch */
    async _fetchText(url) {
        // Strategy 1: Native CDN plugin (hidden WebView with megacloud.blog origin)
        if (await this._ensureCDNPlugin()) {
            try {
                const result = await this._cdnPlugin.fetchText({ url });
                if (result && result.text) {
                    console.log('[DL] CDN plugin fetched text OK:', url.substring(0, 60));
                    return result.text;
                }
            } catch (e) {
                console.warn('[DL] CDN plugin fetchText failed:', e.message || e);
            }
        }

        // Strategy 2: Patched fetch (CapacitorHttp native — works for non-CDN URLs)
        console.log('[DL] Fallback to patched fetch for:', url.substring(0, 60));
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
        return resp.text();
    }

    /** Fetch a binary segment via CDN plugin (with retry) */
    async _fetchSegment(url, retries = 2) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            // Strategy 1: Native CDN plugin
            if (this._cdnReady && this._cdnPlugin) {
                try {
                    const result = await this._cdnPlugin.fetchSegment({ url });
                    if (result && result.data) {
                        return this._dataUrlToArrayBuffer(result.data);
                    }
                } catch (e) {
                    const msg = e.message || e || '';
                    if (msg.includes('403') && attempt < retries) {
                        await new Promise(r => setTimeout(r, 500 + attempt * 500));
                        continue;
                    }
                    if (attempt >= retries) throw new Error(msg);
                    await new Promise(r => setTimeout(r, 500));
                    continue;
                }
            }

            // Strategy 2: Patched fetch fallback
            try {
                const resp = await fetch(url);
                if (resp.ok) return resp.arrayBuffer();
                throw new Error(`HTTP ${resp.status}`);
            } catch (e) {
                if (attempt >= retries) throw e;
                await new Promise(r => setTimeout(r, 500));
            }
        }
        throw new Error('All download strategies failed');
    }

    /** Convert a data:...;base64,... URL to ArrayBuffer */
    _dataUrlToArrayBuffer(dataUrl) {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    async _fetchAsDataUrl(url) {
        // For manga pages — try CDN plugin first, then patched fetch
        if (await this._ensureCDNPlugin()) {
            try {
                const result = await this._cdnPlugin.fetchSegment({ url });
                if (result && result.data) return result.data; // Already a data URL
            } catch (e) {
                console.warn('[DL] CDN plugin image fetch failed:', e.message);
            }
        }

        // Fallback: patched fetch
        const response = await fetch(url, {
            headers: { 'Referer': new URL(url).origin + '/' }
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }
}

export const DownloadManager = new _DownloadManager();

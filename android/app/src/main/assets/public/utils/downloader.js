/**
 * DownloadManager — processes queued downloads in IndexedDB.
 *
 * Manga chapters: fetches every page image via patched fetch, converts to
 * data-URL, stores in a "downloadedPages" field.
 *
 * Anime episodes: uses native CDNDownloader plugin which loads the embed
 * page in a hidden WebView. The embed page decrypts sources and starts
 * HLS.js — we intercept the m3u8 URL, then download segments through
 * the same WebView (correct CORS origin + Chrome TLS fingerprint).
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
    }

    start() {
        if (this._running) return;
        this._running = true;
        this._tick();
        this._emitActiveCount();
        console.log('[DL] DownloadManager started');
    }

    stop() {
        this._running = false;
        if (this._timer) { clearTimeout(this._timer); this._timer = null; }
        console.log('[DL] DownloadManager stopped');
    }

    async cancel(downloadId) {
        if (this._currentId === downloadId) this._aborted = true;
        try { await db.updateDownload(downloadId, { status: 'failed', error: 'Cancelled' }); } catch (_) {}
        this._emitActiveCount();
    }

    async retry(downloadId) {
        try { await db.updateDownload(downloadId, { status: 'queued', progress: 0, error: null }); } catch (_) {}
        this._emitActiveCount();
    }

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
        this._emitActiveCount();

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
            this._emitActiveCount();
        }
    }

    /** Emit active download count so the UI can show a badge. */
    async _emitActiveCount() {
        try {
            const all = await db.getDownloads();
            const active = all.filter(d => d.status === 'downloading' || d.status === 'queued').length;
            document.dispatchEvent(new CustomEvent('downloadCountChanged', { detail: { active } }));
        } catch (_) {}
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
        const plugin = this._getCDNPlugin();

        await db.updateDownload(item.id, { progress: 2 });

        try {
            // 1. Resolve stream URL
            const streamData = await SearchCoordinator.getAnimeStreamUrl(episodeId, source);
            if (!streamData || !streamData.url) throw new Error('Could not resolve stream URL');

            let m3u8Url = null;

            if (streamData.type === 'iframe' || streamData.type === 'embed') {
                // Encrypted sources — resolve via embed page (also sets up download WebView)
                if (!plugin) throw new Error('CDN download plugin not available on this device');
                console.log('[DL] Sources encrypted — resolving via embed page...');
                await db.updateDownload(item.id, { progress: 3 });
                const result = await plugin.resolveStream({ embedUrl: streamData.url });
                m3u8Url = result?.url;
                if (!m3u8Url) throw new Error('Could not extract stream from embed page');
                console.log('[DL] Resolved m3u8:', m3u8Url.substring(0, 60));
                // Plugin WebView is now kept alive for fetchText/fetchSegment
            } else if (streamData.url.includes('.m3u8') || streamData.type === 'hls') {
                m3u8Url = streamData.url;
                // Need a WebView for segment downloads
                if (plugin) {
                    try { await plugin.init({ originUrl: 'https://megacloud.blog/' }); } catch (_) {}
                }
            } else {
                throw new Error('Unsupported stream type: ' + streamData.type);
            }

            await db.updateDownload(item.id, { progress: 5 });

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
                            if (bw < bestBw) { bestBw = bw; bestLine = nextLine; }
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

            // 4. Parse media playlist for segment URLs
            const segments = [];
            for (const line of mediaText.split('\n')) {
                const trimmed = line.trim();
                if (trimmed && !trimmed.startsWith('#')) {
                    segments.push(new URL(trimmed, mediaUrl).href);
                }
            }
            if (segments.length === 0) throw new Error('No video segments found');
            console.log(`[DL] Found ${segments.length} segments`);

            // 5. Download segments
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
                    console.warn(`[DL] seg ${i + 1}/${segments.length} failed:`, e.message);
                    if (failedCount > 3 && chunks.length === 0) {
                        throw new Error(`CDN blocked (${e.message}). Try later.`);
                    }
                }
                if (i < segments.length - 1) await new Promise(r => setTimeout(r, 50));
                const progress = 10 + Math.round(((i + 1) / segments.length) * 80);
                await db.updateDownload(item.id, { progress });
            }

            if (chunks.length === 0) throw new Error('No segments downloaded');

            // 6. Concatenate into single blob
            const blob = new Blob(chunks, { type: 'video/mp2t' });
            console.log(`[DL] Video: ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
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
        } finally {
            // Always clean up the CDN plugin WebView
            if (plugin) {
                try { await plugin.destroy(); } catch (_) {}
            }
        }
    }

    // ── Helpers ──

    _getCDNPlugin() {
        if (!this._cdnPlugin) {
            this._cdnPlugin = window.Capacitor?.Plugins?.CDNDownloader || null;
        }
        return this._cdnPlugin;
    }

    /** Fetch text via CDN plugin WebView, fallback to patched fetch */
    async _fetchText(url) {
        const plugin = this._getCDNPlugin();
        if (plugin) {
            try {
                const result = await plugin.fetchText({ url });
                if (result?.text) return result.text;
            } catch (e) {
                console.warn('[DL] CDN fetchText failed:', e.message || e);
            }
        }
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
        return resp.text();
    }

    /** Fetch binary segment via CDN plugin WebView with retry */
    async _fetchSegment(url, retries = 2) {
        const plugin = this._getCDNPlugin();
        for (let attempt = 0; attempt <= retries; attempt++) {
            if (plugin) {
                try {
                    const result = await plugin.fetchSegment({ url });
                    if (result?.data) return this._dataUrlToArrayBuffer(result.data);
                } catch (e) {
                    if (attempt >= retries) throw new Error(e.message || e);
                    await new Promise(r => setTimeout(r, 500 + attempt * 500));
                    continue;
                }
            }
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

    _dataUrlToArrayBuffer(dataUrl) {
        const base64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        return bytes.buffer;
    }

    /** Manga page download — uses patched fetch directly (no CDN needed) */
    async _fetchAsDataUrl(url) {
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

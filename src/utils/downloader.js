/**
 * DownloadManager — processes queued downloads in IndexedDB.
 *
 * Manga chapters: fetches every page image, converts to data-URL, stores in
 * a "downloadedPages" field on the download record so the reader can show
 * them offline.
 *
 * Anime episodes: resolves HLS stream → parses m3u8 → downloads all .ts
 * segments → concatenates into a single video blob → stores as base64 data
 * URL in IndexedDB for offline playback.
 *
 * Runs a processing loop that picks the next "queued" item and works on it.
 * Exposes start/stop and per-item cancel.
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
            // Master playlist — pick lowest bandwidth for smaller download
            const lines = m3u8Text.split('\n');
            let bestLine = null;
            let bestBw = Infinity;
            for (let i = 0; i < lines.length; i++) {
                const match = lines[i].match(/#EXT-X-STREAM-INF.*BANDWIDTH=(\d+)/);
                if (match) {
                    const bw = parseInt(match[1], 10);
                    const nextLine = lines[i + 1]?.trim();
                    // Prefer 720p-ish (1-3M bandwidth) but fall back to lowest
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

        // 5. Download all segments with retry logic
        const chunks = [];
        let totalBytes = 0;
        let failedCount = 0;
        for (let i = 0; i < segments.length; i++) {
            if (this._aborted) throw new Error('Cancelled');

            try {
                const buf = await this._fetchSegment(segments[i]);
                chunks.push(buf);
                totalBytes += buf.byteLength;
            } catch (e) {
                failedCount++;
                console.warn(`[DL] segment ${i + 1}/${segments.length} failed:`, e.message);
                // If too many fail in a row, abort early
                if (failedCount > 5 && chunks.length === 0) {
                    throw new Error(`CDN blocked downloads (${e.message}). Try again later.`);
                }
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

    /** Standard headers that mimic a real browser (required by CDNs like crimsonstorm) */
    _streamHeaders() {
        return {
            'Referer': 'https://megacloud.blog/',
            'Origin': 'https://megacloud.blog',
            'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
            'Accept': '*/*',
            'Accept-Language': 'en-US,en;q=0.9',
        };
    }

    async _fetchText(url) {
        const resp = await fetch(url, { headers: this._streamHeaders() });
        if (!resp.ok) throw new Error(`HTTP ${resp.status} fetching ${url}`);
        return resp.text();
    }

    /** Fetch a segment with retry (CDNs sometimes 403 on first try) */
    async _fetchSegment(url, retries = 2) {
        for (let attempt = 0; attempt <= retries; attempt++) {
            try {
                const resp = await fetch(url, { headers: this._streamHeaders() });
                if (resp.ok) return resp.arrayBuffer();
                if (resp.status === 403 && attempt < retries) {
                    // Wait before retry — CDN rate limiting
                    await new Promise(r => setTimeout(r, 500 + attempt * 500));
                    continue;
                }
                throw new Error(`HTTP ${resp.status}`);
            } catch (e) {
                if (attempt >= retries) throw e;
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }

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

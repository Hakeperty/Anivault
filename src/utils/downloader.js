/**
 * DownloadManager — processes queued downloads in IndexedDB.
 *
 * Manga chapters: fetches every page image, converts to data-URL, stores in
 * a "downloadedPages" field on the download record so the reader can show
 * them offline.
 *
 * Anime episodes: resolves the stream / embed URL via the coordinator and
 * caches the resolved URL so the player can use it without re-scraping.
 *
 * Runs a processing loop that picks the next "queued" item and works on it.
 * Exposes start/stop and per-item cancel.
 */

import { db } from '../db/indexeddb.js';
import { SearchCoordinator } from '../scrapers/coordinator.js';

const MAX_CONCURRENT = 1; // one download at a time to avoid hammering sources
const POLL_INTERVAL = 3000; // ms between queue checks when idle

class _DownloadManager {
    constructor() {
        this._running = false;
        this._timer = null;
        this._currentId = null;   // id of download being processed
        this._aborted = false;    // flag to cancel current item
    }

    /** Start the background processing loop (call once on app launch). */
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

    /** Cancel a specific queued or in-progress download. */
    async cancel(downloadId) {
        if (this._currentId === downloadId) {
            this._aborted = true; // the processing loop will pick this up
        }
        try {
            await db.updateDownload(downloadId, { status: 'failed', error: 'Cancelled' });
        } catch (_) {}
    }

    /** Retry a failed download by re-queuing it. */
    async retry(downloadId) {
        try {
            await db.updateDownload(downloadId, { status: 'queued', progress: 0, error: null });
        } catch (_) {}
    }

    // ── internal loop ──

    async _tick() {
        if (!this._running) return;
        try {
            const item = await this._nextQueued();
            if (item) {
                await this._process(item);
                // Immediately check for more work
                if (this._running) { this._timer = setTimeout(() => this._tick(), 200); }
                return;
            }
        } catch (err) {
            console.error('[DL] tick error', err);
        }
        // Nothing to do — poll again later
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

            const pageUrl = pages[i];
            try {
                const dataUrl = await this._fetchImageAsDataUrl(pageUrl);
                downloadedPages.push(dataUrl);
            } catch (e) {
                console.warn(`[DL] page ${i + 1} failed:`, e.message);
                downloadedPages.push(null); // placeholder so indices stay correct
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

    async _fetchImageAsDataUrl(url) {
        // Use fetch() which CapacitorHttp patches to go through native HTTP (avoids CORS).
        // CapacitorHttp.get doesn't support responseType 'blob', so fetch is the correct approach.
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

    // ── Anime: resolve & cache stream URL ──

    async _downloadAnime(item) {
        // Anime streams (HLS/iframe) cannot be downloaded for offline playback
        throw new Error('Anime offline download is not supported. Episodes are streamed directly.');
    }
}

export const DownloadManager = new _DownloadManager();

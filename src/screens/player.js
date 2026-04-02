/**
 * Player Screen - Video player for anime episodes with HLS.js
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';
import { SearchCoordinator } from '../scrapers/coordinator.js';

const HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.min.js';

export class PlayerScreen {
    constructor(libraryItem, episode) {
        this.libraryItem = libraryItem;
        this.episode = episode;
        this.hls = null;
        this.progressInterval = null;
        this.controlsTimeout = null;
        this.controlsVisible = true;
    }

    async render() {
        const epNum = this.episode.number ?? this.episode.episode ?? '';
        const title = this.libraryItem?.title || 'Unknown';

        return `
            <div class="screen player-screen fullscreen">
                <!-- Loading overlay -->
                <div id="player-loading" class="player-overlay">
                    <div class="spinner" style="width:40px;height:40px;border-width:4px"></div>
                    <p style="margin-top:12px">Loading stream…</p>
                </div>

                <!-- Error overlay -->
                <div id="player-error" class="player-overlay" style="display:none">
                    <p id="player-error-msg" style="color:var(--error);margin-bottom:16px">Stream failed to load.</p>
                    <button class="btn btn-primary btn-small" id="player-retry-btn">Retry</button>
                    <button class="btn btn-secondary btn-small" id="player-error-back-btn" style="margin-top:8px">Go Back</button>
                </div>

                <!-- Video element -->
                <video id="player-video" playsinline></video>

                <!-- Custom controls -->
                <div id="player-controls" class="player-controls-bar">
                    <div class="player-controls-top">
                        <button class="btn btn-secondary btn-small" id="player-back-btn">← Back</button>
                        <span class="player-title">${this._esc(title)}${epNum ? ` — Ep ${epNum}` : ''}</span>
                    </div>
                    <div class="player-controls-center" id="player-center">
                        <button class="player-ctrl-btn" id="player-rw">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"/></svg>
                        </button>
                        <button class="player-ctrl-btn player-ctrl-play" id="player-playpause">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                        </button>
                        <button class="player-ctrl-btn" id="player-ff">
                            <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24"><path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"/></svg>
                        </button>
                    </div>
                    <div class="player-controls-bottom">
                        <span id="player-time-current" class="player-time">0:00</span>
                        <input type="range" id="player-seekbar" class="player-seekbar" min="0" max="1000" value="0">
                        <span id="player-time-duration" class="player-time">0:00</span>
                        <button class="player-ctrl-btn" id="player-fullscreen-btn" title="Fullscreen">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        this._injectStyles();
        this._setupBackButtons();
        await this._initPlayer();
    }

    /* ── Back / cleanup ── */

    _goBack() {
        this._cleanup();
        document.getElementById('bottom-nav').style.display = 'flex';
        document.dispatchEvent(new Event('goBack'));
    }

    _setupBackButtons() {
        document.getElementById('player-back-btn')?.addEventListener('click', () => this._goBack());
        document.getElementById('player-error-back-btn')?.addEventListener('click', () => this._goBack());
        document.getElementById('player-retry-btn')?.addEventListener('click', () => this._initPlayer());
    }

    _cleanup() {
        this._saveProgress(true);
        if (this.progressInterval) clearInterval(this.progressInterval);
        if (this.controlsTimeout) clearTimeout(this.controlsTimeout);
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
    }

    /* ── Player init ── */

    async _initPlayer() {
        const loadingEl = document.getElementById('player-loading');
        const errorEl = document.getElementById('player-error');
        const video = document.getElementById('player-video');
        if (!video) return;

        loadingEl.style.display = '';
        errorEl.style.display = 'none';

        try {
            const streamData = await SearchCoordinator.getAnimeStreamUrl(this.episode.url);
            if (!streamData || !streamData.url) throw new Error('No stream URL returned');

            const streamUrl = streamData.url;
            await this._loadHls();

            if (window.Hls && window.Hls.isSupported()) {
                this.hls = new window.Hls({
                    maxBufferLength: 30,
                    maxMaxBufferLength: 60,
                });
                this.hls.loadSource(streamUrl);
                this.hls.attachMedia(video);

                this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                    loadingEl.style.display = 'none';
                    this._restoreProgress(video);
                    video.play().catch(() => {});
                });

                this.hls.on(window.Hls.Events.ERROR, (_e, data) => {
                    if (data.fatal) {
                        console.error('HLS fatal error', data);
                        if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR) {
                            this.hls.startLoad();
                        } else if (data.type === window.Hls.ErrorTypes.MEDIA_ERROR) {
                            this.hls.recoverMediaError();
                        } else {
                            this._showError('Playback error. Try again.');
                        }
                    }
                });
            } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                // Safari native HLS
                video.src = streamUrl;
                video.addEventListener('loadedmetadata', () => {
                    loadingEl.style.display = 'none';
                    this._restoreProgress(video);
                    video.play().catch(() => {});
                }, { once: true });
            } else {
                throw new Error('HLS not supported in this browser');
            }

            this._setupControls(video);
            this._startProgressSaving(video);
        } catch (err) {
            console.error('Player init failed:', err);
            this._showError(err.message || 'Failed to load stream.');
        }
    }

    _showError(msg) {
        const loadingEl = document.getElementById('player-loading');
        const errorEl = document.getElementById('player-error');
        const errorMsg = document.getElementById('player-error-msg');
        if (loadingEl) loadingEl.style.display = 'none';
        if (errorMsg) errorMsg.textContent = msg;
        if (errorEl) errorEl.style.display = '';
    }

    /* ── HLS loader ── */

    _loadHls() {
        if (window.Hls) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = HLS_CDN;
            script.onload = resolve;
            script.onerror = () => reject(new Error('Failed to load HLS.js'));
            document.head.appendChild(script);
        });
    }

    /* ── Custom controls ── */

    _setupControls(video) {
        const playBtn = document.getElementById('player-playpause');
        const seekbar = document.getElementById('player-seekbar');
        const curTime = document.getElementById('player-time-current');
        const durTime = document.getElementById('player-time-duration');
        const rwBtn = document.getElementById('player-rw');
        const ffBtn = document.getElementById('player-ff');
        const fsBtn = document.getElementById('player-fullscreen-btn');
        const controlsBar = document.getElementById('player-controls');
        const playerScreen = video.closest('.player-screen');

        // Play / Pause
        playBtn?.addEventListener('click', () => {
            if (video.paused) { video.play().catch(() => {}); }
            else { video.pause(); }
        });

        video.addEventListener('play', () => { if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>'; });
        video.addEventListener('pause', () => { if (playBtn) playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32"><polygon points="5 3 19 12 5 21 5 3"/></svg>'; });

        // Seek bar
        let seeking = false;
        seekbar?.addEventListener('input', () => {
            seeking = true;
            const pct = seekbar.value / 1000;
            if (curTime && video.duration) curTime.textContent = this._fmtTime(pct * video.duration);
        });
        seekbar?.addEventListener('change', () => {
            const pct = seekbar.value / 1000;
            if (video.duration) video.currentTime = pct * video.duration;
            seeking = false;
        });

        video.addEventListener('timeupdate', () => {
            if (seeking) return;
            if (curTime) curTime.textContent = this._fmtTime(video.currentTime);
            if (durTime && video.duration) durTime.textContent = this._fmtTime(video.duration);
            if (seekbar && video.duration) seekbar.value = Math.floor((video.currentTime / video.duration) * 1000);
        });

        // Skip ±10s
        rwBtn?.addEventListener('click', () => { video.currentTime = Math.max(0, video.currentTime - 10); });
        ffBtn?.addEventListener('click', () => { video.currentTime = Math.min(video.duration || 0, video.currentTime + 10); });

        // Fullscreen
        fsBtn?.addEventListener('click', () => {
            const el = playerScreen || document.documentElement;
            if (!document.fullscreenElement) {
                (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen)?.call(el);
            } else {
                (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen)?.call(document);
            }
        });

        // Auto-hide controls
        const showControls = () => {
            if (controlsBar) controlsBar.classList.remove('player-controls-hidden');
            this.controlsVisible = true;
            if (this.controlsTimeout) clearTimeout(this.controlsTimeout);
            if (!video.paused) {
                this.controlsTimeout = setTimeout(() => {
                    if (controlsBar) controlsBar.classList.add('player-controls-hidden');
                    this.controlsVisible = false;
                }, 3000);
            }
        };

        playerScreen?.addEventListener('click', (e) => {
            if (e.target.closest('.player-controls-bar') || e.target.closest('button')) return;
            if (this.controlsVisible) {
                if (controlsBar) controlsBar.classList.add('player-controls-hidden');
                this.controlsVisible = false;
            } else {
                showControls();
            }
        });
        playerScreen?.addEventListener('mousemove', showControls);
        playerScreen?.addEventListener('touchstart', showControls, { passive: true });
    }

    /* ── Progress save / restore ── */

    _startProgressSaving(video) {
        this.progressInterval = setInterval(() => this._saveProgress(false, video), 10000);
        video.addEventListener('ended', () => this._saveProgress(true, video));
    }

    async _saveProgress(force = false, video = null) {
        video = video || document.getElementById('player-video');
        if (!video || !video.duration) return;

        const itemId = this.episode.itemId || this.libraryItem?.id;
        if (!itemId) return;

        const epId = this.episode.id || this.episode.url || '';
        const epNum = this.episode.number ?? this.episode.episode ?? 0;
        const completed = video.ended || (video.duration > 0 && video.currentTime / video.duration > 0.9);
        const watchedSeconds = Math.floor(video.currentTime);

        try {
            await db.saveProgress(itemId, epId, epNum, completed, watchedSeconds);
        } catch (err) {
            console.error('Failed to save progress:', err);
        }
    }

    async _restoreProgress(video) {
        const itemId = this.episode.itemId || this.libraryItem?.id;
        const epId = this.episode.id || this.episode.url || '';
        if (!itemId) return;

        try {
            const progress = await db.getProgressForEpisode(itemId, epId);
            if (progress && progress.watchedSeconds > 0 && !progress.completed) {
                video.currentTime = progress.watchedSeconds;
                showToast(`Resuming at ${this._fmtTime(progress.watchedSeconds)}`, 'info');
            }
        } catch {
            // No saved progress
        }
    }

    /* ── Helpers ── */

    _fmtTime(secs) {
        if (!secs || !isFinite(secs)) return '0:00';
        const s = Math.floor(secs);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
        const ss = String(sec).padStart(2, '0');
        return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
    }

    _esc(str) {
        const d = document.createElement('div');
        d.textContent = str || '';
        return d.innerHTML;
    }

    /* ── Scoped styles injected once ── */

    _injectStyles() {
        if (document.getElementById('player-screen-styles')) return;
        const style = document.createElement('style');
        style.id = 'player-screen-styles';
        style.textContent = `
            .player-screen { position:relative; background:#000; }
            .player-screen video {
                width:100%; height:100%; object-fit:contain;
                position:absolute; top:0; left:0;
            }
            .player-overlay {
                position:absolute; inset:0; z-index:20;
                display:flex; flex-direction:column;
                align-items:center; justify-content:center;
                background:rgba(0,0,0,.85); color:#fff;
            }
            .player-controls-bar {
                position:absolute; inset:0; z-index:10;
                display:flex; flex-direction:column;
                justify-content:space-between;
                background:linear-gradient(to bottom,rgba(0,0,0,.7) 0%,transparent 30%,transparent 70%,rgba(0,0,0,.7) 100%);
                padding:12px 16px; transition:opacity .3s;
            }
            .player-controls-hidden { opacity:0; pointer-events:none; }
            .player-controls-top { display:flex; align-items:center; gap:12px; }
            .player-title {
                font-size:14px; font-weight:600; color:#fff;
                white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
            }
            .player-controls-center {
                display:flex; align-items:center; justify-content:center; gap:32px;
            }
            .player-ctrl-btn {
                background:none; border:none; color:#fff;
                font-size:24px; cursor:pointer; padding:8px;
                border-radius:50%; transition:background .2s;
            }
            .player-ctrl-btn:active { background:rgba(255,255,255,.15); }
            .player-ctrl-play { font-size:36px; }
            .player-controls-bottom {
                display:flex; align-items:center; gap:8px;
            }
            .player-time { font-size:12px; color:#ccc; min-width:40px; text-align:center; }
            .player-seekbar {
                flex:1; height:4px; -webkit-appearance:none; appearance:none;
                background:rgba(255,255,255,.25); border-radius:2px; outline:none;
                cursor:pointer;
            }
            .player-seekbar::-webkit-slider-thumb {
                -webkit-appearance:none; width:14px; height:14px;
                border-radius:50%; background:var(--accent-primary,#FF6B35);
                cursor:pointer;
            }
        `;
        document.head.appendChild(style);
    }
}

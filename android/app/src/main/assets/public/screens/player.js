/**
 * Player Screen - Video player for anime episodes with HLS.js
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';
import { SearchCoordinator } from '../scrapers/coordinator.js';
import { DownloadManager } from '../utils/downloader.js';

const HLS_CDN = 'https://cdn.jsdelivr.net/npm/hls.js@1.4.12/dist/hls.min.js';

export class PlayerScreen {
    constructor(libraryItem, episode, allEpisodes = []) {
        this.libraryItem = libraryItem;
        this.episode = episode;
        this.allEpisodes = allEpisodes; // for auto-play next
        this.hls = null;
        this.progressInterval = null;
        this.controlsTimeout = null;
        this.controlsVisible = true;
        this.playbackRate = parseFloat(localStorage.getItem('anivault-playback-rate')) || 1;
        this._skipIntroDismissed = false;
        this._autoPlayTimer = null;
        this._audioType = localStorage.getItem('anivault-audio-pref') || 'sub';
        this._hasAudioToggle = true; // default visible until stream info says otherwise
        this._isLandscape = false;
    }

    async render() {
        const epNum = this.episode.number ?? this.episode.episode ?? '';
        const title = this.libraryItem?.title || 'Unknown';

        return `
            <div id="player-screen" class="screen player-screen fullscreen">
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

                <!-- Iframe player (for embed streams) -->
                <iframe id="player-iframe" style="display:none;position:absolute;top:0;left:0;width:100%;height:100%;border:none;background:#000;z-index:1;" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen"></iframe>

                <!-- Iframe floating controls (always visible in iframe mode) -->
                <button id="iframe-back-btn" class="iframe-float-back" style="display:none;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" width="22" height="22"><polyline points="15 18 9 12 15 6"/></svg>
                </button>
                <button id="iframe-audio-toggle" class="iframe-float-audio" style="display:none;">${this._audioType === 'dub' ? 'DUB' : 'SUB'}</button>
                <button id="iframe-rotate-btn" class="iframe-float-rotate" style="display:none;">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="20" height="20"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                </button>

                <!-- Video element -->
                <video id="player-video" playsinline></video>

                <!-- Skip intro button (shown 0:00–1:30) -->
                <button id="player-skip-intro" class="player-skip-intro" style="display:none">Skip Intro ▸</button>

                <!-- Auto-play next overlay -->
                <div id="player-autoplay" class="player-overlay" style="display:none">
                    <p style="font-size:16px;margin-bottom:8px">Next episode in <span id="autoplay-countdown">5</span>s</p>
                    <button class="btn btn-primary btn-small" id="autoplay-now">Play Now</button>
                    <button class="btn btn-secondary btn-small" id="autoplay-cancel" style="margin-top:8px">Cancel</button>
                </div>

                <!-- Custom controls -->
                <div id="player-controls" class="player-controls-bar">
                    <div class="player-controls-top">
                        <button class="btn btn-secondary btn-small" id="player-back-btn">← Back</button>
                        <span class="player-title">${this._esc(title)}${epNum ? ` — Ep ${epNum}` : ''}</span>
                        <button class="player-ctrl-btn" id="player-audio-toggle" title="Sub/Dub" style="margin-left:auto;font-size:12px;min-width:44px;background:rgba(255,255,255,.15);border-radius:4px;">${this._audioType === 'dub' ? 'DUB' : 'SUB'}</button>
                        <button class="player-ctrl-btn" id="player-speed-btn" title="Playback Speed" style="font-size:13px;min-width:44px;">1x</button>
                        <button class="player-ctrl-btn" id="player-rotate-btn" title="Rotate" style="font-size:13px;">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M1 4v6h6"/><path d="M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10M23 14l-4.64 4.36A9 9 0 0 1 3.51 15"/></svg>
                        </button>
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
        this._setupAudioToggle();
        this._setupRotateButton();
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
        document.getElementById('iframe-back-btn')?.addEventListener('click', () => this._goBack());
    }

    _cleanup() {
        this._saveProgress(true);
        if (this.progressInterval) clearInterval(this.progressInterval);
        if (this._progressInterval) clearInterval(this._progressInterval);
        if (this.controlsTimeout) clearTimeout(this.controlsTimeout);
        if (this._autoPlayTimer) clearInterval(this._autoPlayTimer);
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }
        // Clean up iframe
        const iframe = document.getElementById('player-iframe');
        if (iframe) iframe.src = 'about:blank';
        // Reset orientation
        if (this._isLandscape) {
            this._isLandscape = false;
            document.getElementById('player-screen')?.classList.remove('player-landscape');
            try { screen.orientation?.unlock?.(); } catch {}
        }
    }

    deactivate() {
        this._cleanup();
    }

    /* ── Player init ── */

    async _initPlayer() {
        const loadingEl = document.getElementById('player-loading');
        const errorEl = document.getElementById('player-error');
        const video = document.getElementById('player-video');
        const iframe = document.getElementById('player-iframe');
        if (!video) return;

        loadingEl.style.display = '';
        errorEl.style.display = 'none';

        // Safety timeout — 40s total for all strategies
        const loadTimeout = setTimeout(() => {
            if (loadingEl.style.display !== 'none') {
                this._showError('Stream is taking too long. Tap Retry.');
            }
        }, 40000);

        try {
            const loadingText = loadingEl.querySelector('p');
            if (loadingText) loadingText.textContent = 'Finding stream…';

            // Check for offline download first
            const offlineData = await this._checkOfflineDownload();
            if (offlineData) {
                clearTimeout(loadTimeout);
                if (loadingText) loadingText.textContent = 'Loading offline video…';
                video.src = offlineData;
                video.addEventListener('loadedmetadata', () => {
                    loadingEl.style.display = 'none';
                    this._restoreProgress(video);
                    video.play().catch(() => {});
                }, { once: true });
                video.addEventListener('error', () => {
                    loadingEl.style.display = 'none';
                    showToast('Offline video corrupted. Streaming instead…', 'error');
                    this._initPlayerOnline(video, iframe, loadingEl, loadingText);
                }, { once: true });
                this._setupControls(video);
                this._startProgressSaving(video);
                return;
            }

            await this._initPlayerOnline(video, iframe, loadingEl, loadingText);
        } catch (err) {
            clearTimeout(loadTimeout);
            console.error('Player init failed:', err);
            this._showError(err.message || 'Failed to load stream.');
        }
    }

    /** Check if this episode has been downloaded for offline playback */
    async _checkOfflineDownload() {
        try {
            const epNum = this.episode.number ?? this.episode.episode ?? '';
            const token = `ep-${epNum}`;
            const libraryId = this.libraryItem?.id;
            if (!libraryId || !epNum) return null;

            const dl = await DownloadManager.getDownloadForEpisode(libraryId, token);
            if (dl && dl.videoDataUrl) {
                console.log('[Player] Found offline download, using cached video');
                return dl.videoDataUrl;
            }
        } catch (e) {
            console.warn('[Player] Offline check failed:', e.message);
        }
        return null;
    }

    /** Online streaming init — prefers embed player for reliability */
    async _initPlayerOnline(video, iframe, loadingEl, loadingText) {
        const loadTimeout = setTimeout(() => {
            if (loadingEl.style.display !== 'none') {
                this._showError('Stream is taking too long. Tap Retry.');
            }
        }, 40000);

        try {
            if (loadingText) loadingText.textContent = 'Finding stream…';

            const streamData = await SearchCoordinator.getAnimeStreamUrl(
                this.episode.episodeId || this.episode.id || this.episode.url,
                this.episode.source || this.libraryItem?.source || 'aniwatch',
                this._audioType
            );
            if (!streamData || !streamData.url) throw new Error('No stream URL found');

            // Update sub/dub button visibility based on what's available
            this._updateAudioToggleVisibility(streamData.availableTypes || []);

            // Strategy 1 (preferred): Iframe embed — most reliable, MegaCloud handles decryption
            const embedUrl = streamData.embedUrl || (streamData.type === 'iframe' ? streamData.url : null);
            if (embedUrl && iframe) {
                clearTimeout(loadTimeout);
                this._showIframeEmbed(video, iframe, embedUrl, loadingEl);
                return;
            }

            // Strategy 2: HLS.js with custom fetch loader
            if (streamData.type === 'hls' || streamData.url.includes('.m3u8')) {
                const streamUrl = streamData.url;
                if (loadingText) loadingText.textContent = 'Loading video…';
                await this._loadHls();

                if (window.Hls && window.Hls.isSupported()) {
                    if (loadingText) loadingText.textContent = 'Starting playback…';

                    const hlsOk = await new Promise((resolve) => {
                        this.hls = new window.Hls({
                            maxBufferLength: 15,
                            maxMaxBufferLength: 30,
                            maxBufferSize: 30 * 1000 * 1000,
                            startFragPrefetch: true,
                            enableWorker: false,
                            lowLatencyMode: false,
                            backBufferLength: 30,
                            loader: this._createFetchLoader(),
                        });
                        this.hls.loadSource(streamUrl);
                        this.hls.attachMedia(video);

                        const hlsTimer = setTimeout(() => resolve(false), 20000);
                        let networkRetried = false;

                        this.hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
                            clearTimeout(hlsTimer);
                            resolve(true);
                        });

                        this.hls.on(window.Hls.Events.ERROR, (_e, data) => {
                            if (data.fatal) {
                                console.error('HLS.js error:', data.type, data.details);
                                if (data.type === window.Hls.ErrorTypes.NETWORK_ERROR && !networkRetried) {
                                    networkRetried = true;
                                    this.hls.startLoad();
                                } else {
                                    clearTimeout(hlsTimer);
                                    resolve(false);
                                }
                            }
                        });
                    });

                    if (hlsOk) {
                        clearTimeout(loadTimeout);
                        loadingEl.style.display = 'none';
                        this._restoreProgress(video);
                        video.play().catch(() => {});
                        this._setupControls(video);
                        this._startProgressSaving(video);
                        return;
                    }

                    this.hls.destroy();
                    this.hls = null;
                }
            }

            // Strategy 3: Direct src (mp4 or other)
            if (streamData.type === 'mp4' || !streamData.url.includes('.m3u8')) {
                video.src = streamData.url;
                video.addEventListener('loadedmetadata', () => {
                    clearTimeout(loadTimeout);
                    loadingEl.style.display = 'none';
                    this._restoreProgress(video);
                    video.play().catch(() => {});
                }, { once: true });
                video.addEventListener('error', () => {
                    clearTimeout(loadTimeout);
                    this._showError('Cannot play this stream. Tap Retry.');
                }, { once: true });

                this._setupControls(video);
                this._startProgressSaving(video);
                return;
            }

            clearTimeout(loadTimeout);
            this._showError('No compatible player for this stream.');
        } catch (err) {
            clearTimeout(loadTimeout);
            console.error('Player init failed:', err);
            this._showError(err.message || 'Failed to load stream.');
        }
    }

    /** Show/hide sub/dub toggle based on available audio types */
    _updateAudioToggleVisibility(availableTypes) {
        const hasSub = availableTypes.includes('sub') || availableTypes.includes('raw');
        const hasDub = availableTypes.includes('dub');
        const showToggle = hasSub && hasDub;

        const hlsBtn = document.getElementById('player-audio-toggle');
        const iframeBtn = document.getElementById('iframe-audio-toggle');
        if (hlsBtn) hlsBtn.style.display = showToggle ? '' : 'none';
        // iframe button visibility is set in _showIframeEmbed; store flag
        this._hasAudioToggle = showToggle;
    }

    /**
     * Custom HLS.js loader using fetch API (patched by CapacitorHttp for CORS bypass).
     * The default XHR loader fails because Referer is a forbidden header in browsers.
     * CapacitorHttp patches window.fetch() to go through native Android HTTP — no CORS.
     */
    _createFetchLoader() {
        return class {
            constructor(config) {
                this._controller = null;
            }

            load(context, config, callbacks) {
                this._controller = new AbortController();
                const { url, responseType } = context;

                const timeout = setTimeout(() => {
                    this._controller?.abort();
                    callbacks.onTimeout(
                        { trequest: performance.now(), retry: 0 },
                        context, null
                    );
                }, config.timeout || 15000);

                fetch(url, {
                    signal: this._controller.signal,
                    headers: {
                        'Referer': 'https://megacloud.blog/',
                        'Origin': 'https://megacloud.blog',
                        'User-Agent': 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
                    }
                })
                .then(async (resp) => {
                    clearTimeout(timeout);
                    if (!resp.ok) {
                        callbacks.onError(
                            { code: resp.status, text: `HTTP ${resp.status}` },
                            context, null
                        );
                        return;
                    }
                    const data = responseType === 'arraybuffer'
                        ? await resp.arrayBuffer()
                        : await resp.text();
                    const len = data.byteLength || data.length || 0;
                    callbacks.onSuccess(
                        { url: resp.url || url, data },
                        { trequest: performance.now(), tfirst: performance.now(),
                          tload: performance.now(), loaded: len, total: len, retry: 0 },
                        context, null
                    );
                })
                .catch((err) => {
                    clearTimeout(timeout);
                    if (err.name === 'AbortError') return;
                    callbacks.onError(
                        { code: 0, text: err.message || 'Fetch failed' },
                        context, null
                    );
                });
            }

            abort() { this._controller?.abort(); }
            destroy() { this.abort(); }
        };
    }

    /**
     * Show iframe embed player (used for direct iframe streams and as HLS fallback).
     */
    _showIframeEmbed(video, iframe, embedUrl, loadingEl) {
        video.style.display = 'none';
        document.getElementById('player-controls')?.style.setProperty('display', 'none');
        document.getElementById('player-skip-intro')?.style.setProperty('display', 'none');

        iframe.style.display = 'block';
        const backBtn = document.getElementById('iframe-back-btn');
        if (backBtn) backBtn.style.display = 'flex';
        // Only show audio toggle if both sub and dub are available
        const audioBtn = document.getElementById('iframe-audio-toggle');
        if (audioBtn) audioBtn.style.display = this._hasAudioToggle ? 'block' : 'none';
        // Show rotate button
        const rotateBtn = document.getElementById('iframe-rotate-btn');
        if (rotateBtn) rotateBtn.style.display = 'flex';
        iframe.src = embedUrl;

        setTimeout(() => { loadingEl.style.display = 'none'; }, 3000);
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

        // Speed, skip intro, autoplay hooks
        this._setupSpeedButton(video);
        this._setupSkipIntro(video);
    }

    /* ── Progress save / restore ── */

    _startProgressSaving(video) {
        this.progressInterval = setInterval(() => this._saveProgress(false, video), 10000);
        video.addEventListener('ended', () => {
            this._saveProgress(true, video);
            this._showAutoPlayNext();
        });
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
        // If switching audio in-place, use the saved position
        if (this._pendingSeek && this._pendingSeek > 0) {
            video.currentTime = this._pendingSeek;
            this._pendingSeek = null;
            return;
        }

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

    /* ── Playback speed ── */

    _setupSpeedButton(video) {
        const speeds = [0.5, 0.75, 1, 1.25, 1.5, 2];
        const btn = document.getElementById('player-speed-btn');
        if (!btn) return;
        video.playbackRate = this.playbackRate;
        btn.textContent = `${this.playbackRate}x`;
        btn.addEventListener('click', () => {
            const idx = speeds.indexOf(this.playbackRate);
            this.playbackRate = speeds[(idx + 1) % speeds.length];
            video.playbackRate = this.playbackRate;
            btn.textContent = `${this.playbackRate}x`;
            localStorage.setItem('anivault-playback-rate', this.playbackRate);
        });
    }

    /* ── Sub/Dub audio toggle ── */

    _setupAudioToggle() {
        const hlsBtn = document.getElementById('player-audio-toggle');
        const iframeBtn = document.getElementById('iframe-audio-toggle');
        const toggle = () => this._switchAudioType();
        hlsBtn?.addEventListener('click', toggle);
        iframeBtn?.addEventListener('click', toggle);
    }

    _switchAudioType() {
        const newType = this._audioType === 'dub' ? 'sub' : 'dub';
        this._audioType = newType;
        localStorage.setItem('anivault-audio-pref', newType);

        // Update button labels immediately
        const hlsBtn = document.getElementById('player-audio-toggle');
        const iframeBtn = document.getElementById('iframe-audio-toggle');
        const label = newType.toUpperCase();
        if (hlsBtn) hlsBtn.textContent = label;
        if (iframeBtn) iframeBtn.textContent = label;
        showToast(`Switching to ${label}...`, 'info');

        // Full cleanup before re-init
        const video = document.getElementById('player-video');
        const iframe = document.getElementById('player-iframe');
        const loadingEl = document.getElementById('player-loading');
        const loadingText = loadingEl?.querySelector('p');

        // Save current position (from video or just use 0 for iframe)
        const savedTime = (video && !isNaN(video.currentTime)) ? video.currentTime : 0;

        // Stop progress saving interval
        if (this._progressInterval) {
            clearInterval(this._progressInterval);
            this._progressInterval = null;
        }

        // Destroy HLS
        if (this.hls) {
            this.hls.destroy();
            this.hls = null;
        }

        // Reset video
        if (video) {
            video.pause();
            video.removeAttribute('src');
            video.load();
            video.style.display = '';
        }

        // Reset iframe
        if (iframe) {
            iframe.src = 'about:blank';
            iframe.style.display = 'none';
        }

        // Hide all floating buttons (they'll be re-shown by _showIframeEmbed or _setupControls)
        ['iframe-back-btn', 'iframe-audio-toggle', 'iframe-rotate-btn'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });

        // Show loading
        if (loadingEl) loadingEl.style.display = '';
        if (loadingText) loadingText.textContent = `Loading ${label} stream…`;

        // Store position for restore after new stream loads
        this._pendingSeek = savedTime;
        this._initPlayerOnline(video, iframe, loadingEl, loadingText);
    }

    /* ── Screen rotation toggle ── */

    _setupRotateButton() {
        const iframeRotateBtn = document.getElementById('iframe-rotate-btn');
        const hlsRotateBtn = document.getElementById('player-rotate-btn');
        const handler = () => this._toggleRotation();
        if (iframeRotateBtn) iframeRotateBtn.addEventListener('click', handler);
        if (hlsRotateBtn) hlsRotateBtn.addEventListener('click', handler);
    }

    async _toggleRotation() {
        this._isLandscape = !this._isLandscape;
        const playerWrapper = document.getElementById('player-screen');
        if (!playerWrapper) return;

        if (this._isLandscape) {
            // Force landscape via CSS transform (works without native plugin)
            playerWrapper.classList.add('player-landscape');
            // Try native Screen Orientation API if available
            try {
                if (screen.orientation?.lock) {
                    await screen.orientation.lock('landscape');
                }
            } catch { /* fallback to CSS transform */ }
        } else {
            playerWrapper.classList.remove('player-landscape');
            try {
                if (screen.orientation?.unlock) {
                    screen.orientation.unlock();
                }
            } catch {}
        }
    }

    /* ── Skip intro (visible 0:00–1:30) ── */

    _setupSkipIntro(video) {
        const btn = document.getElementById('player-skip-intro');
        if (!btn) return;
        btn.addEventListener('click', () => {
            video.currentTime = 90; // skip to 1:30
            btn.style.display = 'none';
            this._skipIntroDismissed = true;
        });
        video.addEventListener('timeupdate', () => {
            if (this._skipIntroDismissed) return;
            const t = video.currentTime;
            btn.style.display = (t >= 0 && t <= 90) ? '' : 'none';
        });
    }

    /* ── Auto-play next episode ── */

    _showAutoPlayNext() {
        const epNum = Number(this.episode.number ?? this.episode.episode ?? 0);
        const nextEp = this.allEpisodes.find(e => {
            const n = Number(e.number ?? e.episode ?? 0);
            return n === epNum + 1;
        });
        if (!nextEp) return; // no next episode

        const overlay = document.getElementById('player-autoplay');
        const countdownEl = document.getElementById('autoplay-countdown');
        if (!overlay || !countdownEl) return;

        overlay.style.display = '';
        let secs = 5;
        countdownEl.textContent = secs;

        this._autoPlayTimer = setInterval(() => {
            secs--;
            countdownEl.textContent = secs;
            if (secs <= 0) {
                clearInterval(this._autoPlayTimer);
                this._playNextEpisode(nextEp);
            }
        }, 1000);

        document.getElementById('autoplay-now')?.addEventListener('click', () => {
            clearInterval(this._autoPlayTimer);
            this._playNextEpisode(nextEp);
        });
        document.getElementById('autoplay-cancel')?.addEventListener('click', () => {
            clearInterval(this._autoPlayTimer);
            overlay.style.display = 'none';
        });
    }

    _playNextEpisode(nextEp) {
        this._cleanup();
        document.dispatchEvent(new CustomEvent('navigateToPlayer', {
            detail: {
                libraryItem: this.libraryItem,
                episode: {
                    ...nextEp,
                    source: nextEp.source || this.episode.source || this.libraryItem?.source || 'aniwatch'
                },
                allEpisodes: this.allEpisodes
            }
        }));
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
            .player-skip-intro {
                position:absolute; bottom:100px; right:16px; z-index:15;
                background:rgba(255,107,53,.9); color:#fff; border:none;
                padding:10px 20px; border-radius:6px; font-size:14px;
                font-weight:600; cursor:pointer; backdrop-filter:blur(4px);
            }
            .player-skip-intro:active { transform:scale(.95); }
            .iframe-float-back {
                position:absolute; top:12px; left:12px; z-index:5;
                width:40px; height:40px; border-radius:50%;
                background:rgba(0,0,0,0.5); border:none; color:#fff;
                cursor:pointer; align-items:center; justify-content:center;
                backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
            }
            .iframe-float-back:active { background:rgba(0,0,0,0.7); transform:scale(0.95); }
            .iframe-float-audio {
                position:absolute; top:12px; right:56px; z-index:5;
                padding:6px 12px; border-radius:4px;
                background:rgba(0,0,0,0.5); border:none; color:#fff;
                font-size:12px; font-weight:700; cursor:pointer;
                backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
            }
            .iframe-float-audio:active { background:rgba(0,0,0,0.7); transform:scale(0.95); }
            .iframe-float-rotate {
                position:absolute; top:12px; right:12px; z-index:5;
                width:36px; height:36px; border-radius:50%;
                background:rgba(0,0,0,0.5); border:none; color:#fff;
                cursor:pointer; display:flex; align-items:center; justify-content:center;
                backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px);
            }
            .iframe-float-rotate:active { background:rgba(0,0,0,0.7); transform:scale(0.95); }
            /* Landscape mode via CSS transform (fallback when native orientation API unavailable) */
            .player-landscape {
                position:fixed !important; top:0; left:0;
                width:100vh !important; height:100vw !important;
                transform:rotate(90deg); transform-origin:top left;
                margin-left:100vw; z-index:9999;
            }
            .player-landscape iframe,
            .player-landscape video {
                width:100% !important; height:100% !important;
            }
        `;
        document.head.appendChild(style);
    }
}

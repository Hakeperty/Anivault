/**
 * Reader Screen - Manga page reader with gesture support
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';
import { SearchCoordinator } from '../scrapers/coordinator.js';

export class ReaderScreen {
    constructor(libraryItem, chapter, allChapters = []) {
        this.libraryItem = libraryItem;
        this.chapter = chapter;
        this.allChapters = allChapters;
        this.pages = [];
        this.currentPage = 0;
        this.isZoomed = false;
        this.mode = 'page'; // 'page' or 'scroll'
        this.touchStartX = 0;
        this.touchStartY = 0;
        this.touchStartTime = 0;
        this.lastTapTime = 0;
        this.preloadedImages = new Map();
        this.controlsVisible = true;
        this.controlsTimeout = null;
        this.loadingNextChapter = false;
    }

    async render() {
        return `
            <div class="screen reader-screen fullscreen" style="background:#000;display:flex;flex-direction:column;overflow:hidden;user-select:none;-webkit-user-select:none;">
                <!-- Top bar -->
                <div id="reader-top-bar" style="position:absolute;top:0;left:0;right:0;z-index:20;background:linear-gradient(to bottom,rgba(0,0,0,0.85),transparent);padding:12px 16px;display:flex;align-items:center;gap:12px;transition:opacity 0.3s ease;">
                    <button id="reader-back-btn" style="background:none;border:none;color:var(--text-primary);font-size:24px;cursor:pointer;padding:4px 8px;">←</button>
                    <div style="flex:1;overflow:hidden;">
                        <div style="font-size:14px;font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${this.libraryItem?.title || 'Manga'}</div>
                        <div style="font-size:12px;color:var(--text-secondary);">${this.chapter?.title || 'Chapter'}</div>
                    </div>
                    <button id="reader-mode-toggle" style="background:var(--bg-tertiary);border:1px solid var(--border-color);color:var(--text-primary);font-size:12px;padding:6px 10px;border-radius:6px;cursor:pointer;">Page</button>
                </div>

                <!-- Loading state -->
                <div id="reader-loading" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;">
                    <div class="spinner" style="width:40px;height:40px;border-width:4px;"></div>
                    <p style="color:var(--text-secondary);font-size:14px;">Loading pages…</p>
                </div>

                <!-- Page mode container -->
                <div id="reader-page-container" style="flex:1;display:none;position:relative;overflow:hidden;">
                    <div id="reader-touch-area" style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                        <img id="reader-page-img" style="max-width:100%;max-height:100%;object-fit:contain;transition:transform 0.2s ease;" alt="Page" />
                    </div>
                    <!-- Error overlay -->
                    <div id="reader-error-overlay" style="display:none;position:absolute;inset:0;background:rgba(0,0,0,0.8);flex-direction:column;align-items:center;justify-content:center;gap:12px;">
                        <div style="font-size:14px;opacity:0.4;color:var(--text-tertiary);">Failed to load page</div>
                        <p style="color:var(--text-secondary);font-size:14px;">Failed to load page</p>
                        <div style="display:flex;gap:8px;">
                            <button id="reader-retry-btn" class="btn btn-primary btn-small">Retry</button>
                            <button id="reader-skip-btn" class="btn btn-secondary btn-small">Skip</button>
                        </div>
                    </div>
                </div>

                <!-- Scroll mode container -->
                <div id="reader-scroll-container" style="flex:1;display:none;overflow-y:auto;-webkit-overflow-scrolling:touch;padding-bottom:70px;">
                    <div id="reader-scroll-pages" style="display:flex;flex-direction:column;align-items:center;gap:2px;"></div>
                </div>

                <!-- Bottom bar -->
                <div id="reader-bottom-bar" style="position:absolute;bottom:0;left:0;right:0;z-index:20;background:linear-gradient(to top,rgba(0,0,0,0.85),transparent);padding:16px;transition:opacity 0.3s ease;">
                    <div id="reader-page-indicator" style="text-align:center;color:var(--text-primary);font-size:13px;font-weight:600;margin-bottom:8px;">Page 0 of 0</div>
                    <input id="reader-slider" type="range" min="0" max="0" value="0" style="width:100%;accent-color:var(--accent-primary);height:4px;" />
                </div>
            </div>
        `;
    }

    async afterRender() {
        this.setupBackButton();
        this.setupModeToggle();

        // Load saved reader mode preference from settings
        try {
            const savedMode = await db.getSetting('readerMode', 'page');
            if (savedMode === 'scroll' || savedMode === 'page') {
                this.mode = savedMode;
                const btn = document.getElementById('reader-mode-toggle');
                if (btn) btn.textContent = this.mode === 'page' ? 'Page' : 'Scroll';
            }
        } catch (e) {
            console.warn('Could not load reader mode setting:', e);
        }

        await this.loadPages();
    }

    setupBackButton() {
        document.getElementById('reader-back-btn')?.addEventListener('click', () => {
            this.saveCurrentProgress();
            document.getElementById('bottom-nav').style.display = 'flex';
            document.dispatchEvent(new Event('goBack'));
        });
    }

    setupModeToggle() {
        document.getElementById('reader-mode-toggle')?.addEventListener('click', async () => {
            this.mode = this.mode === 'page' ? 'scroll' : 'page';
            const btn = document.getElementById('reader-mode-toggle');
            btn.textContent = this.mode === 'page' ? 'Page' : 'Scroll';
            this.applyMode();

            // Persist the mode choice to settings
            try { await db.setSetting('readerMode', this.mode); } catch (e) {}
        });
    }

    async loadPages() {
        try {
            const chapterId = this.chapter?.id;
            const source = this.chapter?.source || this.libraryItem?.source || 'mangakatana';
            const mangaTitle = this.libraryItem?.title || '';
            const altTitle = this.libraryItem?.titleEnglish || '';
            const chapterNumber = this.chapter?.chapter ?? null;
            this.pages = await SearchCoordinator.getChapterPages(chapterId, source, mangaTitle, chapterNumber, altTitle);

            if (!this.pages || this.pages.length === 0) {
                this.showLoadError('No pages found for this chapter');
                return;
            }

            document.getElementById('reader-loading').style.display = 'none';

            // Restore saved progress
            const savedProgress = await this.getSavedProgress();
            if (savedProgress && savedProgress.watchedSeconds > 0 && savedProgress.watchedSeconds < this.pages.length) {
                this.currentPage = savedProgress.watchedSeconds;
            }

            this.setupSlider();
            this.applyMode();
            this.preloadAdjacent();
        } catch (err) {
            console.error('Failed to load chapter pages:', err);
            this.showLoadError('Failed to load chapter pages');
        }
    }

    showLoadError(message) {
        const loading = document.getElementById('reader-loading');
        if (loading) {
            loading.innerHTML = `
                <div style="font-size:14px;opacity:0.4;color:var(--text-tertiary);margin-bottom:12px;">${message}</div>
                <p style="color:var(--text-secondary);font-size:14px;margin-bottom:16px;">${message}</p>
                <button id="reader-load-retry" class="btn btn-primary btn-small">Retry</button>
                <button id="reader-load-back" class="btn btn-secondary btn-small" style="margin-top:8px;">Go Back</button>
            `;
        }
        document.getElementById('reader-load-retry')?.addEventListener('click', () => {
            loading.innerHTML = `<div class="spinner" style="width:40px;height:40px;border-width:4px;"></div><p style="color:var(--text-secondary);font-size:14px;margin-top:16px;">Loading pages…</p>`;
            this.loadPages();
        });
        document.getElementById('reader-load-back')?.addEventListener('click', () => {
            document.getElementById('bottom-nav').style.display = 'flex';
            document.dispatchEvent(new Event('goBack'));
        });
    }

    applyMode() {
        const pageContainer = document.getElementById('reader-page-container');
        const scrollContainer = document.getElementById('reader-scroll-container');

        if (this.mode === 'page') {
            pageContainer.style.display = 'flex';
            scrollContainer.style.display = 'none';
            this.showPage(this.currentPage);
            this.setupPageGestures();
        } else {
            pageContainer.style.display = 'none';
            scrollContainer.style.display = 'block';
            this.renderScrollMode();
            this.setupScrollTracking();
        }
    }

    // --- Page Mode ---

    showPage(index) {
        if (index < 0 || index >= this.pages.length) return;
        this.currentPage = index;

        const img = document.getElementById('reader-page-img');
        const errorOverlay = document.getElementById('reader-error-overlay');
        if (!img) return;

        errorOverlay.style.display = 'none';
        img.style.display = 'block';
        img.style.transform = 'scale(1)';
        this.isZoomed = false;

        // Use preloaded image if available
        if (this.preloadedImages.has(index)) {
            img.src = this.preloadedImages.get(index).src;
        } else {
            img.src = this.pages[index];
        }

        img.onerror = () => {
            img.style.display = 'none';
            errorOverlay.style.display = 'flex';
            this.setupErrorButtons(index);
        };

        this.updateIndicator();
        this.updateSlider();
        this.preloadAdjacent();
        this.saveCurrentProgress();
    }

    setupErrorButtons(pageIndex) {
        const retryBtn = document.getElementById('reader-retry-btn');
        const skipBtn = document.getElementById('reader-skip-btn');

        const newRetry = retryBtn.cloneNode(true);
        retryBtn.parentNode.replaceChild(newRetry, retryBtn);
        newRetry.addEventListener('click', () => {
            this.preloadedImages.delete(pageIndex);
            this.showPage(pageIndex);
        });

        const newSkip = skipBtn.cloneNode(true);
        skipBtn.parentNode.replaceChild(newSkip, skipBtn);
        newSkip.addEventListener('click', () => {
            if (this.currentPage < this.pages.length - 1) {
                this.showPage(this.currentPage + 1);
            } else {
                showToast('Last page reached', 'info');
            }
        });
    }

    setupPageGestures() {
        const area = document.getElementById('reader-touch-area');
        if (!area) return;

        // Remove old listeners by replacing element
        const fresh = area.cloneNode(true);
        area.parentNode.replaceChild(fresh, area);

        // Re-grab the image after cloning
        const img = fresh.querySelector('#reader-page-img');
        if (img) {
            img.src = this.pages[this.currentPage] || '';
            img.onerror = () => {
                img.style.display = 'none';
                document.getElementById('reader-error-overlay').style.display = 'flex';
                this.setupErrorButtons(this.currentPage);
            };
        }

        fresh.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
            this.touchStartTime = Date.now();
        }, { passive: true });

        fresh.addEventListener('touchend', (e) => {
            const dx = e.changedTouches[0].clientX - this.touchStartX;
            const dy = e.changedTouches[0].clientY - this.touchStartY;
            const dt = Date.now() - this.touchStartTime;
            const absDx = Math.abs(dx);
            const absDy = Math.abs(dy);

            // Double-tap detection
            const now = Date.now();
            if (now - this.lastTapTime < 300 && absDx < 20 && absDy < 20) {
                this.toggleZoom();
                this.lastTapTime = 0;
                return;
            }
            this.lastTapTime = now;

            // Swipe detection (min 50px, max 300ms, horizontal dominant)
            if (absDx > 50 && absDx > absDy && dt < 300) {
                if (dx < 0) {
                    this.nextPage();
                } else {
                    this.prevPage();
                }
                return;
            }

            // Tap zones (left third / right third)
            if (dt < 200 && absDx < 20 && absDy < 20) {
                const tapX = e.changedTouches[0].clientX;
                const width = fresh.clientWidth;
                if (tapX < width * 0.33) {
                    this.prevPage();
                } else if (tapX > width * 0.66) {
                    this.nextPage();
                } else {
                    this.toggleControls();
                }
            }
        }, { passive: true });

        // Mouse click fallback for non-touch
        fresh.addEventListener('click', (e) => {
            if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
            const x = e.clientX;
            const width = fresh.clientWidth;
            if (x < width * 0.33) {
                this.prevPage();
            } else if (x > width * 0.66) {
                this.nextPage();
            } else {
                this.toggleControls();
            }
        });
    }

    nextPage() {
        if (this.currentPage < this.pages.length - 1) {
            this.showPage(this.currentPage + 1);
        } else {
            this.loadNextChapter();
        }
    }

    prevPage() {
        if (this.currentPage > 0) {
            this.showPage(this.currentPage - 1);
        } else {
            this.loadPrevChapter();
        }
    }

    /** Find the next chapter in the sorted list and navigate to it */
    async loadNextChapter() {
        if (this.loadingNextChapter) return;
        const nextCh = this._getAdjacentChapter(1);
        if (!nextCh) {
            showToast('Last chapter', 'info');
            return;
        }
        this.loadingNextChapter = true;
        showToast(`Loading Chapter ${nextCh.chapter ?? 'next'}…`, 'info');
        await this.saveCurrentProgress();
        this.chapter = nextCh;
        this.pages = [];
        this.currentPage = 0;
        this.preloadedImages.clear();
        this._updateChapterTitle();
        document.getElementById('reader-loading').style.display = 'flex';
        document.getElementById('reader-page-container').style.display = 'none';
        document.getElementById('reader-scroll-container').style.display = 'none';
        await this.loadPages();
        this.loadingNextChapter = false;
    }

    /** Find the previous chapter and navigate to it */
    async loadPrevChapter() {
        if (this.loadingNextChapter) return;
        const prevCh = this._getAdjacentChapter(-1);
        if (!prevCh) {
            showToast('First chapter', 'info');
            return;
        }
        this.loadingNextChapter = true;
        showToast(`Loading Chapter ${prevCh.chapter ?? 'prev'}…`, 'info');
        await this.saveCurrentProgress();
        this.chapter = prevCh;
        this.pages = [];
        this.currentPage = 0;
        this.preloadedImages.clear();
        this._updateChapterTitle();
        document.getElementById('reader-loading').style.display = 'flex';
        document.getElementById('reader-page-container').style.display = 'none';
        document.getElementById('reader-scroll-container').style.display = 'none';
        await this.loadPages();
        this.loadingNextChapter = false;
    }

    /** Get the next (+1) or previous (-1) chapter from allChapters */
    _getAdjacentChapter(direction) {
        if (!this.allChapters || this.allChapters.length === 0) return null;
        const currentIdx = this.allChapters.findIndex(c => c.id === this.chapter?.id);
        if (currentIdx === -1) return null;
        const targetIdx = currentIdx + direction;
        if (targetIdx < 0 || targetIdx >= this.allChapters.length) return null;
        return this.allChapters[targetIdx];
    }

    /** Update the chapter title shown in the top bar */
    _updateChapterTitle() {
        const titleDiv = document.querySelector('#reader-top-bar div[style*="flex:1"] div:last-child');
        if (titleDiv) titleDiv.textContent = this.chapter?.title || 'Chapter';
    }

    toggleZoom() {
        const img = document.getElementById('reader-page-img');
        if (!img) return;
        this.isZoomed = !this.isZoomed;
        img.style.transform = this.isZoomed ? 'scale(2)' : 'scale(1)';
    }

    toggleControls() {
        this.controlsVisible = !this.controlsVisible;
        const opacity = this.controlsVisible ? '1' : '0';
        const pointer = this.controlsVisible ? 'auto' : 'none';
        const topBar = document.getElementById('reader-top-bar');
        const bottomBar = document.getElementById('reader-bottom-bar');
        if (topBar) { topBar.style.opacity = opacity; topBar.style.pointerEvents = pointer; }
        if (bottomBar) { bottomBar.style.opacity = opacity; bottomBar.style.pointerEvents = pointer; }
    }

    // --- Scroll Mode ---

    renderScrollMode() {
        const container = document.getElementById('reader-scroll-pages');
        if (!container) return;

        const nextCh = this._getAdjacentChapter(1);

        container.innerHTML = this.pages.map((url, i) => `
            <div class="scroll-page-wrapper" data-page="${i}" style="width:100%;min-height:200px;position:relative;">
                <img src="${url}" alt="Page ${i + 1}" style="width:100%;display:block;" 
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';" />
                <div style="display:none;flex-direction:column;align-items:center;justify-content:center;padding:40px;gap:8px;">
                    <span style="font-size:12px;opacity:0.4;color:var(--text-tertiary);">Error</span>
                    <p style="color:var(--text-secondary);font-size:12px;">Page ${i + 1} failed</p>
                    <button class="btn btn-primary btn-small scroll-retry-btn" data-idx="${i}">Retry</button>
                </div>
            </div>
        `).join('') + (nextCh ? `
            <div id="scroll-next-chapter" style="width:100%;padding:40px 20px;text-align:center;">
                <p style="color:var(--text-secondary);font-size:13px;margin-bottom:12px;">End of chapter</p>
                <button id="scroll-next-ch-btn" class="btn btn-primary" style="padding:10px 24px;font-size:14px;">
                    Next: Chapter ${nextCh.chapter ?? 'next'}
                </button>
            </div>
        ` : `
            <div style="width:100%;padding:40px 20px;text-align:center;">
                <p style="color:var(--text-secondary);font-size:13px;">End of last chapter</p>
            </div>
        `);

        container.querySelectorAll('.scroll-retry-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.idx);
                const wrapper = container.querySelector(`[data-page="${idx}"]`);
                const img = wrapper.querySelector('img');
                const errDiv = wrapper.querySelector('div');
                img.style.display = 'block';
                errDiv.style.display = 'none';
                img.src = this.pages[idx] + (this.pages[idx].includes('?') ? '&' : '?') + 'retry=' + Date.now();
            });
        });

        // Next chapter button in scroll mode
        document.getElementById('scroll-next-ch-btn')?.addEventListener('click', () => {
            this.loadNextChapter();
        });
    }

    setupScrollTracking() {
        const scrollContainer = document.getElementById('reader-scroll-container');
        if (!scrollContainer) return;

        let scrollTimer = null;
        scrollContainer.addEventListener('scroll', () => {
            clearTimeout(scrollTimer);
            scrollTimer = setTimeout(() => {
                const wrappers = scrollContainer.querySelectorAll('.scroll-page-wrapper');
                const scrollTop = scrollContainer.scrollTop;
                const viewMid = scrollTop + scrollContainer.clientHeight / 2;

                for (const wrapper of wrappers) {
                    const top = wrapper.offsetTop;
                    const bottom = top + wrapper.offsetHeight;
                    if (viewMid >= top && viewMid <= bottom) {
                        this.currentPage = parseInt(wrapper.dataset.page);
                        this.updateIndicator();
                        this.updateSlider();
                        this.saveCurrentProgress();
                        break;
                    }
                }
            }, 100);
        }, { passive: true });
    }

    // --- Shared Controls ---

    setupSlider() {
        const slider = document.getElementById('reader-slider');
        if (!slider) return;
        slider.max = this.pages.length - 1;
        slider.value = this.currentPage;

        slider.addEventListener('input', (e) => {
            const page = parseInt(e.target.value);
            if (this.mode === 'page') {
                this.showPage(page);
            } else {
                this.currentPage = page;
                this.updateIndicator();
                const wrapper = document.querySelector(`[data-page="${page}"]`);
                if (wrapper) wrapper.scrollIntoView({ behavior: 'smooth' });
            }
        });
    }

    updateIndicator() {
        const el = document.getElementById('reader-page-indicator');
        if (el) el.textContent = `Page ${this.currentPage + 1} of ${this.pages.length}`;
    }

    updateSlider() {
        const slider = document.getElementById('reader-slider');
        if (slider) slider.value = this.currentPage;
    }

    // --- Preloading ---

    preloadAdjacent() {
        const range = [
            this.currentPage - 1, this.currentPage + 1,
            this.currentPage + 2, this.currentPage + 3, this.currentPage + 4
        ];
        for (const idx of range) {
            if (idx >= 0 && idx < this.pages.length && !this.preloadedImages.has(idx)) {
                const img = new Image();
                img.src = this.pages[idx];
                this.preloadedImages.set(idx, img);
            }
        }
    }

    // --- Progress ---

    async getSavedProgress() {
        try {
            const chapterId = this.chapter?.id;
            const libraryId = this.libraryItem?.id;
            if (!libraryId || !chapterId) return null;
            return await db.getProgressForEpisode(libraryId, chapterId);
        } catch { return null; }
    }

    async saveCurrentProgress() {
        try {
            const libraryId = this.libraryItem?.id;
            const chapterId = this.chapter?.id;
            const chapterNum = this.chapter?.number || this.chapter?.title || '';
            if (!libraryId || !chapterId) return;

            const completed = this.currentPage >= this.pages.length - 1;
            await db.saveProgress(libraryId, chapterId, chapterNum, completed, this.currentPage);
        } catch (err) {
            console.error('Failed to save reading progress:', err);
        }
    }
}

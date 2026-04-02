/**
 * Downloads Screen - Show download queue and completed downloads
 */

import { db } from '../db/indexeddb.js';
import { showToast } from '../utils/toast.js';
import { DownloadManager } from '../utils/downloader.js';

export class DownloadsScreen {
    constructor() {
        this.downloads = [];
        this._refreshTimer = null;
    }

    async render() {
        try {
            this.downloads = await db.getDownloads();
        } catch (err) {
            console.error('Failed to load downloads:', err);
            this.downloads = [];
        }

        if (this.downloads.length === 0) {
            return `
                <div class="screen downloads-screen">
                    <div class="screen-header">
                        <h1>Downloads</h1>
                    </div>
                    <div class="empty-state">
                        <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                        <h2>No downloads yet</h2>
                        <p>Downloaded episodes and chapters will appear here for offline access.</p>
                    </div>
                </div>
            `;
        }

        const completed = this.downloads.filter(d => d.status === 'completed');
        const inProgress = this.downloads.filter(d => d.status === 'downloading' || d.status === 'queued');
        const failed = this.downloads.filter(d => d.status === 'failed');

        return `
            <div class="screen downloads-screen">
                <div class="screen-header">
                    <h1>Downloads</h1>
                    <span class="library-count">${this.downloads.length} items</span>
                </div>

                ${inProgress.length > 0 ? `
                    <div class="settings-group">
                        <h3 class="settings-group-title">In Progress</h3>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            ${inProgress.map(d => this.renderDownloadItem(d, 'progress')).join('')}
                        </div>
                    </div>
                ` : ''}

                ${failed.length > 0 ? `
                    <div class="settings-group">
                        <h3 class="settings-group-title">Failed</h3>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            ${failed.map(d => this.renderDownloadItem(d, 'failed')).join('')}
                        </div>
                    </div>
                ` : ''}

                ${completed.length > 0 ? `
                    <div class="settings-group">
                        <h3 class="settings-group-title">Completed</h3>
                        <div style="display:flex;flex-direction:column;gap:4px;">
                            ${completed.map(d => this.renderDownloadItem(d, 'completed')).join('')}
                        </div>
                    </div>
                ` : ''}

                ${this.downloads.length > 0 ? `
                    <div class="section" style="padding-bottom:24px;">
                        <button id="dl-clear-completed" class="btn btn-secondary" style="width:100%;justify-content:center;">Clear Completed</button>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderDownloadItem(download, type) {
        const size = download.fileSize ? this.formatSize(download.fileSize) : '';
        const progress = download.progress || 0;

        const statusMap = {
            completed: '<span style="color:var(--success);font-size:11px;font-weight:600;">Completed</span>',
            downloading: '<span style="color:var(--accent-primary);font-size:11px;font-weight:600;">Downloading</span>',
            queued: '<span style="color:var(--text-tertiary);font-size:11px;font-weight:600;">Queued</span>',
            failed: '<span style="color:var(--error);font-size:11px;font-weight:600;">Failed</span>'
        };

        return `
            <div class="content-item" data-dl-id="${download.id}">
                <div class="content-item-number" style="font-size:11px;">
                    ${type === 'failed' ? '!' : type === 'progress' ? '%' : '#'}
                </div>
                <div class="content-item-info" style="flex:1;overflow:hidden;">
                    <span class="content-item-title">${download.episodeOrChapterId || 'Unknown'}</span>
                    <span class="content-item-meta">
                        ${statusMap[download.status] || ''}
                        ${size ? ` · ${size}` : ''}
                    </span>
                    ${type === 'progress' ? `
                        <div style="margin-top:6px;height:3px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden;">
                            <div style="height:100%;width:${progress}%;background:var(--accent-primary);border-radius:2px;"></div>
                        </div>
                    ` : ''}
                </div>
                <div style="display:flex;gap:6px;flex-shrink:0;">
                    ${type === 'failed' ? `<button class="btn btn-primary btn-small dl-retry-btn" data-dl-id="${download.id}" style="padding:6px 10px;font-size:11px;">Retry</button>` : ''}
                    <button class="btn btn-secondary btn-small dl-delete-btn" data-dl-id="${download.id}" style="padding:6px 8px;">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                    </button>
                </div>
            </div>
        `;
    }

    async afterRender() {
        // Auto-refresh while there are active downloads
        if (this._refreshTimer) clearInterval(this._refreshTimer);
        const hasActive = this.downloads.some(d => d.status === 'downloading' || d.status === 'queued');
        if (hasActive) {
            this._refreshTimer = setInterval(() => this.refresh(), 2000);
        }

        document.querySelectorAll('.dl-delete-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const dlId = btn.dataset.dlId;
                await DownloadManager.cancel(dlId);
                await this.deleteDownload(dlId);
            });
        });

        document.querySelectorAll('.dl-retry-btn').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                await DownloadManager.retry(btn.dataset.dlId);
                showToast('Download requeued', 'info');
                await this.refresh();
            });
        });

        document.getElementById('dl-clear-completed')?.addEventListener('click', () => this.clearCompleted());
    }

    async deleteDownload(id) {
        try {
            await db.deleteDownload(id);
            showToast('Download removed', 'success');
            await this.refresh();
        } catch (err) {
            console.error('Failed to delete download:', err);
            showToast('Failed to remove download', 'error');
        }
    }

    async clearCompleted() {
        try {
            const completed = this.downloads.filter(d => d.status === 'completed');
            for (const d of completed) {
                await db.deleteDownload(d.id);
            }
            showToast(`Cleared ${completed.length} download(s)`, 'success');
            await this.refresh();
        } catch (err) {
            console.error('Failed to clear completed:', err);
            showToast('Failed to clear downloads', 'error');
        }
    }

    async refresh() {
        const container = document.getElementById('screen-container');
        if (container) {
            const html = await this.render();
            container.innerHTML = html;
            await this.afterRender();
        }
    }

    formatSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const units = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return (bytes / Math.pow(1024, i)).toFixed(1) + ' ' + units[i];
    }
}

/**
 * Downloads Screen - Show download queue and completed downloads
 */

export class DownloadsScreen {
    constructor() {
        this.downloads = [];
    }

    async render() {
        return `
            <div class="screen downloads-screen">
                <div class="screen-header">
                    <h1>Downloads</h1>
                </div>
                <div class="empty-state">
                    <svg class="empty-state-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                    <h2>No downloads yet</h2>
                    <p>Downloaded episodes and chapters will appear here</p>
                </div>
            </div>
        `;
    }

    async afterRender() {}
}

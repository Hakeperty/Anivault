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
                <div class="section">
                    <p style="text-align: center; color: var(--text-tertiary);">Downloads feature - coming soon</p>
                </div>
            </div>
        `;
    }

    async afterRender() {
        // Placeholder - to be implemented
    }
}

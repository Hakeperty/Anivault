/**
 * Detail Screen - Shows anime/manga metadata and episodes/chapters
 */

export class DetailScreen {
    constructor(item, source) {
        this.item = item;
        this.source = source;
    }

    async render() {
        return `
            <div class="screen detail-screen">
                <div class="detail-header">
                    <button class="back-btn" data-action="back">← Back</button>
                    <h2>${this.item.title}</h2>
                </div>
                <div class="detail-content">
                    <div class="detail-hero">
                        <img src="${this.item.coverImage}" alt="${this.item.title}" class="hero-image">
                    </div>
                    <div class="detail-info">
                        <p>${this.item.description || 'No description available'}</p>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.querySelector('[data-action="back"]')?.addEventListener('click', () => {
            const backEvent = new Event('goBack');
            document.dispatchEvent(backEvent);
        });
    }
}

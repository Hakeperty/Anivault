/**
 * Reader Screen - Manga page reader with gesture support
 */

export class ReaderScreen {
    constructor(libraryItem, chapter) {
        this.libraryItem = libraryItem;
        this.chapter = chapter;
    }

    async render() {
        return `
            <div class="screen reader-screen fullscreen">
                <div class="reader-container">
                    <img id="reader-page" src="" alt="Manga page">
                    <div class="reader-controls">
                        <button class="back-btn" data-action="back">← Back</button>
                        <h3>${this.libraryItem.title} - Chapter ${this.chapter}</h3>
                    </div>
                </div>
            </div>
        `;
    }

    async afterRender() {
        document.querySelector('[data-action="back"]')?.addEventListener('click', () => {
            document.getElementById('bottom-nav').style.display = 'flex';
            const backEvent = new Event('goBack');
            document.dispatchEvent(backEvent);
        });
    }
}

/**
 * Player Screen - Video player for anime episodes
 */

export class PlayerScreen {
    constructor(libraryItem, episode) {
        this.libraryItem = libraryItem;
        this.episode = episode;
    }

    async render() {
        return `
            <div class="screen player-screen fullscreen">
                <div class="player-container">
                    <video id="hls-video" controls></video>
                    <div class="player-controls">
                        <button class="back-btn" data-action="back">← Back</button>
                        <h3>${this.libraryItem.title} - Episode ${this.episode}</h3>
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

/**
 * Toast Notification Utility
 */

const MAX_TOASTS = 3;
const _activeToasts = [];

export function showToast(message, type = 'info', duration = 3000) {
    // Remove excess toasts
    while (_activeToasts.length >= MAX_TOASTS) {
        const old = _activeToasts.shift();
        old.classList.remove('show');
        setTimeout(() => old.remove(), 200);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;
    
    document.body.appendChild(toast);
    _activeToasts.push(toast);
    
    // Stack vertically
    _repositionToasts();
    
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });
    
    setTimeout(() => {
        toast.classList.remove('show');
        const idx = _activeToasts.indexOf(toast);
        if (idx > -1) _activeToasts.splice(idx, 1);
        setTimeout(() => {
            toast.remove();
            _repositionToasts();
        }, 300);
    }, duration);
}

function _repositionToasts() {
    let offset = 0;
    for (const t of _activeToasts) {
        t.style.setProperty('--toast-offset', `${offset}px`);
        offset += 52; // height + gap
    }
}

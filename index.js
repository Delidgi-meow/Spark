// ═══════════════════════════════════════════
// SPARK — точка входа
// ═══════════════════════════════════════════

import { eventSource, event_types } from '../../../../script.js';
import { reloadRoster, getRoster } from './roster.js';
import { loadState, getSettings } from './state.js';
import { render, handleAction, updateFabBadge, handleFileInput, handleSettingChange } from './ui.js';
import { syncToMainChat, clearMainChatInjection, debugSparkInjection } from './engine.js';

const LOG = '[Spark]';

function injectFab() {
    if (document.getElementById('spark-fab')) return;
    const settings = getSettings();
    const fab = document.createElement('button');
    fab.id = 'spark-fab';
    fab.type = 'button';
    fab.title = 'Spark (зажми и тащи чтобы передвинуть)';

    // Clamp сохранённой позиции к текущему viewport — защита если передвинули
    // на большом экране, а открыли на маленьком (FAB уезжал за экран).
    // Используем top/right (не bottom!) — на мобильном `bottom` прыгает из-за
    // адресной строки и нижних панелей ST, top всегда стабилен.
    const vw = window.innerWidth || 360;
    const vh = window.innerHeight || 640;
    let right = settings.fabPosition?.right ?? 20;
    // Дефолтная позиция: ~200px от низа viewport (над нижней панелью ST, но не у самого края).
    let top = settings.fabPosition?.top ?? Math.max(120, vh - 200);
    right = Math.max(0, Math.min(vw - 56, right));
    top = Math.max(0, Math.min(vh - 90, top));
    fab.style.right = `${right}px`;
    fab.style.top = `${top}px`;
    fab.style.bottom = 'auto';

    fab.innerHTML = `
        <div class="spark-fab-screen"><div class="spark-fab-logo">✦</div></div>
        <div class="spark-fab-hint">Spark</div>
    `;
    // Прикрепляем к html (documentElement), а не к body — потому что у ST на мобиле
    // некоторые обёртки над <body> получают transform/filter, что ломает position:fixed
    // (fixed-элемент тогда фиксируется относительно transformed-предка, а не viewport).
    // <html> гарантированно без transform.
    (document.documentElement || document.body).appendChild(fab);
    console.log(LOG, `FAB создан: right=${right}px top=${top}px viewport=${vw}x${vh} parent=${fab.parentNode?.tagName}`);
    updateFabBadge();
    makeFabDraggable(fab);

    // Защита от «убегания»: если FAB на ресайзе/скролле оказался вне viewport — возвращаем.
    const guard = () => {
        const r = fab.getBoundingClientRect();
        if (r.top < 0 || r.top > window.innerHeight - 20 || r.right < 20 || r.left > window.innerWidth - 20) {
            fab.style.top = Math.max(120, window.innerHeight - 200) + 'px';
            fab.style.right = '20px';
            fab.style.bottom = 'auto';
            console.warn(LOG, 'FAB улетел — вернул на экран');
        }
    };
    window.addEventListener('resize', guard);
    window.addEventListener('orientationchange', guard);
}

// Перетаскивание: зажать и тащить. Клик (без движения) — открывает приложение.
function makeFabDraggable(fab) {
    let startX = 0, startY = 0, origRight = 0, origTop = 0;
    let dragging = false, moved = false;

    const onDown = (e) => {
        const p = e.touches ? e.touches[0] : e;
        startX = p.clientX; startY = p.clientY;
        origRight = parseInt(fab.style.right, 10) || 20;
        origTop = parseInt(fab.style.top, 10) || 120;
        dragging = true; moved = false;
        fab.classList.add('spark-fab-dragging');
        e.preventDefault();
    };
    const onMove = (e) => {
        if (!dragging) return;
        const p = e.touches ? e.touches[0] : e;
        const dx = p.clientX - startX;
        const dy = p.clientY - startY;
        if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
        // right уменьшается при движении вправо; top растёт при движении вниз
        const newRight = Math.max(0, Math.min(window.innerWidth - 56, origRight - dx));
        const newTop = Math.max(0, Math.min(window.innerHeight - 90, origTop + dy));
        fab.style.right = `${newRight}px`;
        fab.style.top = `${newTop}px`;
        fab.style.bottom = 'auto';
        e.preventDefault();
    };
    const onUp = () => {
        if (!dragging) return;
        dragging = false;
        fab.classList.remove('spark-fab-dragging');
        if (moved) {
            const settings = getSettings();
            settings.fabPosition = {
                right: parseInt(fab.style.right, 10) || 20,
                top: parseInt(fab.style.top, 10) || 120,
            };
            import('./state.js').then(m => m.saveSettings());
        } else {
            // Это был клик без перетаскивания — открыть приложение
            openApp();
        }
    };

    fab.addEventListener('mousedown', onDown);
    fab.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
}

function injectModal() {
    if (document.getElementById('spark-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'spark-modal';
    modal.innerHTML = `
        <div class="spark-modal-backdrop" data-spark-close></div>
        <div class="spark-app" id="spark-modal-body"></div>
    `;
    document.body.appendChild(modal);

    modal.addEventListener('click', (e) => {
        if (e.target.hasAttribute('data-spark-close')) modal.classList.remove('open');
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && modal.classList.contains('open')) modal.classList.remove('open');
    });
}

async function openApp() {
    const modal = document.getElementById('spark-modal');
    if (!modal) return;
    modal.classList.add('open');
    // если ростер пустой — попробуем перезагрузить
    if (!Object.keys(getRoster()).length) {
        await reloadRoster();
    }
    render();
}

function bindEvents() {
    const modal = document.getElementById('spark-modal');
    if (!modal) return;

    modal.addEventListener('click', (e) => {
        const el = e.target.closest('[data-spark-action]');
        if (!el || el.tagName === 'FORM') return;
        e.preventDefault();
        e.stopPropagation();
        handleAction(el.getAttribute('data-spark-action'), el.getAttribute('data-spark-boy'), e);
    });

    modal.addEventListener('submit', (e) => {
        const el = e.target.closest('[data-spark-action]');
        if (!el) return;
        e.preventDefault();
        handleAction(el.getAttribute('data-spark-action'), el.getAttribute('data-spark-boy'), e);
    });

    modal.addEventListener('change', (e) => {
        if (e.target.tagName === 'INPUT' && e.target.type === 'file') {
            handleFileInput(e.target);
        } else if (e.target.dataset?.sparkSet || e.target.dataset?.sparkSetDeep) {
            handleSettingChange(e.target);
        }
    });

    modal.addEventListener('input', (e) => {
        if ((e.target.dataset?.sparkSet || e.target.dataset?.sparkSetDeep) && e.target.type !== 'checkbox' && e.target.tagName !== 'SELECT') {
            handleSettingChange(e.target);
        }
    });

    // Перерисовка при асинхронных событиях (например, дозагрузилась картинка от парня)
    window.addEventListener('spark:rerender', () => {
        const m = document.getElementById('spark-modal');
        if (m?.classList.contains('open')) render();
        updateFabBadge();
    });
}

function onChatChanged() {
    console.log(LOG, 'chat changed → reload state, sync injection, reload roster');
    updateFabBadge();
    syncToMainChat();
    // если источник = chat-lorebook — перезагрузим ростер
    const settings = getSettings();
    if (settings.rosterSource === 'chat-lorebook') {
        reloadRoster().then(() => {
            const modal = document.getElementById('spark-modal');
            if (modal?.classList.contains('open')) render();
        });
    } else {
        const modal = document.getElementById('spark-modal');
        if (modal?.classList.contains('open')) render();
    }
}

async function init() {
    injectFab();
    injectModal();
    bindEvents();

    if (eventSource && event_types) {
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        if (event_types.APP_READY) eventSource.on(event_types.APP_READY, onChatChanged);
    }

    // Отложенная инициализация: ждём пока ST загрузит чат
    setTimeout(async () => {
        try { await reloadRoster(); } catch (e) { console.error(LOG, e); }
        updateFabBadge();
        syncToMainChat();
    }, 1500);

    console.log(LOG, 'loaded v3.1.0. Console: sparkOpen() / sparkDebug() / sparkReset() / sparkReload() / sparkInjection()');
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();

window.sparkOpen = openApp;
window.sparkFabReset = () => {
    const vh = window.innerHeight || 640;
    const settings = getSettings();
    settings.fabPosition = { right: 20, top: Math.max(120, vh - 200) };
    import('./state.js').then(m => m.saveSettings());
    const fab = document.getElementById('spark-fab');
    if (fab) { fab.style.right = '20px'; fab.style.top = settings.fabPosition.top + 'px'; fab.style.bottom = 'auto'; }
    console.log(LOG, 'позиция FAB сброшена:', settings.fabPosition);
};
window.sparkDebug = () => {
    const s = loadState();
    console.log('vibe:', s.vibe);
    console.log('matches:', s.matches);
    console.log('messages:', Object.keys(s.messages).map(k => `${k}: ${s.messages[k].length}`));
    console.log('roster:', Object.keys(getRoster()));
    return s;
};
window.sparkReset = async () => {
    const m = await import('./state.js');
    m.resetState();
    clearMainChatInjection();
    updateFabBadge();
    console.log(LOG, 'сброшено');
};
window.sparkReload = async () => { const n = await reloadRoster(); console.log(LOG, 'парней:', n); render(); };
window.sparkInjection = debugSparkInjection;
window.sparkRoster = () => getRoster();

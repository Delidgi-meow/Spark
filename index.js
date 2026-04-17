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
    fab.title = 'Spark';
    fab.style.right = `${settings.fabPosition?.right ?? 20}px`;
    fab.style.bottom = `${settings.fabPosition?.bottom ?? 90}px`;
    fab.innerHTML = `
        <div class="spark-fab-screen"><div class="spark-fab-logo">✦</div></div>
        <div class="spark-fab-hint">Spark</div>
    `;
    fab.addEventListener('click', openApp);
    document.body.appendChild(fab);
    updateFabBadge();
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

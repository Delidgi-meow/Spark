// ═══════════════════════════════════════════
// UI — рендер всех экранов Spark
// ═══════════════════════════════════════════

import {
    getRoster, getSwipeOrder, getCustomAvatar, setCustomAvatar, clearCustomAvatar,
    reloadRoster, regenerateBoyCard,
} from './roster.js';
import {
    loadState, save, bumpVibe, setMatch, getNextBoy, pushMessage, markRead,
    getSettings, saveSettings, resetState,
} from './state.js';
import { matchScore, isMatch } from './scoring.js';
import { generateBoyReply, generateFirstMessage, generateAvatar, syncToMainChat, debugSparkInjection, regenerateChatImage } from './engine.js';
import { fetchModels, isExtraLLMConfigured, isImageApiConfigured } from './api.js';
import { user_avatar, getThumbnailUrl } from '../../../../script.js';

// ── SVG ──
const ICONS = {
    x: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.4L17.6 5 12 10.6 6.4 5 5 6.4 10.6 12 5 17.6 6.4 19 12 13.4 17.6 19 19 17.6 13.4 12z"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.6 7.6H22l-6.2 4.5 2.4 7.4L12 16.9 5.8 21.5l2.4-7.4L2 9.6h7.4z"/></svg>',
    heart: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21s-7-4.5-9.5-9C.5 8 3 4 7 4c2 0 3.5 1 5 2.5C13.5 5 15 4 17 4c4 0 6.5 4 4.5 8-2.5 4.5-9.5 9-9.5 9z"/></svg>',
    flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13.5 0.5C9 4.5 4 9 4 14c0 4.4 3.6 8 8 8s8-3.6 8-8c0-3-2-5.5-3.5-7C15 5.5 14 3 13.5 0.5z"/></svg>',
    chat: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2z"/></svg>',
    pin: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7zm0 9.5a2.5 2.5 0 110-5 2.5 2.5 0 010 5z"/></svg>',
    warn: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 21h22L12 2zm0 5l7.5 13h-15L12 7zm-1 5v3h2v-3h-2zm0 4v2h2v-2h-2z"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M15.4 7.4L14 6l-6 6 6 6 1.4-1.4L10.8 12z"/></svg>',
    send: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 21l21-9L2 3v7l15 2-15 2z"/></svg>',
    gear: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M19.4 13a7.5 7.5 0 000-2l2.1-1.6-2-3.4L17 7a7.5 7.5 0 00-1.7-1L15 3.5h-4L10.7 6a7.5 7.5 0 00-1.7 1l-2.5-1-2 3.4L6.6 11a7.5 7.5 0 000 2l-2.1 1.6 2 3.4L9 17a7.5 7.5 0 001.7 1l.3 2.5h4l.3-2.5a7.5 7.5 0 001.7-1l2.5 1 2-3.4-2.1-1.6zM13 16a4 4 0 110-8 4 4 0 010 8z"/></svg>',
    paperclip: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.5 6v11.5a4 4 0 11-8 0V5a2.5 2.5 0 015 0v10.5a1 1 0 11-2 0V6H10v9.5a2.5 2.5 0 005 0V5a4 4 0 10-8 0v12.5a5.5 5.5 0 0011 0V6h-1.5z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 12a4 4 0 100-8 4 4 0 000 8zm0 2c-3.3 0-10 1.7-10 5v3h20v-3c0-3.3-6.7-5-10-5z"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.65 6.35A8 8 0 1019.73 15H17.6a6 6 0 11-1.37-7.2L13 11h7V4l-2.35 2.35z"/></svg>',
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const hhmm = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
// Время сообщения HH:MM из ts (мс)
const formatMsgTime = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// Подпись-разделитель даты: «сегодня» / «вчера» / «12 апр» / «12 апр 2025»
const formatMsgDate = (ts) => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameYear = d.getFullYear() === now.getFullYear();
    const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
    if (dayDiff === 0) return 'сегодня';
    if (dayDiff === 1) return 'вчера';
    const months = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
    return `${d.getDate()} ${months[d.getMonth()]}${sameYear ? '' : ' ' + d.getFullYear()}`;
};
const sameDay = (a, b) => {
    if (!a || !b) return false;
    const x = new Date(a), y = new Date(b);
    return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate();
};
const relTime = (ts) => {
    if (!ts) return '';
    const d = Math.floor((Date.now() - ts) / 60000);
    if (d < 1) return 'сейчас';
    if (d < 60) return `${d} мин`;
    if (d < 1440) return `${Math.floor(d / 60)} ч`;
    return `${Math.floor(d / 1440)} д`;
};

function avatarHTML(boyId, boy, size = 'full') {
    const grad = boy._gradient || boy.avatarGradient || 'linear-gradient(135deg,#3c096c,#10002b)';
    const initial = boy._initial || boy.initial || (boy.name || '?')[0];
    const custom = getCustomAvatar(boyId);
    if (size === 'full') {
        if (custom) return `<div class="spark-avatar" style="background:#000 center/cover no-repeat url('${esc(custom)}');width:100%;height:100%"></div>`;
        return `<div class="spark-avatar" style="background:${grad};width:100%;height:100%;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:700;color:rgba(255,255,255,.15);font-family:Georgia,serif;letter-spacing:-5px">${esc(initial)}</div>`;
    }
    if (custom) return `<div class="spark-avatar" style="background:#000 center/cover no-repeat url('${esc(custom)}');width:${size}px;height:${size}px;border-radius:50%;flex-shrink:0"></div>`;
    return `<div class="spark-avatar" style="background:${grad};width:${size}px;height:${size}px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${Math.floor(size * 0.45)}px;font-weight:700;color:rgba(255,255,255,.7);flex-shrink:0">${esc(initial)}</div>`;
}

function unreadBadge() {
    const s = loadState();
    const n = Object.values(s.matches || {}).filter(m => m.unread).length;
    return n ? ` <span class="spark-unread-pill">${n}</span>` : '';
}

function shell(bodyHTML, activeTab = 'swipe', extraClass = '') {
    return `
    <div class="spark-status-bar">
        <span>${hhmm()}</span>
        <div class="spark-status-icons">
            <svg viewBox="0 0 24 24"><path d="M2 22h20V2L2 22z"/></svg>
            <svg viewBox="0 0 24 24"><path d="M12 4C7 4 2.7 6.7 1 10c1.7 3.3 6 6 11 6s9.3-2.7 11-6c-1.7-3.3-6-6-11-6z" opacity=".4"/></svg>
            <svg viewBox="0 0 24 24"><path d="M15.7 4H8.3C6.5 4 5 5.5 5 7.3v9.4C5 18.5 6.5 20 8.3 20h7.4c1.8 0 3.3-1.5 3.3-3.3V7.3C19 5.5 17.5 4 15.7 4z"/></svg>
            <span data-spark-action="close-app" style="margin-left:8px;cursor:pointer;opacity:.6;font-size:18px;line-height:1;font-weight:300">×</span>
        </div>
    </div>
    <div class="spark-header">
        <div class="spark-logo">
            <svg viewBox="0 0 32 32"><defs><linearGradient id="sl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ff6b9d"/><stop offset=".6" stop-color="#c66bff"/><stop offset="1" stop-color="#7ba8ff"/></linearGradient></defs><path d="M16 2L18.5 11.5L28 14L18.5 16.5L16 26L13.5 16.5L4 14L13.5 11.5z" fill="url(#sl)"/></svg>
            Spark
        </div>
        <div class="spark-loc">${ICONS.pin} центр</div>
    </div>
    <div class="spark-tabs">
        <div class="spark-tab ${activeTab === 'swipe' ? 'active' : ''}" data-spark-action="view-swipe">${ICONS.flame} Открыть</div>
        <div class="spark-tab ${activeTab === 'matches' || activeTab === 'chat' ? 'active' : ''}" data-spark-action="view-matches">${ICONS.chat} Чаты${unreadBadge()}</div>
        <div class="spark-tab ${activeTab === 'me' ? 'active' : ''}" data-spark-action="view-me" title="Моя анкета">${ICONS.user}</div>
        <div class="spark-tab ${activeTab === 'settings' ? 'active' : ''}" data-spark-action="view-settings">${ICONS.gear}</div>
    </div>
    <div class="spark-body ${extraClass}">${bodyHTML}</div>
    `;
}

// ── Card / Swipe view ──
function cardHTML(boyId) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy) return '';
    return `
    <div class="spark-card" data-boy="${boyId}">
        <div class="spark-photo">
            ${avatarHTML(boyId, boy, 'full')}
            <div class="spark-photo-overlay"></div>
            <div class="spark-photo-shine"></div>
            <div class="spark-name-row">
                <h2 class="spark-name">${esc(boy.name)}<span class="spark-age">, ${boy.age}</span></h2>
                <div class="spark-meta">
                    ${ICONS.pin} ${esc(boy.distance || '')}
                    <span style="opacity:.4">·</span>
                    <span class="spark-meta-dot"></span> активен сейчас
                </div>
            </div>
        </div>
        <div class="spark-info">
            <p class="spark-bio">${esc(boy.bio || '')}</p>
            <div class="spark-tags">${(boy.tags_ui || []).map(t => `<span class="spark-tag">${esc(t)}</span>`).join('')}</div>
            ${boy.redflag ? `<div class="spark-redflag">${ICONS.warn}<span>${esc(boy.redflag)}</span></div>` : ''}
        </div>
        <div class="spark-actions">
            <button class="spark-btn spark-btn-pass" data-spark-action="pass" data-spark-boy="${boyId}">${ICONS.x}</button>
            <button class="spark-btn spark-btn-super" data-spark-action="super" data-spark-boy="${boyId}">${ICONS.star}</button>
            <button class="spark-btn spark-btn-like" data-spark-action="like" data-spark-boy="${boyId}">${ICONS.heart}</button>
        </div>
    </div>`;
}

function pageIndicator(boyId) {
    const order = getSwipeOrder();
    const idx = order.indexOf(boyId);
    return `<div class="spark-page-indicator">${order.map((_, i) => `<div class="spark-dot ${i === idx ? 'active' : ''}"></div>`).join('')}</div>`;
}

function matchesStripHTML() {
    const ROSTER = getRoster();
    const s = loadState();
    const matched = Object.entries(s.matches).filter(([_, m]) => ['matched', 'cold_one_message', 'matched_silent'].includes(m.status));
    if (!matched.length) {
        return `<div class="spark-matches-section">
            <div class="spark-matches-title">${ICONS.heart} Твои матчи</div>
            <div class="spark-match-row"><div class="spark-match-empty">пока пусто. свайпай, чтобы найти кого-то</div></div>
        </div>`;
    }
    const items = matched.map(([id, m]) => {
        const b = ROSTER[id]; if (!b) return '';
        return `<div class="spark-match-chip" data-spark-action="open-chat" data-spark-boy="${id}">
            ${avatarHTML(id, b, 52)}
            ${m.unread ? '<div class="spark-unread-dot"></div>' : ''}
            <div class="spark-match-chip-name">${esc(b.name)}</div>
        </div>`;
    }).join('');
    return `<div class="spark-matches-section">
        <div class="spark-matches-title">${ICONS.heart} Твои матчи</div>
        <div class="spark-match-row">${items}</div>
    </div>`;
}

function viewSwipe() {
    const order = getSwipeOrder();
    const ROSTER = getRoster();
    if (!order.length) {
        return shell(`<div class="spark-empty">
            <div class="spark-empty-icon">⚙</div>
            <div class="spark-empty-title">Ростер пуст</div>
            <div class="spark-empty-sub">Привяжи к чату лорбук с парнями (значок 📕 в верхней панели ST), потом нажми «Перезагрузить» в настройках Spark.</div>
            <button class="spark-match-btn primary" data-spark-action="view-settings">Настройки</button>
        </div>`, 'swipe');
    }
    const s = loadState();
    let boyId = s.currentBoy;
    if (!boyId || s.swipedIds.includes(boyId) || !ROSTER[boyId]) {
        boyId = getNextBoy(order);
        s.currentBoy = boyId;
        save();
    }
    if (!boyId) {
        return shell(`<div class="spark-empty">
            <div class="spark-empty-icon">✦</div>
            <div class="spark-empty-title">Пока всё</div>
            <div class="spark-empty-sub">Новые анкеты появятся когда добавишь их в лорбук.</div>
            <button class="spark-match-btn primary" data-spark-action="view-matches">Перейти в чаты</button>
        </div>`, 'swipe');
    }
    return shell(cardHTML(boyId) + pageIndicator(boyId) + matchesStripHTML(), 'swipe');
}

function viewMatch(boyId, score) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    return shell(`
    <div class="spark-match-screen">
        <div class="spark-match-title">It's a Match ✦</div>
        <p style="color:#e8d8e2;font-size:13px;margin:8px 0 4px">Ты и ${esc(boy.name)} лайкнули друг друга</p>
        <p style="color:#a899a3;font-size:11px;margin:0 0 6px">совместимость: ${score}/100</p>
        <div style="margin:16px auto;width:120px;height:120px;border-radius:50%;overflow:hidden;border:3px solid rgba(255,107,157,.4);box-shadow:0 8px 32px rgba(255,107,157,.3)">
            ${avatarHTML(boyId, boy, 120)}
        </div>
        <div class="spark-match-buttons">
            <button class="spark-match-btn primary" data-spark-action="open-chat" data-spark-boy="${boyId}">Написать сейчас</button>
            <button class="spark-match-btn secondary" data-spark-action="continue">Дальше смотреть</button>
        </div>
    </div>`, 'swipe');
}

function viewMatches() {
    const ROSTER = getRoster();
    const s = loadState();
    const list = Object.entries(s.matches)
        .filter(([_, m]) => ['matched', 'cold_one_message', 'matched_silent'].includes(m.status))
        .sort((a, b) => (b[1].timestamp || 0) - (a[1].timestamp || 0));

    if (!list.length) {
        return shell(`<div class="spark-empty">
            <div class="spark-empty-icon">♡</div>
            <div class="spark-empty-title">Тут пока пусто</div>
            <div class="spark-empty-sub">Лайкни кого-нибудь, чтобы начать.</div>
            <button class="spark-match-btn primary" data-spark-action="view-swipe">Смотреть анкеты</button>
        </div>`, 'matches');
    }

    const rows = list.map(([id, m]) => {
        const b = ROSTER[id]; if (!b) return '';
        const msgs = s.messages[id] || [];
        const last = msgs[msgs.length - 1];
        const preview = last
            ? (last.from === 'user' ? 'Ты: ' : '') + (last.image ? '📷 фото' : (last.deleted ? '(удалено)' : (last.text || '').slice(0, 50)))
            : (m.status === 'matched_silent' ? 'нет сообщений' : 'напиши первой');
        return `<div class="spark-match-item" data-spark-action="open-chat" data-spark-boy="${id}">
            ${avatarHTML(id, b, 48)}
            <div class="spark-match-item-body">
                <div class="spark-match-item-head">
                    <span class="spark-match-item-name">${esc(b.name)}</span>
                    <span class="spark-match-item-time">${relTime(last?.ts || m.timestamp)}</span>
                </div>
                <div class="spark-match-item-preview ${last?.deleted ? 'spark-msg-deleted' : ''}">${esc(preview)}</div>
            </div>
            ${m.unread ? '<div class="spark-unread-dot" style="position:static;margin-left:4px"></div>' : ''}
        </div>`;
    }).join('');

    return shell(`<div class="spark-matches-list">${rows}</div>`, 'matches');
}

function viewChat(boyId) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy) return viewMatches();
    const s = loadState();
    const msgs = s.messages[boyId] || [];

    const msgHTML = msgs.map((m, idx) => {
        const cls = m.from === 'user' ? 'spark-msg spark-msg-user' : 'spark-msg spark-msg-boy';
        const delCls = m.deleted ? ' spark-msg-deleted' : '';
        let imgHTML = '';
        if (m.image) {
            const regenBtn = m.from === 'boy' && m._imgPrompt
                ? `<button class="spark-msg-image-regen" data-spark-action="regen-image" data-spark-boy="${boyId}" data-spark-msgts="${m.ts}" title="сгенерировать заново">${ICONS.refresh}</button>`
                : '';
            imgHTML = `<div class="spark-msg-image-wrap">
                <img src="${esc(m.image)}" class="spark-msg-image" alt="image" data-spark-action="zoom-image" data-spark-src="${esc(m.image)}">
                ${regenBtn}
            </div>`;
        }
        else if (m._generating) imgHTML = `<div class="spark-msg-image spark-msg-image-loading">📷 генерируется…</div>`;
        const txtHTML = m.text ? `<div class="spark-msg-text">${esc(m.text)}</div>` : '';
        // Если фото не загрузилось (есть _imgPrompt но image пуст и не _generating) — показать кнопку "повторить"
        const failedRegen = (m.from === 'boy' && m._imgPrompt && !m.image && !m._generating)
            ? `<button class="spark-msg-image-regen spark-msg-image-regen-failed" data-spark-action="regen-image" data-spark-boy="${boyId}" data-spark-msgts="${m.ts}" title="повторить генерацию">${ICONS.refresh}</button>`
            : '';
        // Время сообщения + дата-разделитель если новый день
        const prev = idx > 0 ? msgs[idx - 1] : null;
        const dateSep = (!prev || !sameDay(prev.ts, m.ts))
            ? `<div class="spark-msg-date-sep">${formatMsgDate(m.ts)}</div>`
            : '';
        const timeHTML = m.ts ? `<div class="spark-msg-time">${formatMsgTime(m.ts)}</div>` : '';
        return `${dateSep}<div class="${cls}${delCls}">${imgHTML}${txtHTML}${timeHTML}${failedRegen}</div>`;
    }).join('');

    const typing = s.__typing === boyId ? `<div class="spark-msg spark-msg-boy spark-typing"><span></span><span></span><span></span></div>` : '';

    return shell(`
    <div class="spark-chat">
        <div class="spark-chat-header">
            <button class="spark-chat-back" data-spark-action="view-matches">${ICONS.back}</button>
            <div class="spark-chat-header-avatar" data-spark-action="view-profile" data-spark-boy="${boyId}" title="открыть анкету" style="cursor:pointer">${avatarHTML(boyId, boy, 40)}</div>
            <div class="spark-chat-header-body" data-spark-action="view-profile" data-spark-boy="${boyId}" style="cursor:pointer">
                <div class="spark-chat-name">${esc(boy.name)}, ${boy.age}</div>
                <div class="spark-chat-status">● онлайн</div>
            </div>
        </div>
        <div class="spark-chat-body" id="spark-chat-body">
            ${msgs.length ? msgHTML : `<div class="spark-chat-hint">матч с ${esc(boy.name)}. напиши первой.</div>`}
            ${typing}
        </div>
        <form class="spark-chat-input" data-spark-action="send-msg" data-spark-boy="${boyId}">
            <label class="spark-chat-attach" title="прикрепить фото">
                ${ICONS.paperclip}
                <input type="file" accept="image/*" data-spark-image-input="${boyId}" style="display:none">
            </label>
            <input type="text" class="spark-chat-field" placeholder="напиши ${esc(boy.name)}…" autocomplete="off" />
            <button type="submit" class="spark-chat-send">${ICONS.send}</button>
        </form>
        <div class="spark-chat-hint-small">свидания и встречи — пиши боту в обычный чат ST</div>
    </div>`, 'chat', 'spark-body-fill');
}

function viewSettings() {
    const settings = getSettings();
    const ROSTER = getRoster();
    const order = getSwipeOrder();

    const llmStatus = isExtraLLMConfigured()
        ? `<span class="spark-set-status ok">● подключен</span>`
        : `<span class="spark-set-status err">● не настроен</span>`;
    const imgStatus = isImageApiConfigured()
        ? `<span class="spark-set-status ok">● готов</span>`
        : `<span class="spark-set-status warn">● fallback на /sd</span>`;

    const avatarRows = order.map(id => {
        const b = ROSTER[id]; if (!b) return '';
        const has = !!getCustomAvatar(id);
        return `<div class="spark-set-avatar-row">
            ${avatarHTML(id, b, 44)}
            <div class="spark-set-avatar-name">${esc(b.name)}</div>
            <label class="spark-set-btn small">
                Файл
                <input type="file" accept="image/*" data-spark-avatar-upload="${id}" style="display:none">
            </label>
            <button class="spark-set-btn small" data-spark-action="gen-avatar" data-spark-boy="${id}">Generate</button>
            <button class="spark-set-btn small" data-spark-action="regen-card" data-spark-boy="${id}" title="перегенерировать карточку через extra LLM">⟳</button>
            ${has ? `<button class="spark-set-btn small danger" data-spark-action="clear-avatar" data-spark-boy="${id}">×</button>` : ''}
        </div>`;
    }).join('') || '<div class="spark-set-hint">Ростер пуст. Привяжи лорбук и нажми «Перезагрузить».</div>';

    // выпадающий список моделей если уже подгружен
    const llmModels = window.__sparkLlmModels || [];
    const llmModelOptions = llmModels.length
        ? `<select class="spark-set-input" data-spark-set-deep="extraApi.model">
            ${llmModels.map(m => `<option value="${esc(m)}" ${m === settings.extraApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="spark-set-input" data-spark-set-deep="extraApi.model" value="${esc(settings.extraApi.model)}" placeholder="нажми «Загрузить модели» или впиши вручную">`;

    const imgModels = window.__sparkImgModels || [];
    const imgModelOptions = imgModels.length
        ? `<select class="spark-set-input" data-spark-set-deep="imageApi.model">
            <option value="">— не выбрано —</option>
            ${imgModels.map(m => `<option value="${esc(m)}" ${m === settings.imageApi.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}
           </select>`
        : `<input type="text" class="spark-set-input" data-spark-set-deep="imageApi.model" value="${esc(settings.imageApi.model)}" placeholder="напр. dall-e-3, flux-pro, nano-banana">`;

    return shell(`
    <div class="spark-settings">

        <h3 class="spark-set-section">Источник ростера</h3>
        <label class="spark-set-field">
            <span>Откуда брать парней</span>
            <select class="spark-set-input" data-spark-set="rosterSource">
                <option value="chat-lorebook" ${settings.rosterSource === 'chat-lorebook' ? 'selected' : ''}>Лорбук этого чата (📕 в ST)</option>
                <option value="named-lorebook" ${settings.rosterSource === 'named-lorebook' ? 'selected' : ''}>Лорбук по имени</option>
                <option value="built-in" ${settings.rosterSource === 'built-in' ? 'selected' : ''}>Встроенный (демо: Артём, Юра)</option>
            </select>
        </label>
        ${settings.rosterSource === 'named-lorebook' ? `
        <label class="spark-set-field">
            <span>Имя лорбука</span>
            <input type="text" class="spark-set-input" data-spark-set="lorebookName" value="${esc(settings.lorebookName)}" placeholder="имя world-info">
        </label>` : ''}
        <div class="spark-set-hint">Каждая запись лорбука = один парень. Имя берётся из <b>comment</b>, описание — из <b>content</b>. Карточка (возраст/теги/стиль письма) генерируется автоматически через extra LLM при первой загрузке и кэшируется в чат.</div>
        <button class="spark-set-btn" data-spark-action="reload-roster">Перезагрузить ростер</button>

        <h3 class="spark-set-section">Extra LLM API ${llmStatus}</h3>
        <div class="spark-set-hint">Все запросы Spark идут <b>только сюда</b>. Основной API SillyTavern не трогается.</div>
        <label class="spark-set-field">
            <span>Endpoint (без /v1)</span>
            <input type="text" class="spark-set-input" data-spark-set-deep="extraApi.endpoint" value="${esc(settings.extraApi.endpoint)}" placeholder="https://api.openai.com или https://openrouter.ai/api">
        </label>
        <label class="spark-set-field">
            <span>API Key</span>
            <input type="password" class="spark-set-input" data-spark-set-deep="extraApi.apiKey" value="${esc(settings.extraApi.apiKey)}" placeholder="sk-...">
        </label>
        <div class="spark-set-row">
            <button class="spark-set-btn" data-spark-action="fetch-llm-models">Загрузить модели</button>
        </div>
        <label class="spark-set-field">
            <span>Модель</span>
            ${llmModelOptions}
        </label>
        <div class="spark-set-row">
            <label class="spark-set-field" style="flex:1">
                <span>temperature</span>
                <input type="number" step="0.1" min="0" max="2" class="spark-set-input" data-spark-set-deep="extraApi.temperature" value="${settings.extraApi.temperature}">
            </label>
            <label class="spark-set-field" style="flex:1">
                <span>max tokens</span>
                <input type="number" step="50" min="50" max="8000" class="spark-set-input" data-spark-set-deep="extraApi.maxTokens" value="${settings.extraApi.maxTokens}">
            </label>
        </div>

        <h3 class="spark-set-section">Image API (для аватарок) ${imgStatus}</h3>
        <label class="spark-set-field row">
            <input type="checkbox" data-spark-set="useSillyImagesConfig" ${settings.useSillyImagesConfig ? 'checked' : ''}>
            <span>Если поля ниже пусты — взять настройки из расширения <b>sillyimages</b></span>
        </label>
        <label class="spark-set-field">
            <span>Endpoint</span>
            <input type="text" class="spark-set-input" data-spark-set-deep="imageApi.endpoint" value="${esc(settings.imageApi.endpoint)}" placeholder="https://api.openai.com">
        </label>
        <label class="spark-set-field">
            <span>API Key</span>
            <input type="password" class="spark-set-input" data-spark-set-deep="imageApi.apiKey" value="${esc(settings.imageApi.apiKey)}" placeholder="sk-...">
        </label>
        <div class="spark-set-row">
            <button class="spark-set-btn" data-spark-action="fetch-img-models">Загрузить модели</button>
        </div>
        <label class="spark-set-field">
            <span>Модель</span>
            ${imgModelOptions}
        </label>
        <label class="spark-set-field">
            <span>Размер</span>
            <select class="spark-set-input" data-spark-set-deep="imageApi.size">
                ${['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'].map(sz => `<option value="${sz}" ${settings.imageApi.size === sz ? 'selected' : ''}>${sz}</option>`).join('')}
            </select>
        </label>

        <h3 class="spark-set-section">Промпты для картинок</h3>
        <div class="spark-set-hint">Применяется И к аватаркам, И к фото, которые шлют парни в чате. Пиши на английском (большинство моделей лучше понимает).</div>
        <label class="spark-set-field">
            <span>Префикс (стиль / качество)</span>
            <textarea class="spark-set-input" data-spark-set="imagePromptPrefix" rows="2" placeholder="напр. photorealistic, dating app selfie, natural lighting, sharp focus, dslr, 35mm">${esc(settings.imagePromptPrefix || '')}</textarea>
        </label>
        <label class="spark-set-field">
            <span>Суффикс (после описания)</span>
            <textarea class="spark-set-input" data-spark-set="imagePromptSuffix" rows="2" placeholder="напр. instagram aesthetic, soft skin, cinematic">${esc(settings.imagePromptSuffix || '')}</textarea>
        </label>
        <label class="spark-set-field">
            <span>Negative prompt (если API поддерживает)</span>
            <textarea class="spark-set-input" data-spark-set="imageNegativePrompt" rows="2" placeholder="напр. cartoon, anime, deformed, extra fingers, blurry, low quality, watermark">${esc(settings.imageNegativePrompt || '')}</textarea>
        </label>
        <label class="spark-set-field row">
            <input type="checkbox" data-spark-set="useAvatarAsRef" ${settings.useAvatarAsRef !== false ? 'checked' : ''}>
            <span>Использовать аватарку парня как референс при генерации фото в чате</span>
        </label>
        <div class="spark-set-hint">Если фото перестали генериться после включения — отключи. Не все модели/прокси умеют принимать reference image.</div>

        <h3 class="spark-set-section">Синхронизация с основным чатом</h3>
        <label class="spark-set-field row">
            <input type="checkbox" data-spark-set="injectIntoMain" ${settings.injectIntoMain ? 'checked' : ''}>
            <span>Подмешивать сводку Spark в чат с ботом</span>
        </label>
        <div class="spark-set-hint">Бот основного чата будет знать о матчах и переписках в Spark.</div>
        <label class="spark-set-field row">
            <input type="checkbox" data-spark-set="includePersonaDescription" ${settings.includePersonaDescription !== false ? 'checked' : ''}>
            <span>Передавать описание моей персоны парням (как анкету)</span>
        </label>
        <div class="spark-set-hint">Парни получат имя и описание твоей активной персоны ST — отвечают с учётом внешности/характера.</div>
        <button class="spark-set-btn small" data-spark-action="show-injection">Показать что отправляется</button>

        <h3 class="spark-set-section">Аватары парней</h3>
        <div class="spark-set-avatars">${avatarRows}</div>

        <h3 class="spark-set-section">Опасная зона</h3>
        <button class="spark-set-btn danger" data-spark-action="reset-state">Сбросить весь Spark в этом чате</button>
    </div>`, 'settings');
}

// ── Профиль парня ──
function viewProfile(boyId) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy) return viewMatches();
    const s = loadState();
    const msgs = s.messages[boyId] || [];
    const match = s.matches[boyId] || {};
    const tags = (boy.tags_ui || []).map(t => `<span class="spark-tag">${esc(t)}</span>`).join('');
    const statusLabel = match.status === 'matched' ? 'матч ✦' : match.status === 'cold_one_message' ? 'отвечает холодно' : match.status === 'matched_silent' ? 'молчит' : (match.status || '—');
    return shell(`
    <div class="spark-profile">
        <div class="spark-profile-header">
            <button class="spark-chat-back" data-spark-action="back-to-chat">${ICONS.back}</button>
            <span class="spark-profile-h-title">Анкета</span>
        </div>
        <div class="spark-profile-photo">${avatarHTML(boyId, boy, 'full')}
            <div class="spark-photo-overlay"></div>
            <div class="spark-name-row">
                <h2 class="spark-name">${esc(boy.name)}<span class="spark-age">, ${boy.age}</span></h2>
                <div class="spark-meta">${ICONS.pin} ${esc(boy.distance || '')}</div>
            </div>
        </div>
        <div class="spark-info">
            <p class="spark-bio">${esc(boy.bio || '')}</p>
            <div class="spark-tags">${tags}</div>
            ${boy.redflag ? `<div class="spark-redflag">${ICONS.warn}<span>${esc(boy.redflag)}</span></div>` : ''}
            <div class="spark-profile-stats">
                <div><b>Стиль письма:</b> ${esc(boy.writeStyle || '—')}</div>
                ${boy.styleNote ? `<div><b>Заметки:</b> ${esc(boy.styleNote)}</div>` : ''}
                <div><b>Сообщений в Spark:</b> ${msgs.length}</div>
                <div><b>Статус:</b> ${esc(statusLabel)}</div>
            </div>
            <div class="spark-profile-actions">
                <button class="spark-match-btn primary" data-spark-action="open-chat" data-spark-boy="${boyId}">Открыть чат</button>
                <button class="spark-match-btn secondary" data-spark-action="gen-avatar" data-spark-boy="${boyId}">Перегенерировать фото</button>
            </div>
        </div>
    </div>`, 'chat', 'spark-body-fill');
}

// ── Моя анкета ──
function viewMe() {
    const settings = getSettings();
    const profile = settings.profile || {};
    let personaName = 'User', personaDesc = '', avatarUrl = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        personaName = c.name1 || 'User';
        if (typeof c.substituteParams === 'function') {
            const sub = c.substituteParams('{{persona}}');
            if (sub && sub !== '{{persona}}') personaDesc = sub;
        }
        // Активная персона ST: filename в user_avatar (импортнут из script.js).
        // Путь: /thumbnail?type=persona&file=<file> (берёт из data/<user>/thumbnails/persona/).
        const avatarFile = (typeof user_avatar === 'string' && user_avatar) ? user_avatar : null;
        if (avatarFile) {
            avatarUrl = getThumbnailUrl('persona', avatarFile);
        }
    } catch (e) { console.warn('[Spark] viewMe avatar:', e); }
    const avatarBlock = avatarUrl
        ? `<div class="spark-me-avatar" style="background:#000 center/cover no-repeat url('${esc(avatarUrl)}')"></div>`
        : `<div class="spark-me-avatar spark-me-avatar-fallback">${esc((personaName || '?')[0])}</div>`;

    return shell(`
    <div class="spark-settings spark-me">
        <div class="spark-me-top">
            ${avatarBlock}
            <div class="spark-me-top-info">
                <div class="spark-me-name">${esc(personaName)}</div>
                <div class="spark-set-hint" style="margin:0">из активной персоны SillyTavern</div>
            </div>
        </div>

        <h3 class="spark-set-section">Описание (из персоны ST)</h3>
        <div class="spark-set-hint">Редактирует сразу описание активной персоны SillyTavern (тоже видно в User Settings &rarr; Persona).</div>
        <textarea class="spark-set-input spark-me-desc-edit" data-spark-persona-desc rows="6" placeholder="персона без описания. задай здесь или в ST → User Settings → Persona.">${esc(personaDesc || '')}</textarea>

        <h3 class="spark-set-section">Анкета в Spark</h3>
        <div class="spark-set-hint">Эти поля видят парни в дополнение к описанию персоны.</div>
        <label class="spark-set-field">
            <span>Возраст</span>
            <input type="text" class="spark-set-input" data-spark-set-deep="profile.ageMe" value="${esc(profile.ageMe || '')}" placeholder="напр. 24">
        </label>
        <label class="spark-set-field">
            <span>Кого / что ищу</span>
            <textarea class="spark-set-input" data-spark-set-deep="profile.lookingFor" rows="2" placeholder="напр. серьёзные отношения; дружбу; что-то лёгкое">${esc(profile.lookingFor || '')}</textarea>
        </label>
        <label class="spark-set-field">
            <span>Дополнительно о себе</span>
            <textarea class="spark-set-input" data-spark-set-deep="profile.extraBio" rows="3" placeholder="хобби, что цепляет, что бесит">${esc(profile.extraBio || '')}</textarea>
        </label>
    </div>`, 'me');
}

// ── Render ──
export function render() {
    const root = document.getElementById('spark-modal-body');
    if (!root) return;
    const s = loadState();
    let html;
    if (s.view === 'settings') html = viewSettings();
    else if (s.view === 'me') html = viewMe();
    else if (s.view === 'profile' && s.openChatBoy) html = viewProfile(s.openChatBoy);
    else if (s.view === 'chat' && s.openChatBoy) html = viewChat(s.openChatBoy);
    else if (s.view === 'matches') html = viewMatches();
    else if (s.view === 'match-screen' && s._pendingMatch) html = viewMatch(s._pendingMatch.boyId, s._pendingMatch.score);
    else html = viewSwipe();
    root.innerHTML = html;

    requestAnimationFrame(() => {
        const body = document.getElementById('spark-chat-body');
        if (body) body.scrollTop = body.scrollHeight;
    });
}

export function updateFabBadge() {
    const fab = document.getElementById('spark-fab');
    if (!fab) return;
    const s = loadState();
    const n = Object.values(s.matches || {}).filter(m => m.unread).length;
    let badge = fab.querySelector('.spark-fab-badge');
    if (n > 0) {
        if (!badge) { badge = document.createElement('div'); badge.className = 'spark-fab-badge'; fab.appendChild(badge); }
        badge.textContent = n > 9 ? '9+' : String(n);
    } else if (badge) badge.remove();
}

// ── Helpers ──
function fileToDataURL(file) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(file);
    });
}

function openImageZoom(src) {
    // Паттерн взят из sillyimages openFullscreenViewer:
    // 100vw/100vh, fit/zoom toggle по тапу, отдельный touchend на close с preventDefault.
    const old = document.getElementById('spark-fs-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div');
    overlay.id = 'spark-fs-overlay';
    overlay.className = 'spark-fs-fit';
    overlay.innerHTML = `
        <div class="spark-fs-scroll">
            <img src="${src}" class="spark-fs-image" alt="zoomed">
        </div>
        <button class="spark-fs-close" type="button" aria-label="закрыть">✕</button>
    `;
    const close = () => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', onKey);

    const img = overlay.querySelector('.spark-fs-image');
    img.addEventListener('click', (e) => {
        e.stopPropagation();
        overlay.classList.toggle('spark-fs-fit');
        overlay.classList.toggle('spark-fs-zoom');
    });

    overlay.addEventListener('click', (e) => {
        // клик мимо картинки и кнопки — закрыть
        if (e.target === overlay || e.target.classList.contains('spark-fs-scroll')) close();
    });

    const closeBtn = overlay.querySelector('.spark-fs-close');
    closeBtn.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); close(); });
    // На мобиле без этого кнопка не срабатывает (паттерн sillyimages)
    closeBtn.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); close(); });

    // Прямо в documentElement — чтобы transform на body не сломал position:fixed на мобиле.
    (document.documentElement || document.body).appendChild(overlay);
}

async function resizeImage(dataUrl, maxSize = 800) {
    return new Promise(resolve => {
        const img = new Image();
        img.onload = () => {
            let { width, height } = img;
            if (width > maxSize || height > maxSize) {
                if (width > height) { height = Math.round(height * maxSize / width); width = maxSize; }
                else { width = Math.round(width * maxSize / height); height = maxSize; }
            }
            const canvas = document.createElement('canvas');
            canvas.width = width; canvas.height = height;
            canvas.getContext('2d').drawImage(img, 0, 0, width, height);
            resolve(canvas.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => resolve(dataUrl);
        img.src = dataUrl;
    });
}

// Set deep value: "extraApi.endpoint" → settings.extraApi.endpoint
function setDeep(obj, path, value) {
    const parts = path.split('.');
    let cur = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] === undefined) cur[parts[i]] = {};
        cur = cur[parts[i]];
    }
    cur[parts[parts.length - 1]] = value;
}

// ── Action handler ──
export async function handleAction(action, boyId, evt) {
    const s = loadState();
    const ROSTER = getRoster();

    if (action === 'zoom-image') {
        const el = evt?.target?.closest?.('[data-spark-src]');
        const src = el?.getAttribute('data-spark-src');
        if (src) openImageZoom(src);
        return;
    }

    if (action === 'pass') {
        if (!boyId || !ROSTER[boyId]) return;
        const boy = ROSTER[boyId];
        setMatch(boyId, 'passed');
        Object.entries(boy.tags || {}).forEach(([t, w]) => { if (w > 0) bumpVibe(t, -0.3); });
        s.currentBoy = null; s.view = 'swipe'; save();
        render(); syncToMainChat();
    }
    else if (action === 'like' || action === 'super') {
        if (!boyId || !ROSTER[boyId]) return;
        const boy = ROSTER[boyId];
        const score = matchScore(boyId, action);
        Object.entries(boy.tags || {}).forEach(([t, w]) => bumpVibe(t, w * 0.4 * (action === 'super' ? 2 : 1)));
        if (isMatch(score)) {
            setMatch(boyId, 'matched');
            s._pendingMatch = { boyId, score };
            s.view = 'match-screen'; save(); render();
            try {
                const n = await generateFirstMessage(boyId);
                console.log('[Spark] first message:', n, 'parts');
                if (n > 0) updateFabBadge();
            } catch (e) { console.error('[Spark] first message failed:', e); }
        } else {
            const roll = Math.random();
            if (roll < 0.5) setMatch(boyId, 'no_response');
            else if (roll < 0.8) {
                setMatch(boyId, 'cold_one_message');
                try { await generateBoyReply(boyId); } catch (e) { console.error(e); }
            } else setMatch(boyId, 'matched_silent');
            s.currentBoy = null; s.view = 'swipe'; save();
            render(); updateFabBadge(); syncToMainChat();
        }
    }
    else if (action === 'continue') {
        delete s._pendingMatch;
        s.currentBoy = null; s.view = 'swipe'; save();
        render();
    }
    else if (action === 'open-chat') {
        if (!boyId) return;
        markRead(boyId);
        s.view = 'chat'; s.openChatBoy = boyId; save();
        render(); updateFabBadge();
    }
    else if (action === 'view-matches') { s.view = 'matches'; s.openChatBoy = null; delete s._pendingMatch; save(); render(); }
    else if (action === 'view-swipe')   { s.view = 'swipe';   s.openChatBoy = null; delete s._pendingMatch; save(); render(); }
    else if (action === 'view-settings'){ s.view = 'settings'; save(); render(); }
    else if (action === 'view-me')      { s.view = 'me'; save(); render(); }
    else if (action === 'view-profile') {
        if (!boyId) return;
        s.view = 'profile'; s.openChatBoy = boyId; save(); render();
    }
    else if (action === 'back-to-chat') {
        if (s.openChatBoy) { s.view = 'chat'; save(); render(); }
        else { s.view = 'matches'; save(); render(); }
    }
    else if (action === 'regen-image') {
        if (!boyId) return;
        const el = evt?.target?.closest?.('[data-spark-msgts]');
        const ts = el?.getAttribute('data-spark-msgts');
        if (!ts) return;
        try { await regenerateChatImage(boyId, ts); }
        catch (e) { console.error('[Spark] regen-image failed:', e); }
    }
    else if (action === 'send-msg') {
        if (evt) evt.preventDefault();
        if (!boyId) return;
        const form = evt?.target?.closest?.('form');
        const input = form?.querySelector('.spark-chat-field');
        const text = input?.value?.trim();
        if (!text) return;
        input.value = '';
        pushMessage(boyId, { from: 'user', text });
        s.__typing = boyId; save();
        render();
        try {
            const n = await generateBoyReply(boyId);
            console.log('[Spark] reply parts:', n);
        } catch (e) { console.error('[Spark] reply failed:', e); }
        s.__typing = null; save();
        render();
    }
    else if (action === 'close-app') {
        const modal = document.getElementById('spark-modal');
        if (modal) modal.classList.remove('open');
    }
    else if (action === 'reload-roster') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = 'Загрузка...'; }
        try { const n = await reloadRoster(); alert(`Загружено парней: ${n}`); }
        catch (e) { alert('Ошибка: ' + e.message); console.error(e); }
        render();
    }
    else if (action === 'fetch-llm-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const settings = getSettings();
            const models = await fetchModels(settings.extraApi.endpoint, settings.extraApi.apiKey);
            window.__sparkLlmModels = models;
            console.log('[Spark] LLM models:', models);
            render();
        } catch (e) { alert('Не удалось загрузить модели: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; } }
    }
    else if (action === 'fetch-img-models') {
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const settings = getSettings();
            const models = await fetchModels(settings.imageApi.endpoint, settings.imageApi.apiKey);
            window.__sparkImgModels = models;
            render();
        } catch (e) { alert('Не удалось загрузить модели: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Загрузить модели'; } }
    }
    else if (action === 'gen-avatar') {
        if (!boyId) return;
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try {
            const url = await generateAvatar(boyId);
            setCustomAvatar(boyId, url);
            saveSettings();
            render();
        } catch (e) { alert('Не удалось: ' + e.message); console.error(e); if (btn) { btn.disabled = false; btn.textContent = 'Generate'; } }
    }
    else if (action === 'regen-card') {
        if (!boyId) return;
        const btn = evt?.target?.closest?.('button');
        if (btn) { btn.disabled = true; btn.textContent = '...'; }
        try { await regenerateBoyCard(boyId); render(); }
        catch (e) { alert('Ошибка: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = '⟳'; } }
    }
    else if (action === 'clear-avatar') {
        if (!boyId) return;
        clearCustomAvatar(boyId); saveSettings(); render();
    }
    else if (action === 'show-injection') {
        const data = debugSparkInjection();
        alert('Что Spark передаёт основному боту (см. также консоль F12):\n\n' + JSON.stringify(data, null, 2));
    }
    else if (action === 'reset-state') {
        if (!confirm('Сбросить все матчи, переписки и vibe в этом чате?')) return;
        resetState(); syncToMainChat(); render(); updateFabBadge();
    }
}

export async function handleFileInput(input) {
    if (input.dataset.sparkImageInput) {
        const boyId = input.dataset.sparkImageInput;
        const file = input.files?.[0]; if (!file) return;
        const dataUrl = await fileToDataURL(file);
        const small = await resizeImage(dataUrl);
        pushMessage(boyId, { from: 'user', image: small, text: '' });
        const s = loadState();
        s.__typing = boyId; save();
        render();
        try { await generateBoyReply(boyId); } catch (e) { console.error(e); }
        s.__typing = null; save();
        render();
    }
    else if (input.dataset.sparkAvatarUpload) {
        const boyId = input.dataset.sparkAvatarUpload;
        const file = input.files?.[0]; if (!file) return;
        const dataUrl = await fileToDataURL(file);
        // 1024px — чтобы аватарка работала как полноценный character reference
        // в Gemini/nano-banana (sillyimages шлёт оригинал с диска ST такого же размера).
        // Маленькие refs <= 400px часто триггерят IMAGE_OTHER refusal на прокси.
        const small = await resizeImage(dataUrl, 1024);
        setCustomAvatar(boyId, small); saveSettings(); render();
    }
}

export function handleSettingChange(input) {
    const settings = getSettings();
    if (input.dataset.sparkSet) {
        const k = input.dataset.sparkSet;
        if (input.type === 'checkbox') settings[k] = input.checked;
        else if (input.type === 'number') settings[k] = Number(input.value) || 0;
        else settings[k] = input.value;
        saveSettings();
        if (k === 'injectIntoMain') syncToMainChat();
        // если изменился источник ростера — перерендерить настройки чтобы показать/скрыть поле имени
        if (k === 'rosterSource') render();
    } else if (input.dataset.sparkSetDeep) {
        const path = input.dataset.sparkSetDeep;
        const val = input.type === 'checkbox' ? input.checked
                  : input.type === 'number' ? (Number(input.value) || 0)
                  : input.value;
        setDeep(settings, path, val);
        saveSettings();
    }
}

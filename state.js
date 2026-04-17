// ═══════════════════════════════════════════
// STATE — per-chat через chat_metadata + глобальные настройки
// ═══════════════════════════════════════════

import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { chat_metadata, saveSettingsDebounced } from '../../../../script.js';

export const EXT_NAME = 'spark-dating';
const META_KEY = 'spark';

// ── Глобальные настройки расширения ──
const defaultSettings = () => ({
    // Источник ростера
    rosterSource: 'chat-lorebook',  // 'built-in' | 'chat-lorebook' | 'named-lorebook'
    lorebookName: '',

    // Extra LLM API (независимый, ВСЕ запросы Spark идут сюда)
    extraApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        temperature: 0.9,
        maxTokens: 800,
    },

    // Image API
    imageApi: {
        endpoint: '',
        apiKey: '',
        model: '',
        size: '1024x1024',
    },
    useSillyImagesConfig: true,     // если imageApi не заполнен — взять из sillyimages

    // Шаблоны промптов для картинок (применяются И к аватаркам, И к inline-фото от парней)
    imagePromptPrefix: '',          // вставляется ПЕРЕД промптом (стиль, качество)
    imagePromptSuffix: '',          // вставляется ПОСЛЕ промпта (negative-подобное, формат)
    imageNegativePrompt: '',        // отправляется как negative_prompt если API поддерживает

    // Синк с основным чатом
    injectIntoMain: true,
    injectDepth: 4,

    // Передавать описание персоны парням (как карточку «о собеседнице»)
    includePersonaDescription: true,

    avatars: {},                    // {boyId: dataURL}
    fabPosition: { right: 20, bottom: 90 },
});

export function getSettings() {
    if (!extension_settings[EXT_NAME]) {
        extension_settings[EXT_NAME] = defaultSettings();
    } else {
        const def = defaultSettings();
        for (const k in def) {
            if (extension_settings[EXT_NAME][k] === undefined) {
                extension_settings[EXT_NAME][k] = def[k];
            } else if (typeof def[k] === 'object' && def[k] && !Array.isArray(def[k])) {
                for (const k2 in def[k]) {
                    if (extension_settings[EXT_NAME][k][k2] === undefined) {
                        extension_settings[EXT_NAME][k][k2] = def[k][k2];
                    }
                }
            }
        }
    }
    return extension_settings[EXT_NAME];
}

export const saveSettings = () => saveSettingsDebounced();

// ── Per-chat состояние ──
const defaultChatState = () => ({
    vibe: {},
    matches: {},
    swipedIds: [],
    messages: {},
    currentBoy: null,
    view: 'swipe',
    openChatBoy: null,
    boyMeta: {},        // кэш сгенерированных карточек: { boyId: {tags, writeStyle, styleNote, imagePrompt, age, ...} }
});

export function loadState() {
    if (!chat_metadata[META_KEY]) {
        chat_metadata[META_KEY] = defaultChatState();
    } else {
        const def = defaultChatState();
        for (const k in def) if (chat_metadata[META_KEY][k] === undefined) chat_metadata[META_KEY][k] = def[k];
    }
    return chat_metadata[META_KEY];
}

export const save = () => saveMetadataDebounced();

export function bumpVibe(tag, delta) {
    const s = loadState();
    s.vibe[tag] = (s.vibe[tag] || 0) + delta;
    save();
}

export function setMatch(boyId, status) {
    const s = loadState();
    s.matches[boyId] = { status, timestamp: Date.now(), unread: status === 'matched' };
    if (!s.swipedIds.includes(boyId)) s.swipedIds.push(boyId);
    save();
}

export function getNextBoy(order) {
    const s = loadState();
    return order.find(id => !s.swipedIds.includes(id));
}

export function pushMessage(boyId, msg) {
    const s = loadState();
    if (!s.messages[boyId]) s.messages[boyId] = [];
    s.messages[boyId].push({ ts: Date.now(), ...msg });
    save();
}

export function markRead(boyId) {
    const s = loadState();
    if (s.matches[boyId]) { s.matches[boyId].unread = false; save(); }
}

export function resetState() {
    chat_metadata[META_KEY] = defaultChatState();
    save();
}

export function setBoyMeta(boyId, meta) {
    const s = loadState();
    if (!s.boyMeta) s.boyMeta = {};
    s.boyMeta[boyId] = { ...(s.boyMeta[boyId] || {}), ...meta };
    save();
}

export function getBoyMeta(boyId) {
    const s = loadState();
    return s.boyMeta?.[boyId] || null;
}

// ═══════════════════════════════════════════
// ROSTER — источники: built-in / chat-lorebook / named-lorebook
// + автогенерация карточек через extra API
// ═══════════════════════════════════════════

import { extension_settings } from '../../../extensions.js';
import { chat_metadata } from '../../../../script.js';
import { EXT_NAME, getSettings, getBoyMeta, setBoyMeta } from './state.js';
import { callExtraLLM, isExtraLLMConfigured } from './api.js';

// Палитра градиентов для placeholder-аватаров
const GRADIENTS = [
    'linear-gradient(135deg,#f4a261,#e76f51)',
    'linear-gradient(135deg,#8d99ae,#2b2d42)',
    'linear-gradient(135deg,#2d0b3d,#0a0a0a)',
    'linear-gradient(135deg,#6b705c,#2f3e46)',
    'linear-gradient(135deg,#3c096c,#10002b)',
    'linear-gradient(135deg,#1a1a1a,#000)',
    'linear-gradient(135deg,#264653,#2a9d8f)',
    'linear-gradient(135deg,#9d0208,#370617)',
    'linear-gradient(135deg,#7209b7,#3a0ca3)',
    'linear-gradient(135deg,#003049,#d62828)',
];
const gradientFor = (id) => {
    let h = 0;
    for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return GRADIENTS[h % GRADIENTS.length];
};

// ── Минимальный встроенный ростер (если выбран built-in или лорбук пустой) ──
export const BUILT_IN_ROSTER = {
    artyom: {
        name: 'Артём', age: 28, distance: '1.2 км',
        bio: 'Пеку хлеб, читаю Олди, ищу человека для долгого разговора и совместного утреннего кофе.',
        tags_ui: ['серьёзные отношения', 'готовка', 'книги'],
        redflag: '«без игр» в био — может читаться как тревожно-привязанный.',
        tags: { comfort: 3, soft: 2, monogamy: 2, casual: -2, dom: -2 },
        writeStyle: 'eager_burst',
        styleNote: 'Отвечает мгновенно, 2-3 длинных тёплых сообщения подряд. Эмодзи редко но искренне. Anxious-attached.',
        imagePrompt: 'warm 28yo man, hazel eyes, messy dark blond hair, soft smile, in artisan bakery, photorealistic',
    },
    yura: {
        name: 'Юра', age: 24, distance: '2 км',
        bio: 'пишу стихи, варю кофе, влюбляюсь чаще чем стоило бы.',
        tags_ui: ['поэзия', 'кофе', 'музыка'],
        redflag: 'idealize-devalue паттерн на горизонте.',
        tags: { intensity: 2, art: 2, vulnerability: 3, stability: -3 },
        writeStyle: 'three_then_delete',
        styleNote: 'Шлёт 2-3 коротких сообщения подряд, иногда одно удаляет — оборачивай в [DELETED]текст[/DELETED].',
        imagePrompt: '24yo man, soft features, long lashes, hazel eyes, lip ring, oversized sweater, melancholic, photorealistic',
    },
};

// Стили письма (фиксированный набор, из которого LLM выбирает при автогенерации)
const WRITE_STYLES = [
    'eager_burst',          // быстро, длинно, тепло, anxious
    'minimal_cold',         // редко, сухо, 3-5 слов
    'charming_then_ghost',  // огненно сначала, потом холодеет
    'evening_thoughtful',   // только вечером, длинно, литературно
    'three_then_delete',    // 2-3 коротких, иногда удаляет
    'pause_then_command',   // долгая пауза, потом приказ
];

let CURRENT_ROSTER = {};
let CURRENT_ORDER = [];

export const getRoster = () => CURRENT_ROSTER;
export const getSwipeOrder = () => CURRENT_ORDER;

// ── Загрузка World Info ──
async function loadWorldInfoSafe(name) {
    if (!name) return null;
    try {
        const wi = await import('../../../world-info.js');
        return await wi.loadWorldInfo(name);
    } catch (e) {
        console.error('[Spark] loadWorldInfo failed:', e);
        return null;
    }
}

// Имя лорбука: сначала привязанный к чату (значок книги в чате),
// потом primary lorebook персонажа (поле World в карточке).
function getChatLorebookName() {
    // 1. Chat-bound lorebook — ST хранит его в chat_metadata по ключу 'world_info'.
    const chatLb = chat_metadata?.['world_info'];
    if (chatLb) return chatLb;

    // 2. Primary character lorebook — character.data.extensions.world.
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const charId = c.characterId;
        const chars = c.characters;
        if (chars && charId != null) {
            const charLb = chars[charId]?.data?.extensions?.world;
            if (charLb) return charLb;
        }
    } catch (e) { /* ignore */ }

    return null;
}

// ── Парсим entry лорбука в "сырого" парня ──
function entryToBoy(entry, idx) {
    // Имя: comment > первая строка content > "Парень N"
    let name = (entry.comment || '').trim();
    const content = String(entry.content || '').trim();
    if (!name) {
        const firstLine = content.split('\n')[0].trim();
        name = firstLine.length < 50 ? firstLine : `Парень ${idx + 1}`;
    }
    const keys = Array.isArray(entry.key) ? entry.key.filter(Boolean) : [];
    // Берём content как сырое описание (для LLM-генерации карточки)
    const id = `lb_${entry.uid ?? idx}_${name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '').slice(0, 12)}`;
    return {
        id, name,
        rawDescription: content,
        rawKeys: keys,
        rawComment: (entry.comment || '').trim(),
        _gradient: gradientFor(id),
        _initial: name[0] || '?',
    };
}

// ── LLM-генерация карточки парня по сырому описанию ──
async function generateBoyCard(rawBoy) {
    if (!isExtraLLMConfigured()) {
        // fallback: эвристика по тексту
        return heuristicCard(rawBoy);
    }
    const desc = (rawBoy.rawDescription || '').trim();
    if (!desc) {
        console.warn('[Spark] ⚠ У парня', rawBoy.name, 'пустое описание в лорбуке — карточка будет сгенерирована «из головы». Заполни поле Content в записи лорбука.');
    }
    console.log('[Spark] Генерирую карточку:', rawBoy.name, `(описание ${desc.length} симв.)`);

    const keysLine = rawBoy.rawKeys?.length ? `\nКЛЮЧИ/ТРИГГЕРЫ ЛОРБУКА: ${rawBoy.rawKeys.join(', ')}` : '';
    const prompt = `Проанализируй описание персонажа из лорбука SillyTavern и заполни карточку для dating-app симулятора. КАЖДЫЙ персонаж должен быть УНИКАЛЬНЫМ — не скатывайся в «айтишник / книги / кофе». Используй конкретные детали из описания.

ИМЯ: ${rawBoy.name}${keysLine}

ОПИСАНИЕ (из поля Content лорбука):
${desc || '(ПУСТО — опирайся только на имя и ключи, будь креативен и конкретен)'}

Верни ТОЛЬКО валидный JSON без markdown, без комментариев, без \`\`\`. Структура:
{
  "age": число от 18 до 60,
  "distance": "X км" (1-15),
  "bio": "краткое био от первого лица для анкеты, 1-2 предложения. Должно звучать как у ЭТОГО КОНКРЕТНОГО парня — используй его профессию/хобби/странности из описания",
  "tags_ui": ["тег1","тег2","тег3"] (3-5 видимых тегов на русском — отражают именно ЭТОГО парня, не generic),
  "redflag": "одно предложение о потенциальном красном флаге, видимом на анкете",
  "tags": {"тег": число от -3 до 3, ...} (5-8 скрытых тегов для скоринга совместимости, английские короткие ключи: comfort, soft, monogamy, casual, dom, sub, control, intensity, art, vulnerability, stability, mature, experienced, danger, ritual, marks, cruelty и т.п.),
  "writeStyle": один из ${JSON.stringify(WRITE_STYLES)},
  "styleNote": "1-2 предложения как именно он пишет в чате (объём, темп, эмодзи, тон) — ИНДИВИДУАЛЬНО под него",
  "imagePrompt": "английский промпт для image-gen модели, 15-25 слов, описывает ВНЕШНОСТЬ именно этого парня из описания, для dating-app фото"
}`;

    try {
        const raw = await callExtraLLM(prompt, { temperature: 0.95, maxTokens: 700 });
        // снимаем code fence и думалки
        let txt = String(raw).replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?<\/\1>/gi, '');
        txt = txt.replace(/```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
        const m = txt.match(/\{[\s\S]*\}/);
        if (!m) throw new Error('JSON не найден в ответе');
        const card = JSON.parse(m[0]);
        return normalizeCard(card);
    } catch (e) {
        console.warn('[Spark] LLM generation failed, using heuristic:', e.message);
        return heuristicCard(rawBoy);
    }
}

function normalizeCard(card) {
    return {
        age: Number(card.age) || 25,
        distance: String(card.distance || '3 км'),
        bio: String(card.bio || ''),
        tags_ui: Array.isArray(card.tags_ui) ? card.tags_ui.slice(0, 6) : [],
        redflag: String(card.redflag || ''),
        tags: typeof card.tags === 'object' && card.tags ? card.tags : {},
        writeStyle: WRITE_STYLES.includes(card.writeStyle) ? card.writeStyle : 'eager_burst',
        styleNote: String(card.styleNote || ''),
        imagePrompt: String(card.imagePrompt || ''),
    };
}

function heuristicCard(rawBoy) {
    const desc = (rawBoy.rawDescription || '').toLowerCase();
    const tags = {};
    const tags_ui = [];
    const matches = (re, t, ui, w) => { if (re.test(desc)) { tags[t] = (tags[t] || 0) + w; if (ui && !tags_ui.includes(ui)) tags_ui.push(ui); } };
    matches(/тат|tattoo/, 'marks', 'тату', 2);
    matches(/доминант|dom\b/, 'dom', 'власть', 2);
    matches(/нежн|soft|мягк/, 'soft', 'нежность', 2);
    matches(/серьёз|serious|brak/, 'monogamy', 'серьёзные отношения', 2);
    matches(/секс|sex|без обяз|casual/, 'casual', 'без обязательств', 2);
    matches(/книг|book|читa/, 'art', 'книги', 1);
    matches(/музык|music/, 'art', 'музыка', 1);
    matches(/готов|cook|пек/, 'comfort', 'готовка', 1);
    if (!tags_ui.length) tags_ui.push('загадочный');
    return {
        age: 25 + Math.floor(Math.random() * 15),
        distance: `${(Math.random() * 10 + 1).toFixed(1)} км`,
        bio: (rawBoy.rawDescription || '').slice(0, 140) || 'Просто живу.',
        tags_ui,
        redflag: 'Карточка собрана автоматически без LLM — детали могут быть неточны.',
        tags,
        writeStyle: 'eager_burst',
        styleNote: 'Пишет в обычном темпе, без особенностей.',
        imagePrompt: `${rawBoy.name}, photorealistic dating app photo, casual portrait`,
    };
}

// ── Главный загрузчик ──
export async function reloadRoster() {
    const settings = getSettings();
    const newRoster = {};
    const newOrder = [];

    if (settings.rosterSource === 'built-in') {
        for (const [id, b] of Object.entries(BUILT_IN_ROSTER)) {
            newRoster[id] = { ...b, _gradient: gradientFor(id), _initial: b.name[0] };
            newOrder.push(id);
        }
    } else {
        const lbName = settings.rosterSource === 'chat-lorebook'
            ? getChatLorebookName()
            : settings.lorebookName;

        if (!lbName) {
            console.warn('[Spark] Лорбук не найден ни в чате (значок книги), ни в карточке персонажа (поле World). Подключи лорбук или выбери источник built-in.');
        } else {
            const data = await loadWorldInfoSafe(lbName);
            if (!data || !data.entries) {
                console.warn('[Spark] Лорбук не найден:', lbName);
            } else {
                const entries = Object.values(data.entries).filter(e => !e.disable);
                console.log(`[Spark] Лорбук "${lbName}": ${entries.length} записей`);

                for (let i = 0; i < entries.length; i++) {
                    const raw = entryToBoy(entries[i], i);
                    let meta = getBoyMeta(raw.id);
                    if (!meta) {
                        console.log('[Spark] Генерирую карточку для', raw.name);
                        meta = await generateBoyCard(raw);
                        setBoyMeta(raw.id, meta);
                    }
                    newRoster[raw.id] = {
                        ...meta,
                        name: raw.name,
                        _gradient: raw._gradient,
                        _initial: raw._initial,
                        _rawDescription: raw.rawDescription,
                        _rawKeys: raw.rawKeys,
                        _lorebookName: lbName,
                    };
                    newOrder.push(raw.id);
                }
            }
        }

        // если ничего не получилось — fallback на built-in
        if (!newOrder.length) {
            for (const [id, b] of Object.entries(BUILT_IN_ROSTER)) {
                newRoster[id] = { ...b, _gradient: gradientFor(id), _initial: b.name[0] };
                newOrder.push(id);
            }
        }
    }

    CURRENT_ROSTER = newRoster;
    CURRENT_ORDER = newOrder;
    console.log(`[Spark] Ростер обновлён: ${newOrder.length} парней`, newOrder);
    return newOrder.length;
}

// ── Кастомные аватары (глобальные) ──
export function getCustomAvatar(boyId) {
    return extension_settings?.[EXT_NAME]?.avatars?.[boyId] || null;
}
export function setCustomAvatar(boyId, dataUrl) {
    if (!extension_settings[EXT_NAME]) extension_settings[EXT_NAME] = {};
    if (!extension_settings[EXT_NAME].avatars) extension_settings[EXT_NAME].avatars = {};
    extension_settings[EXT_NAME].avatars[boyId] = dataUrl;
}
export function clearCustomAvatar(boyId) {
    if (extension_settings?.[EXT_NAME]?.avatars) delete extension_settings[EXT_NAME].avatars[boyId];
}

// Принудительная перегенерация карточки. Перечитываем запись из лорбука заново
// (чтобы не полагаться на кэш, который мог устареть или быть пустым).
export async function regenerateBoyCard(boyId) {
    const boy = CURRENT_ROSTER[boyId];
    if (!boy) throw new Error('boy not found');

    // Попытаемся взять свежие данные из лорбука (если парень из лорбука)
    let rawDescription = boy._rawDescription || '';
    let rawKeys = boy._rawKeys || [];
    if (boy._lorebookName) {
        const data = await loadWorldInfoSafe(boy._lorebookName);
        if (data?.entries) {
            // ищем запись по comment === boy.name или по первой строке content
            const entries = Object.values(data.entries).filter(e => !e.disable);
            const match = entries.find(e => (e.comment || '').trim() === boy.name)
                || entries.find(e => String(e.content || '').split('\n')[0].trim() === boy.name);
            if (match) {
                rawDescription = String(match.content || '').trim();
                rawKeys = Array.isArray(match.key) ? match.key.filter(Boolean) : [];
                console.log('[Spark] regen: перечитал из лорбука', boy.name, `(${rawDescription.length} симв.)`);
            }
        }
    }

    const meta = await generateBoyCard({ name: boy.name, rawDescription, rawKeys });
    setBoyMeta(boyId, meta);
    Object.assign(boy, meta);
    boy._rawDescription = rawDescription;
    boy._rawKeys = rawKeys;
    return meta;
}

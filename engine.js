// ═══════════════════════════════════════════
// ENGINE — генерация ответов парней + инжект в основной чат
// ВСЕ запросы LLM идут через extra API (api.js).
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types } from '../../../../script.js';
import { getRoster } from './roster.js';
import { loadState, pushMessage, getSettings, save } from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImage, generateImageViaSD, isImageApiConfigured } from './api.js';

const PROMPT_KEY = 'SPARK_DATING_APP';

// ── Инфо о текущей персоне пользователя (как в основной Таверне) ──
function getUserPersona() {
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const pu = c.powerUserSettings || {};
        const name = c.name1 || 'User';
        // Активный аватар персоны: ST хранит его в user_avatar (personas.js), но через context
        // единственный надёжный путь — substituteParams({{persona}}).
        let description = '';
        if (typeof c.substituteParams === 'function') {
            const sub = c.substituteParams('{{persona}}');
            if (sub && sub !== '{{persona}}') description = sub;
        }
        // Fallback: найти описание по имени персоны
        if (!description && pu.personas && pu.persona_descriptions) {
            const avatarId = Object.keys(pu.personas).find(a => pu.personas[a] === name);
            if (avatarId) description = pu.persona_descriptions[avatarId]?.description || '';
        }
        return { name, description: (description || '').trim() };
    } catch (e) {
        return { name: 'User', description: '' };
    }
}

// Обновить уже сохранённое сообщение по _genId (нужно потому что pushMessage делает копию через spread).
function updateGeneratedImage(boyId, genId, patch) {
    const s = loadState();
    const list = s.messages?.[boyId];
    if (!list) return;
    const msg = list.find(m => m && m._genId === genId);
    if (!msg) return;
    Object.assign(msg, patch);
    save();
    window.dispatchEvent(new CustomEvent('spark:rerender', { detail: { boyId } }));
}

function cleanLLMOutput(text) {
    if (!text) return '';
    let t = String(text);
    t = t.replace(/<(think|thinking|reasoning|analysis|reflection)[^>]*>[\s\S]*?<\/\1>/gi, '');
    t = t.replace(/<(think|thinking|reasoning)[^>]*>[\s\S]*?(?=\n\n|$)/gi, '');
    t = t.replace(/```(?:think|thinking|reasoning)[\s\S]*?```/gi, '');
    t = t.replace(/\[(?:THINK|THINKING|REASONING)\][\s\S]*?\[\/(?:THINK|THINKING|REASONING)\]/gi, '');
    t = t.replace(/^[А-ЯЁA-Z][а-яёa-zA-Z]+\s*:\s*/, '');
    return t.trim();
}

// ── Генерация ответа парня ──
export async function generateBoyReply(boyId) {
    if (!isExtraLLMConfigured()) {
        console.warn('[Spark] Extra API не настроен — сгенерировать ответ нельзя. Открой настройки Spark.');
        return 0;
    }
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy) return 0;
    const s = loadState();
    const history = (s.messages[boyId] || []).slice(-20);

    const persona = getUserPersona();
    const userLabel = persona.name || 'Она';

    const historyText = history.map(m => {
        const who = m.from === 'user' ? userLabel : boy.name;
        const flag = m.deleted ? ' [потом удалил]' : '';
        const img = m.image ? ' [прислала фото]' : '';
        return `${who}: ${m.text || ''}${img}${flag}`;
    }).join('\n');

    const settings = getSettings();
    const includePersonaDesc = settings.includePersonaDescription !== false; // по умолчанию включено
    const personaBlock = (includePersonaDesc && persona.description)
        ? `\nО СОБЕСЕДНИЦЕ (${userLabel}) — её анкета в Spark:\n${persona.description}\n`
        : '';

    const prompt = `Ты отыгрываешь ${boy.name} в dating-app Spark. Отвечай СТРОГО по карточке, без smoothing характера.

КАРТОЧКА:
Имя: ${boy.name}, ${boy.age} лет
Био: ${boy.bio}
Стиль письма: ${boy.writeStyle} — ${boy.styleNote || ''}
Внешность (для фото): ${boy.imagePrompt || '(не задано)'}
${personaBlock}
ИСТОРИЯ ПЕРЕПИСКИ:
${historyText || `(ещё не переписывались — это твоё первое сообщение после матча в Spark с ${userLabel})`}

ЗАДАЧА: Напиши следующее сообщение(я) от лица ${boy.name}. Следуй стилю письма дословно (объём, тон, темп, эмодзи). Если по стилю он шлёт несколько сообщений подряд — раздели через двойной перенос строки. Если одно удаляет — оберни в [DELETED]текст[/DELETED].

ФОТО: если по сюжету уместно прислать фото (селфи, что-то из жизни, показать что делает) — добавь ОТДЕЛЬНЫМ сообщением тег [IMG:английское описание фото]. Используй РЕДКО (примерно 1 раз на 8-15 сообщений), только когда это органично для ${boy.name}. Описание короткое (10-20 слов), на английском, в стиле dating-app фото.

ВАЖНО: ответ только текст сообщения(й). Без <think>, без reasoning, без комментариев, без «${boy.name}:», без markdown.`;

    let raw;
    try {
        raw = await callExtraLLM(prompt);
    } catch (e) {
        console.error('[Spark] Extra API failed:', e);
        return 0;
    }
    const result = cleanLLMOutput(raw);
    if (!result) {
        console.warn('[Spark] LLM вернул пусто для', boyId);
        return 0;
    }

    const parts = result.split(/\n\n+/).map(p => p.trim()).filter(Boolean);
    let pushed = 0;
    for (const part of parts) {
        const del = part.match(/^\[DELETED\]([\s\S]+?)\[\/DELETED\]$/i);
        if (del) {
            pushMessage(boyId, { from: 'boy', text: del[1].trim(), deleted: true });
            pushed++;
            continue;
        }
        // Извлекаем все [IMG:...] теги — каждый превращается в отдельное фото-сообщение.
        // Поддерживаем и [IMG:GEN:{json}] (формат sillyimages) и [IMG:plain prompt].
        const imgRegex = /\[IMG:(GEN:)?([^\]]+)\]/gi;
        const imgMatches = [...part.matchAll(imgRegex)];
        const cleanText = part.replace(imgRegex, '').trim();
        if (cleanText) {
            pushMessage(boyId, { from: 'boy', text: cleanText });
            pushed++;
        }
        for (const m of imgMatches) {
            let imgPrompt = m[2].trim();
            // Если это GEN-формат с JSON — вытащим prompt из json
            if (m[1]) {
                try {
                    const j = JSON.parse(m[2]);
                    imgPrompt = [j.style, j.prompt].filter(Boolean).join(' ') || imgPrompt;
                } catch { /* оставляем raw */ }
            }
            // Уникальный id, чтобы найти и обновить сообщение в state после async-генерации
            const genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            pushMessage(boyId, { from: 'boy', text: '', image: '', _generating: true, _imgPrompt: imgPrompt, _genId: genId });
            pushed++;
            // Захватываем boyId+genId в замыкание
            (async () => {
                try {
                    const dataUrl = await generateImage(imgPrompt);
                    updateGeneratedImage(boyId, genId, { image: dataUrl, _generating: false });
                } catch (err) {
                    console.warn('[Spark] inline image failed:', err);
                    updateGeneratedImage(boyId, genId, { image: '', text: `[фото не загрузилось: ${String(err.message || err).slice(0, 80)}]`, _generating: false });
                }
            })();
        }
    }
    syncToMainChat();
    return pushed;
}

export async function generateFirstMessage(boyId) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy) return 0;
    if (boy.writeStyle === 'minimal_cold' || boy.writeStyle === 'pause_then_command') return 0;
    return generateBoyReply(boyId);
}

// ── Аватар: пробуем image API, потом /sd ──
export async function generateAvatar(boyId) {
    const ROSTER = getRoster();
    const boy = ROSTER[boyId];
    if (!boy?.imagePrompt) throw new Error('у парня нет imagePrompt');
    if (isImageApiConfigured()) {
        return await generateImage(boy.imagePrompt);
    }
    return await generateImageViaSD(boy.imagePrompt);
}

// ── Сводка для основного чата ST ──
export function syncToMainChat() {
    const settings = getSettings();
    if (!settings.injectIntoMain) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return;
    }
    const ROSTER = getRoster();
    const s = loadState();

    const matches = Object.entries(s.matches).filter(([_, m]) => ['matched', 'cold_one_message', 'matched_silent'].includes(m.status));
    if (!matches.length && !Object.keys(s.messages).length) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return;
    }

    const lines = [];
    lines.push('[SPARK APP STATE — что {{user}} делает в приложении знакомств Spark прямо сейчас. Можешь ссылаться на это естественно если разговор зайдёт.]');

    if (matches.length) {
        lines.push('Матчи:');
        for (const [id, m] of matches) {
            const b = ROSTER[id]; if (!b) continue;
            const msgs = s.messages[id] || [];
            const lastMsg = msgs[msgs.length - 1];
            const status = m.status === 'matched' ? 'переписываются' : m.status === 'cold_one_message' ? 'он отвечает холодно' : 'матч молчит';
            const lastInfo = lastMsg ? ` Последнее (${lastMsg.from === 'user' ? '{{user}}' : b.name}): "${(lastMsg.text || '').slice(0, 80)}"` : '';
            lines.push(`• ${b.name} (${b.age}, ${status}, ${msgs.length} сообщ.).${lastInfo}`);
        }
    }

    const passed = s.swipedIds.filter(id => s.matches[id]?.status === 'passed').map(id => ROSTER[id]?.name).filter(Boolean);
    if (passed.length) lines.push(`Свайпнула влево: ${passed.join(', ')}.`);

    const text = lines.join('\n');
    setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_PROMPT, settings.injectDepth || 4);
}

export function clearMainChatInjection() {
    setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
}

// ── Что именно идёт в основной чат — для отладки ──
export function debugSparkInjection() {
    const settings = getSettings();
    const ROSTER = getRoster();
    const s = loadState();
    const out = {
        injectionEnabled: settings.injectIntoMain,
        depth: settings.injectDepth,
        matches: Object.entries(s.matches).map(([id, m]) => ({ id, name: ROSTER[id]?.name, status: m.status, msgs: s.messages[id]?.length || 0 })),
        passed: s.swipedIds.filter(id => s.matches[id]?.status === 'passed').map(id => ROSTER[id]?.name),
    };
    console.log('[Spark] Что идёт в основной чат:', out);
    return out;
}

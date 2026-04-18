// ═══════════════════════════════════════════
// ENGINE — генерация ответов парней + инжект в основной чат
// ВСЕ запросы LLM идут через extra API (api.js).
// ═══════════════════════════════════════════

import { setExtensionPrompt, extension_prompt_types, user_avatar, getThumbnailUrl } from '../../../../script.js';
import { getRoster, getCustomAvatar, ensureBoyCard } from './roster.js';
import { loadState, pushMessage, getSettings, save } from './state.js';
import { callExtraLLM, isExtraLLMConfigured, generateImage, generateImageViaSD, isImageApiConfigured } from './api.js';

const PROMPT_KEY = 'SPARK_DATING_APP';

// ── Получить дата-URL аватарки активной персоны ST (второй реф для Gemini) ──
async function getUserAvatarDataUrl() {
    try {
        const file = (typeof user_avatar === 'string' && user_avatar) ? user_avatar : null;
        if (!file) return null;
        const url = getThumbnailUrl('persona', file);
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const blob = await resp.blob();
        return await new Promise((resolve) => {
            const r = new FileReader();
            r.onloadend = () => resolve(/** @type {string} */(r.result));
            r.onerror = () => resolve(null);
            r.readAsDataURL(blob);
        });
    } catch { return null; }
}

// ── Санитайзер NSFW-промта для image-моделей с цензурой (nano-banana, Imagen и т.п.) ──
// Заменяет явные сексуальные/анатомические термины (EN+RU) и обрезает длину.
function sanitizeImagePrompt(p) {
    if (!p) return p;
    let s = String(p);
    const map = [
        // ── EN ──
        [/\b(nsfw|explicit|nude|naked|topless|bottomless)\b/gi, ''],
        [/\b(sex|sexual|sexy|erotic|erotica|porn|pornographic|hentai)\b/gi, ''],
        [/\b(penis|cock|dick|testicles|balls|scrotum)\b/gi, ''],
        [/\b(vagina|pussy|clit|clitoris|labia)\b/gi, ''],
        [/\b(breasts?|boobs?|tits|nipples?|areola)\b/gi, ''],
        [/\b(ass|butt|buttocks|anus|asshole)\b/gi, ''],
        [/\b(cum|cumshot|semen|sperm|ejaculat\w*)\b/gi, ''],
        [/\b(blowjob|handjob|fellatio|cunnilingus|masturbat\w*|fingering)\b/gi, ''],
        [/\b(orgasm|aroused|horny|lust\w*)\b/gi, ''],
        [/\b(intercourse|penetration|fucking|fuck|fucked|hardcore)\b/gi, ''],
        [/\b(bdsm|bondage|dominat\w*|submissive|spank\w*|kink\w*)\b/gi, ''],
        [/\b(loli|shota|underage|child|minor|teen|teenager)\b/gi, 'adult'],
        // ── RU ──
        [/\b(голый|голая|голые|обнажённ\w*|обнаженн\w*|раздет\w*)\b/gi, ''],
        [/\b(секс\w*|эротик\w*|порн\w*|интим\w*|половой\sакт)\b/gi, ''],
        [/\b(член|хуй|пенис|яички|мошонка)\b/gi, ''],
        [/\b(вагина|пизда|клитор|вульв\w*)\b/gi, ''],
        [/\b(грудь|груди|сиськ\w*|сись\w*|соск\w*|сосок)\b/gi, ''],
        [/\b(жоп\w*|задниц\w*|анус|очко)\b/gi, ''],
        [/\b(сперм\w*|кончил\w*|кончает|оргазм\w*)\b/gi, ''],
        [/\b(минет|отсос|куни|мастурбац\w*|дрочит)\b/gi, ''],
        [/\b(возбужд\w*|похоть|страсть)\b/gi, ''],
        [/\b(трах\w*|еба\w*|ёба\w*|ебл\w*|секс\w*)\b/gi, ''],
        [/\b(бдсм|подчин\w*|доминир\w*)\b/gi, ''],
    ];
    for (const [re, rep] of map) s = s.replace(re, rep);
    s = s.replace(/[,\s]{2,}/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
    // Жёсткое обрезание — длинные NSFW-промпты режутся фильтрами целиком
    if (s.length > 400) s = s.slice(0, 400);
    // Художественная обёртка — снижает шанс отказа
    return `Tasteful artistic portrait photograph, romantic atmosphere, fully clothed, safe-for-work. ${s}`;
}

// ── Многоуровневый фоллбэк генерации картинки ──
// Цепочка: ref → no-ref → sanitized no-ref → SD slash.
// При любой ошибке отказа (IMAGE_REFUSED / safety / blocked / refus) идём на следующий шаг.
async function generateImageWithFallback(prompt, refAvatar) {
    const isRefusal = (err) => {
        const code = (err && /** @type {any} */(err).code) || '';
        const msg = String((err && /** @type {any} */(err).message) || err || '');
        return code === 'IMAGE_REFUSED' || /refus|safety|blocked|prohibit|other\)/i.test(msg);
    };
    const isHttp = (err) => /http\s*\d{3}|HTTP\s\d{3}|\b\d{3}:/i.test(String((err && /** @type {any} */(err).message) || err || ''));

    // 1) с рефами — аватарка парня + аватарка юзера. Эмпирически: на одном char-рефе
    // прокси часто кидает IMAGE_OTHER (псевдо-цензура), на паре рефов проходит стабильно.
    // Юзерская аватарка работает как «эталон лица человека вообще» — модель её НЕ копирует
    // в результат, потому что промпт говорит про мужской селфи.
    if (refAvatar) {
        const userRef = await getUserAvatarDataUrl();
        const refs = userRef ? [refAvatar, userRef] : [refAvatar];
        console.log('[Spark] step1 trying WITH refs, count=', refs.length, 'charLen=', String(refAvatar).length, 'userLen=', userRef ? String(userRef).length : 0);
        try { return await generateImage(prompt, refs); }
        catch (e) {
            console.warn('[Spark] step1 refs failed:', /** @type {any} */(e)?.message || e);
            if (!isRefusal(e) && !isHttp(e)) throw e;
        }
    } else {
        console.log('[Spark] step1 SKIPPED (no ref avatar saved for this boy or useAvatarAsRef=off)');
    }
    // 2) без рефа, оригинальный промт
    try { return await generateImage(prompt, null); }
    catch (e) {
        console.warn('[Spark] step2 no-ref failed:', /** @type {any} */(e)?.message || e);
        if (!isRefusal(e)) {
            // Сетевая/серверная — пробуем SD как последний шанс и всё
            try { return await generateImageViaSD(prompt); } catch { throw e; }
        }
    }
    // 3) санитайзенный + укороченный промт без рефа
    const safe = sanitizeImagePrompt(prompt);
    if (safe) {
        try {
            console.log('[Spark] step3 sanitized prompt, len=', safe.length);
            return await generateImage(safe, null);
        } catch (e) {
            console.warn('[Spark] step3 sanitized failed:', /** @type {any} */(e)?.message || e);
        }
    }
    // 4) SD slash как последний фоллбэк
    console.log('[Spark] step4 generateImageViaSD');
    return await generateImageViaSD(safe || prompt);
}

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
    // Гарантируем, что карточка распарсена из лорбука (ленивый парс по требованию)
    try { await ensureBoyCard(boyId); } catch (e) { console.warn('[Spark] ensureBoyCard before reply failed:', e); }
    const s = loadState();
    const history = (s.messages[boyId] || []).slice(-40);

    const persona = getUserPersona();
    const userLabel = persona.name || 'Она';

    const historyText = history.map((m, idx) => {
        const who = m.from === 'user' ? userLabel : boy.name;
        const flag = m.deleted ? ' [потом удалил]' : '';
        const img = m.image ? ' [прислала фото]' : '';
        // Маркер паузы перед сообщением, если с предыдущего прошло > 1 часа
        let gap = '';
        const prev = idx > 0 ? history[idx - 1] : null;
        if (prev?.ts && m.ts) {
            const diffMs = m.ts - prev.ts;
            const hours = Math.floor(diffMs / 3600000);
            if (hours >= 24) {
                const days = Math.floor(hours / 24);
                gap = `--- прошло ${days} ${days === 1 ? 'день' : days < 5 ? 'дня' : 'дней'} ---\n`;
            } else if (hours >= 1) {
                gap = `--- прошло ${hours} ${hours === 1 ? 'час' : hours < 5 ? 'часа' : 'часов'} ---\n`;
            }
        }
        return `${gap}${who}: ${m.text || ''}${img}${flag}`;
    }).join('\n');

    const settings = getSettings();
    const includePersonaDesc = settings.includePersonaDescription !== false; // по умолчанию включено
    const profile = settings.profile || {};
    const profileLines = [];
    if (profile.ageMe) profileLines.push(`возраст: ${profile.ageMe}`);
    if (profile.lookingFor) profileLines.push(`ищет: ${profile.lookingFor}`);
    if (profile.extraBio) profileLines.push(`о себе: ${profile.extraBio}`);
    const profileBlock = profileLines.length ? `Анкета в Spark:\n${profileLines.join('\n')}\n` : '';
    const personaBlock = ((includePersonaDesc && persona.description) || profileBlock)
        ? `\nО СОБЕСЕДНИЦЕ (${userLabel}):\n${profileBlock}${(includePersonaDesc && persona.description) ? persona.description : ''}\n`
        : '';

    // Подмешиваем последние реплики из основного чата ST — это «вторая реальность»
    // того же парня (живая встреча, телефонный разговор, что угодно — определяется
    // самим основным чатом). Не предполагаем формат: пусть LLM сама поймёт по тексту.
    const stExcerpt = getMainChatExcerpt(boy.name, 8);
    const encounterBlock = stExcerpt
        ? `\nВЫ С ${userLabel.toUpperCase()} УЖЕ ОБЩАЛИСЬ ВНЕ SPARK (это происходит/произошло параллельно с перепиской — например, по телефону, в видеозвонке, на встрече или ещё как-то; характер контакта понимай из самого текста ниже, не выдумывай). Это ТЫ (${boy.name}) и ${userLabel}, та же пара, тот же контекст:\n${stExcerpt}\n`
        : '';

    // Собираем всю карточку — отдаём LLM все доп.поля что есть в лорбуке
    const extraFields = [];
    if (boy.tags_ui?.length) extraFields.push(`Теги в анкете: ${boy.tags_ui.join(', ')}`);
    if (boy.distance) extraFields.push(`Дистанция в Spark: ${boy.distance}`);
    if (boy.redflag) extraFields.push(`Скрытая особенность характера (приватная инфо для отыгрыша): ${boy.redflag}`);
    if (boy.tags && typeof boy.tags === 'object') {
        const tagPairs = Object.entries(boy.tags).map(([k, v]) => `${k}:${v}`).join(', ');
        if (tagPairs) extraFields.push(`Внутренние веса по вайбам: ${tagPairs}`);
    }
    // Любые ДРУГИЕ кастомные поля из лорбука (всё кроме служебных)
    const knownKeys = new Set(['name', 'age', 'distance', 'bio', 'tags_ui', 'redflag', 'tags',
        'writeStyle', 'styleNote', 'imagePrompt', 'avatarGradient', 'initial', 'id']);
    for (const [k, v] of Object.entries(boy)) {
        if (knownKeys.has(k) || v == null || v === '') continue;
        if (typeof v === 'string') extraFields.push(`${k}: ${v}`);
        else if (typeof v === 'number' || typeof v === 'boolean') extraFields.push(`${k}: ${v}`);
        else if (Array.isArray(v) && v.every(x => typeof x === 'string')) extraFields.push(`${k}: ${v.join(', ')}`);
        else { try { extraFields.push(`${k}: ${JSON.stringify(v)}`); } catch {} }
    }
    const extraBlock = extraFields.length ? `\nДОП. ИНФОРМАЦИЯ О ${boy.name.toUpperCase()}:\n${extraFields.join('\n')}\n` : '';

    // Сырое описание из лорбука — это ПЕРВОИСТОЧНИК, всё остальное — экстракт из него
    // Резолвим макросы ST ({{user}}, {{char}}, {{persona}}, ...) чтобы LLM получила имена, а не литералы.
    let rawDesc = boy._rawDescription || '';
    if (rawDesc) {
        try {
            const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
            if (typeof c.substituteParams === 'function') {
                rawDesc = c.substituteParams(rawDesc);
            }
        } catch (e) { /* fallback to raw */ }
    }
    const lorebookBlock = rawDesc
        ? `\nПОЛНОЕ ОПИСАНИЕ ${boy.name.toUpperCase()} (из лорбука — твоя биография, характер, факты. Авторитетный источник):\n${rawDesc}\n`
        : '';

    const prompt = `Ты отыгрываешь ${boy.name} в dating-app Spark. Отвечай СТРОГО по описанию из лорбука, без smoothing характера. Если в лорбуке что-то сказано о тебе (работа, привычки, внешность, прошлое, что любишь, что бесит) — ты ЭТО ЗНАЕШЬ и можешь органично вплетать в разговор когда к слову.
${lorebookBlock}
КАРТОЧКА В SPARK (что видно на твоей анкете):
Имя: ${boy.name}, ${boy.age} лет
Био в анкете: ${boy.bio}
Стиль письма: ${boy.writeStyle} — ${boy.styleNote || ''}
Внешность (для фото): ${boy.imagePrompt || '(не задано)'}
${extraBlock}${personaBlock}${encounterBlock}
ИСТОРИЯ ПЕРЕПИСКИ (это РЕАЛЬНАЯ переписка между тобой и ${userLabel} в Spark; реплики где автор = "${boy.name}" — это ТВОИ собственные прошлые сообщения, помни их и не противоречь себе; реплики где автор = "${userLabel}" — её сообщения, отвечай ИМЕННО на её последнюю реплику, не игнорируй её и не уходи в свою тему):
${historyText || `(ещё не переписывались — это твоё первое сообщение после матча в Spark с ${userLabel})`}

ЗАДАЧА: Напиши следующее сообщение(я) от лица ${boy.name}. Следуй стилю письма дословно (объём, тон, темп, эмодзи). Если по стилю он шлёт несколько сообщений подряд — раздели через двойной перенос строки. Если одно удаляет — оберни в [DELETED]текст[/DELETED].

ФОТО: если по сюжету уместно прислать фото (селфи, что-то из жизни, показать что делает) — добавь ОТДЕЛЬНЫМ сообщением тег [IMG:английское описание фото]. Используй РЕДКО (примерно 1 раз на 8-15 сообщений), только когда это органично для ${boy.name}. Описание короткое (10-20 слов), на английском, в стиле dating-app фото.

ВАЖНО: ответ только текст сообщения(й). Без <think>, без reasoning, без комментариев, без «${boy.name}:», без markdown.`;

    // Vision: если ПОСЛЕДНЕЕ сообщение от пользователя — фото, прикрепляем его к запросу.
    // Картинку шлём только один раз; в дальнейших ответах бот будет помнить её из текстового контекста.
    const lastMsg = history[history.length - 1];
    const visionImages = (lastMsg && lastMsg.from === 'user' && lastMsg.image) ? [lastMsg.image] : [];

    let raw;
    try {
        raw = await callExtraLLM(prompt, visionImages.length ? { images: visionImages } : {});
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
                    const useRef = getSettings().useAvatarAsRef !== false;
                    const refAvatar = useRef ? (getCustomAvatar(boyId) || null) : null;
                    const dataUrl = await generateImageWithFallback(imgPrompt, refAvatar);
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

// ── Перегенерация уже отправленной картинки в чате ──
export async function regenerateChatImage(boyId, msgTs) {
    const s = loadState();
    const list = s.messages?.[boyId];
    if (!list) return;
    const msg = list.find(m => m && m.ts === Number(msgTs));
    if (!msg) { console.warn('[Spark] regen: msg не найден', msgTs); return; }
    const prompt = msg._imgPrompt;
    if (!prompt) { console.warn('[Spark] regen: у сообщения нет _imgPrompt'); return; }
    if (!msg._genId) msg._genId = `gen_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    msg._generating = true;
    msg.image = '';
    save();
    window.dispatchEvent(new CustomEvent('spark:rerender', { detail: { boyId } }));
    try {
        const useRef = getSettings().useAvatarAsRef !== false;
        const refAvatar = useRef ? (getCustomAvatar(boyId) || null) : null;
        const dataUrl = await generateImageWithFallback(prompt, refAvatar);
        updateGeneratedImage(boyId, msg._genId, { image: dataUrl, _generating: false });
    } catch (err) {
        console.warn('[Spark] regen failed:', err);
        updateGeneratedImage(boyId, msg._genId, { image: '', text: `[фото не загрузилось: ${String(err.message || err).slice(0, 80)}]`, _generating: false });
    }
}

// ── Достать последние реплики из основного чата ST для парня с таким же именем ──
function getMainChatExcerpt(boyName, n = 8) {
    if (!boyName) return '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return '';
        const name2 = (c.name2 || '').toLowerCase();
        const ROSTER = getRoster();
        // Если name2 явно совпадает с другим парнем из ростера — пропускаем
        // (значит юзер сейчас отыгрывает не этого парня, а кого-то другого).
        if (name2 && name2 !== String(boyName).toLowerCase()) {
            for (const b of Object.values(ROSTER)) {
                if ((b.name || '').toLowerCase() === name2) return '';
            }
            // name2 не совпал ни с одним парнем из ростера → это универсальный
            // персонаж («Приложение для знакомств»), играющий всех. Берём excerpt.
        }
        const tail = chat.slice(-n);
        if (!tail.length) return '';
        return tail.map(m => {
            const who = m.is_user ? (c.name1 || 'Я') : (m.name || boyName);
            const t = String(m.mes || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
            return `${who}: ${t}`;
        }).filter(l => l.length > 5).join('\n');
    } catch (e) {
        console.warn('[Spark] getMainChatExcerpt failed:', e);
        return '';
    }
}

// ── Угадать активного парня из последних сообщений основного чата ──
// Сканируем хвост чата: чьё имя (или часть имени) чаще/свежее упоминается —
// тот и есть «текущий» парень в основном чате.
function detectBoyFromMainChat(lookback = 12) {
    try {
        const ROSTER = getRoster();
        const ids = Object.keys(ROSTER);
        if (!ids.length) return null;
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const chat = c.chat || [];
        if (!chat.length) return null;
        const tail = chat.slice(-lookback);
        // Собираем варианты имён (полное + первое слово) для каждого парня
        const variants = ids.map(id => {
            const name = String(ROSTER[id].name || '').trim();
            if (!name) return null;
            const parts = name.split(/\s+/).filter(p => p.length >= 3);
            const set = new Set([name.toLowerCase(), ...parts.map(p => p.toLowerCase())]);
            return { id, names: [...set] };
        }).filter(Boolean);
        // Скоринг: свежие сообщения весят больше, имя в поле name весит ещё больше
        const score = Object.create(null);
        tail.forEach((m, idx) => {
            const recency = idx + 1; // 1..lookback
            const msgName = String(m?.name || '').toLowerCase();
            const text = String(m?.mes || '').toLowerCase();
            for (const v of variants) {
                for (const n of v.names) {
                    if (msgName === n) score[v.id] = (score[v.id] || 0) + recency * 5;
                    else if (text.includes(n)) score[v.id] = (score[v.id] || 0) + recency;
                }
            }
        });
        let bestId = null, best = 0;
        for (const [id, sc] of Object.entries(score)) {
            if (sc > best) { best = sc; bestId = id; }
        }
        return bestId;
    } catch (e) {
        console.warn('[Spark] detectBoyFromMainChat failed:', e);
        return null;
    }
}

// ── Сводка для основного чата ST ──
export function syncToMainChat() {
    const settings = getSettings();
    if (!settings.injectIntoMain) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }
    const ROSTER = getRoster();
    const s = loadState();

    // Если активный персонаж основного чата = один из парней Spark — ВСЕГДА инжектим
    // ему контекст переписки (даже когда модалка Spark закрыта). Это нужно чтобы
    // персонаж в основном чате знал что вы только что обсуждали в Spark.
    let activeBoyId = null;
    let matchSource = '';
    try {
        const c = (typeof SillyTavern?.getContext === 'function') ? SillyTavern.getContext() : {};
        const name2 = (c.name2 || '').toLowerCase();
        if (name2) {
            for (const [id, b] of Object.entries(ROSTER)) {
                if ((b.name || '').toLowerCase() === name2) { activeBoyId = id; matchSource = 'name2'; break; }
            }
        }
    } catch {}
    // Fallback: если основной персонаж ST НЕ совпадает по имени с парнем
    // (типично — у тебя один общий чар «Приложение для знакомств», который играет всех),
    // используем последнего открытого в Spark парня. Этого достаточно чтобы
    // основной чат знал контекст.
    if (!activeBoyId && s.openChatBoy && ROSTER[s.openChatBoy]) {
        activeBoyId = s.openChatBoy;
        matchSource = 'openChatBoy';
    }
    // Доп. fallback: если openChatBoy ещё не выставлен (юзер ни разу не открывал
    // чат внутри Spark), берём парня с самым свежим сообщением в переписке.
    if (!activeBoyId) {
        let bestId = null, bestTs = 0;
        for (const [id, arr] of Object.entries(s.messages || {})) {
            if (!ROSTER[id] || !Array.isArray(arr) || !arr.length) continue;
            const last = arr[arr.length - 1];
            const ts = Number(last?.ts || last?.time || 0);
            if (ts >= bestTs) { bestTs = ts; bestId = id; }
        }
        if (bestId) {
            activeBoyId = bestId;
            matchSource = 'lastMessaged';
        }
    }
    // Ещё один fallback: единственный матч в ростере — он и есть активный.
    if (!activeBoyId) {
        const matchedIds = Object.entries(s.matches || {})
            .filter(([id, m]) => ROSTER[id] && ['matched', 'cold_one_message', 'matched_silent'].includes(m.status))
            .map(([id]) => id);
        if (matchedIds.length === 1) {
            activeBoyId = matchedIds[0];
            matchSource = 'soleMatch';
        }
    }

    // Модалка открыта — добавляем общий обзор Spark (матчи, свайпы и т.д.)
    const modal = document.getElementById('spark-modal');
    const isOpen = modal?.classList.contains('open');

    // Если ни активного бой-персонажа, ни открытой модалки — ничего не инжектим.
    if (!activeBoyId && !isOpen) {
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }

    const matches = Object.entries(s.matches).filter(([_, m]) => ['matched', 'cold_one_message', 'matched_silent'].includes(m.status));

    const lines = [];
    lines.push('[SPARK APP STATE — состояние приложения знакомств Spark, в котором сейчас сидит {{user}}.]');

    if (activeBoyId) {
        const b = ROSTER[activeBoyId];
        const msgs = s.messages[activeBoyId] || [];
        const persona = getUserPersona();
        const userLabel = persona.name || '{{user}}';
        if (msgs.length) {
            // Последние 15 — дословно, более старые — кратким саммари по количеству.
            const total = msgs.length;
            const recentN = 15;
            const recent = msgs.slice(-recentN);
            const olderCount = Math.max(0, total - recentN);
            lines.push(`ВАЖНО: ты (${b.name}) и ${userLabel} ПАРАЛЛЕЛЬНО переписываетесь в приложении Spark. Ты ОДИН и тот же человек в Spark и здесь. Помни эту переписку и используй её естественно.`);
            lines.push('');
            lines.push(`КРИТИЧЕСКИ ВАЖНО: ниже приведена ВСЯ переписка из Spark — это ЕДИНСТВЕННЫЙ источник правды. НЕ ВЫДУМЫВАЙ другие сообщения, которые ${userLabel} якобы тебе писала. Если хочешь сослаться на её слова — цитируй ТОЛЬКО то, что есть в блоке ниже, дословно. Не придумывай несуществующих фраз про «я устала», «ищу мужчину который» и т.п. — если этого НЕТ в блоке, значит этого НЕ БЫЛО.`);
            lines.push('');
            if (olderCount > 0) {
                lines.push(`(До этого фрагмента в Spark было ещё ${olderCount} сообщений — их содержание тебе НЕ дано, не выдумывай.)`);
            }
            lines.push(`=== НАЧАЛО ПЕРЕПИСКИ В SPARK (от старых к новым) ===`);
            for (const m of recent) {
                const who = m.from === 'user' ? userLabel : b.name;
                const flag = m.deleted ? ' [потом удалил]' : '';
                const img = m.image ? ' [прислал(а) фото]' : '';
                lines.push(`${who}: ${(m.text || '').slice(0, 250)}${img}${flag}`);
            }
            lines.push(`=== КОНЕЦ ПЕРЕПИСКИ В SPARK ===`);
        } else if (s.matches[activeBoyId]) {
            lines.push(`Вы с ${userLabel} сматчились в Spark, но ещё не переписывались в приложении. НЕ выдумывай несуществующих сообщений.`);
        }
    }

    if (isOpen && matches.length) {
        // Общий обзор — только когда юзер реально сидит в Spark
        lines.push('');
        lines.push('Все активные матчи {{user}} в Spark:');
        for (const [id, m] of matches) {
            if (id === activeBoyId) continue; // про активного уже есть полная переписка выше
            const b = ROSTER[id]; if (!b) continue;
            const msgs = s.messages[id] || [];
            const lastMsg = msgs[msgs.length - 1];
            const status = m.status === 'matched' ? 'переписываются' : m.status === 'cold_one_message' ? 'он отвечает холодно' : 'матч молчит';
            const lastInfo = lastMsg ? ` Последнее (${lastMsg.from === 'user' ? '{{user}}' : b.name}): "${(lastMsg.text || '').slice(0, 80)}"` : '';
            lines.push(`• ${b.name} (${b.age}, ${status}, ${msgs.length} сообщ.).${lastInfo}`);
        }
        const passed = s.swipedIds.filter(id => s.matches[id]?.status === 'passed').map(id => ROSTER[id]?.name).filter(Boolean);
        if (passed.length) lines.push(`Свайпнула влево: ${passed.join(', ')}.`);
    }

    if (lines.length <= 1) {
        // Только заголовок без контента — не инжектим.
        setExtensionPrompt(PROMPT_KEY, '', extension_prompt_types.IN_PROMPT, 0);
        return '';
    }

    const text = lines.join('\n');
    setExtensionPrompt(PROMPT_KEY, text, extension_prompt_types.IN_PROMPT, settings.injectDepth || 4);
    console.log(`[Spark] inject → ${text.length} симв., activeBoy=${activeBoyId} (${matchSource}), depth=${settings.injectDepth || 4}`);
    return text;
}

// Прямой инжект в массив messages чат-комплишена. Используется как страховка
// поверх setExtensionPrompt — если ST по какой-то причине не подмешал нашу
// инжекцию (preset prompts, фильтры и т.п.), мы её всё равно добавим сами.
export function injectIntoChatCompletion(eventData) {
    try {
        const settings = getSettings();
        if (!settings.injectIntoMain) return;
        const chat = eventData?.chat;
        if (!Array.isArray(chat)) return;
        const text = syncToMainChat();
        if (!text) return;
        // Проверяем, не подмешал ли ST уже наш блок (по уникальному маркеру).
        const marker = '[SPARK APP STATE';
        const already = chat.some(m => typeof m?.content === 'string' && m.content.includes(marker));
        if (already) return;
        // Вставляем перед последним user-сообщением (или в конец если такого нет).
        const sysMsg = { role: 'system', content: text };
        let insertAt = chat.length;
        for (let i = chat.length - 1; i >= 0; i--) {
            if (chat[i]?.role === 'user') { insertAt = i; break; }
        }
        chat.splice(insertAt, 0, sysMsg);
        console.log(`[Spark] direct chat-completion inject (fallback) at index ${insertAt}, ${text.length} симв.`);
    } catch (e) {
        console.warn('[Spark] injectIntoChatCompletion failed:', e);
    }
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

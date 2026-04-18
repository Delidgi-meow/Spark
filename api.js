// ═══════════════════════════════════════════
// API — независимый клиент для LLM и картинок
// Все запросы идут через ST-прокси (/proxy/{url}) с CSRF-заголовком,
// но используют ОТДЕЛЬНЫЙ endpoint+key+model — не основной API SillyTavern.
// ═══════════════════════════════════════════

import { getSettings } from './state.js';

const ctx = () => (typeof SillyTavern?.getContext === 'function' ? SillyTavern.getContext() : {});

function cleanEndpoint(url) {
    // Снимаем trailing slash И trailing /v1 (или /v1/), чтобы пользователь
    // мог писать как `https://api.x.com`, так и `https://api.x.com/v1`.
    return String(url || '').trim().replace(/\/+$/, '').replace(/\/v1$/i, '');
}

// Прямой fetch на endpoint API (никаких /proxy/, никаких подтверждений ST).
// Большинство современных провайдеров (OpenRouter, DeepSeek, прокси на gcp/openai-compatible)
// разрешают CORS из браузера. Если конкретный endpoint не поддерживает CORS —
// нужен endpoint-провайдер с CORS-разрешением.
async function directFetch(targetUrl, init) {
    return await fetch(targetUrl, init);
}

// ── Получить список моделей с эндпоинта ──
export async function fetchModels(endpoint, apiKey) {
    const ep = cleanEndpoint(endpoint);
    if (!ep || !apiKey) throw new Error('endpoint и apiKey обязательны');
    const url = `${ep}/v1/models`;
    const resp = await directFetch(url, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return (data.data || data.models || []).map(m => m.id || m.name).filter(Boolean);
}

// ── LLM (chat completions) через extra API ──
export async function callExtraLLM(prompt, opts = {}) {
    const s = getSettings();
    const ep = cleanEndpoint(s.extraApi?.endpoint);
    const key = s.extraApi?.apiKey;
    const model = s.extraApi?.model;
    if (!ep || !key || !model) {
        throw new Error('Extra API не настроен (endpoint/apiKey/model)');
    }
    const url = `${ep}/v1/chat/completions`;
    // Vision: если переданы opts.images (массив dataURL), отправляем
    // multimodal content по OpenAI-формату — текст + картинки в одном user-сообщении.
    let userContent;
    if (Array.isArray(opts.images) && opts.images.length) {
        userContent = [
            { type: 'text', text: prompt },
            ...opts.images.map(url => ({ type: 'image_url', image_url: { url } })),
        ];
        console.log(`[Spark] callExtraLLM with vision: ${opts.images.length} image(s)`);
    } else {
        userContent = prompt;
    }
    const body = {
        model,
        messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: userContent },
        ],
        temperature: opts.temperature ?? s.extraApi?.temperature ?? 0.9,
        max_tokens: opts.maxTokens ?? s.extraApi?.maxTokens ?? 800,
    };
    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`HTTP ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
}

export function isExtraLLMConfigured() {
    const s = getSettings();
    return !!(cleanEndpoint(s.extraApi?.endpoint) && s.extraApi?.apiKey && s.extraApi?.model);
}

// ── Image generation через extra image API (OpenAI-совместимый) ──
// Также есть автоподхват настроек из расширения sillyimages если оно настроено.
function getImageConfig() {
    const s = getSettings();
    const own = s.imageApi || {};
    if (cleanEndpoint(own.endpoint) && own.apiKey && own.model) {
        return {
            endpoint: cleanEndpoint(own.endpoint),
            apiKey: own.apiKey,
            model: own.model,
            size: own.size || '1024x1024',
            apiType: own.apiType || 'openai',
            source: 'spark',
        };
    }
    if (s.useSillyImagesConfig) {
        const c = ctx();
        const iig = c.extensionSettings?.inline_image_gen;
        if (iig && cleanEndpoint(iig.endpoint) && iig.apiKey && iig.model) {
            return {
                endpoint: cleanEndpoint(iig.endpoint),
                apiKey: iig.apiKey,
                model: iig.model,
                size: iig.size || '1024x1024',
                apiType: iig.apiType || 'openai',
                aspectRatio: iig.aspectRatio,
                source: 'sillyimages',
            };
        }
    }
    return null;
}

export function isImageApiConfigured() {
    return !!getImageConfig();
}

// Унифицированная генерация. Поддерживает apiType='openai' (DALL-E / FLUX-совместимые)
// и 'gemini' (nano-banana). 'naistera' пока не поддерживается — попроси юзера
// переключить sillyimages на openai/gemini или указать openai-совместимый endpoint в Spark.
// refImage (dataURL) — опционально: используется как референс лица (аватар парня).
// refImage — dataURL ИЛИ массив dataURL (1-й = char, 2-й = user persona).
export async function generateImage(prompt, refImage = null) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен (ни в Spark, ни в sillyimages)');

    const s = getSettings();
    const prefix = (s.imagePromptPrefix || '').trim();
    const suffix = (s.imagePromptSuffix || '').trim();
    const negative = (s.imageNegativePrompt || '').trim();
    const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');

    if (cfg.apiType === 'gemini') return await generateImageGemini(fullPrompt, cfg, refImage);
    if (cfg.apiType === 'naistera') {
        throw new Error('Spark пока не поддерживает naistera. Переключи sillyimages на openai/gemini или задай openai-совместимый imageApi в настройках Spark.');
    }
    // OpenAI-совместимым отдаём первый реф
    const firstRef = Array.isArray(refImage) ? refImage[0] : refImage;
    return await generateImageOpenAI(fullPrompt, cfg, negative, firstRef);
}

async function generateImageOpenAI(prompt, cfg, negativePrompt = '', refImage = null) {
    const url = `${cfg.endpoint}/v1/images/generations`;
    const body = { model: cfg.model, prompt, n: 1, size: cfg.size, response_format: 'b64_json' };
    if (negativePrompt) body.negative_prompt = negativePrompt;
    // best-effort: некоторые image-форки (FLUX redux, прокси) принимают image как base64 референс
    if (refImage) {
        body.image = refImage;
        body.image_url = refImage;
        body.init_image = refImage;
    }
    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Image API ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    const item = data.data?.[0];
    if (!item) throw new Error('Пустой ответ от image API');
    if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
    if (item.url) return item.url;
    throw new Error('В ответе нет b64_json или url');
}

async function generateImageGemini(prompt, cfg, refImage = null) {
    // Нативный Gemini API (точно как sillyimages):
    // /v1beta/models/{model}:generateContent + responseModalities + inlineData parts.
    const baseUrl = String(cfg.endpoint || '').replace(/\/+$/, '');
    const url = `${baseUrl}/v1beta/models/${cfg.model}:generateContent`;

    // Нормализуем refImage в массив [{mime,data,label}]
    const refsRaw = Array.isArray(refImage) ? refImage : (refImage ? [refImage] : []);
    const labels = ['char_ref', 'user_ref', 'npc_ref'];
    const refs = [];
    for (let i = 0; i < refsRaw.length && i < 3; i++) {
        try {
            const r = await dataUrlToPngBase64(refsRaw[i]);
            refs.push({ ...r, label: labels[i] });
        } catch (e) {
            console.warn('[Spark] ref image conversion failed:', e);
        }
    }

    const parts = [];
    if (refs.length) {
        // Лейблы дословно как в sillyimages (lines 1537-1542) — модель так распознаёт это как трансформацию.
        const labelMap = {
            'char_ref': '⬇️ CHARACTER REFERENCE — copy this character\'s appearance exactly:',
            'user_ref': '⬇️ USER REFERENCE — copy this person\'s appearance exactly:',
            'npc_ref': '⬇️ NPC REFERENCE — copy this character\'s appearance exactly:',
        };
        for (const r of refs) {
            parts.push({ text: labelMap[r.label] || '⬇️ REFERENCE IMAGE:' });
            // mimeType ВСЕГДА 'image/png' — sillyimages так делает (строка 1547),
            // даже если реальные байты JPEG. Иначе xexexexe.sbs режет в IMAGE_OTHER.
            parts.push({ inlineData: { mimeType: 'image/png', data: r.data } });
        }
        const strictRules = `[STRICT IMAGE GENERATION RULES]
CHARACTER CONSISTENCY: You MUST precisely replicate the facial features (face structure, eye color/shape, hair color/style/length, skin tone, facial hair, age) and overall appearance from the CHARACTER/USER/NPC REFERENCE images. These characters must be recognizable as the same people across all generated images. This is the HIGHEST priority.
[END RULES]

`;
        parts.push({ text: strictRules + prompt });
    } else {
        parts.push({ text: prompt });
    }

    const body = {
        contents: [{ role: 'user', parts }],
        generationConfig: {
            responseModalities: ['TEXT', 'IMAGE'],
            imageConfig: {
                aspectRatio: cfg.aspectRatio || '1:1',
                imageSize: '1K',
            },
        },
    };

    console.log('[Spark] Gemini POST', url, 'model=', cfg.model, 'refsCount=', refs.length, refs.map(r => `${r.label}(${r.mime},${r.data.length}b64)`), 'promptLen=', prompt.length);
    console.log('[Spark] Gemini PROMPT:\n' + prompt);
    console.log('[Spark] Gemini body parts summary:', body.contents[0].parts.map(p => p.text ? `text(${p.text.length})` : p.inlineData ? `inlineData(${p.inlineData.mimeType}, ${p.inlineData.data.length}b64)` : Object.keys(p)));

    const resp = await directFetch(url, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${cfg.apiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        console.error('[Spark] Gemini HTTP error:', resp.status, t);
        throw new Error(`Gemini image ${resp.status}: ${t.slice(0, 300)}`);
    }
    const data = await resp.json();
    console.log('[Spark] Gemini raw response:', data);
    console.log('[Spark] candidates[0]:', JSON.stringify(data.candidates?.[0], null, 2));
    console.log('[Spark] promptFeedback:', JSON.stringify(data.promptFeedback, null, 2));

    // 1) Нативный формат Gemini — parts с inlineData
    const candidates = data.candidates || [];
    const responseParts = candidates[0]?.content?.parts || [];
    for (const p of responseParts) {
        if (p.inlineData?.data) return `data:${p.inlineData.mimeType || 'image/png'};base64,${p.inlineData.data}`;
        if (p.inline_data?.data) return `data:${p.inline_data.mime_type || 'image/png'};base64,${p.inline_data.data}`;
        // Некоторые прокси (xexexexe и т.п.) суют картинку в fileData / file_data
        if (p.fileData?.fileUri) return p.fileData.fileUri;
        if (p.file_data?.file_uri) return p.file_data.file_uri;
    }
    // 1b) Иногда content без parts но с прямым inlineData / image
    const cont = candidates[0]?.content;
    if (cont?.inlineData?.data) return `data:${cont.inlineData.mimeType || 'image/png'};base64,${cont.inlineData.data}`;
    if (cont?.inline_data?.data) return `data:${cont.inline_data.mime_type || 'image/png'};base64,${cont.inline_data.data}`;
    // 2) finishReason / promptFeedback — проблемы safety/quota/refusal
    const finishReason = candidates[0]?.finishReason;
    const finishMessage = candidates[0]?.finishMessage || '';
    const blockReason = data.promptFeedback?.blockReason;
    if (blockReason || ['SAFETY', 'PROHIBITED_CONTENT', 'IMAGE_SAFETY', 'IMAGE_OTHER', 'IMAGE_PROHIBITED', 'RECITATION'].includes(finishReason)) {
        // Специальный маркер IMAGE_REFUSED — вызывающий код сделает retry без рефа.
        const err = new Error(`Gemini отказался генерить (${blockReason || finishReason}). ${finishMessage}`.trim());
        err.code = 'IMAGE_REFUSED';
        throw err;
    }
    // 3) Модель вернула только текст (не image модель)
    const textOnly = responseParts.map(p => p.text).filter(Boolean).join(' ').slice(0, 200);
    if (textOnly) {
        throw new Error(`Gemini вернул ТЕКСТ вместо картинки — модель не image. В sillyimages выбери *image* модель (gemini-2.5-flash-image-preview / gemini-2.0-flash-exp-image-generation). Ответ: "${textOnly}"`);
    }
    // 4) Fallback: data:image в сыром JSON
    const txt = JSON.stringify(data);
    const m = txt.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/);
    if (m) return m[0];
    // 4b) Голый base64 (длинный) без префикса — прокси иногда так возвращает
    const bareB64 = findBase64Image(data);
    if (bareB64) return `data:image/png;base64,${bareB64}`;
    // 4c) Прямая http(s) ссылка на картинку
    const urlMatch = txt.match(/https?:\/\/[^"'\s]+\.(?:png|jpe?g|webp|gif)(?:\?[^"'\s]*)?/i);
    if (urlMatch) return urlMatch[0];
    throw new Error('Gemini не вернул картинку (см. сырой ответ + candidates[0] в console). Если прокси кастомный — пришли мне структуру candidates[0].');
}

// Рекурсивно ищем длинную base64-строку в произвольной структуре (для нестандартных прокси).
function findBase64Image(obj, depth = 0) {
    if (!obj || depth > 8) return null;
    if (typeof obj === 'string') {
        // base64 PNG/JPEG обычно начинается с iVBOR / /9j/ / R0lGOD
        if (obj.length > 500 && /^(iVBOR|\/9j\/|R0lGOD|UklGR)/.test(obj)) return obj;
        return null;
    }
    if (Array.isArray(obj)) {
        for (const v of obj) { const r = findBase64Image(v, depth + 1); if (r) return r; }
        return null;
    }
    if (typeof obj === 'object') {
        for (const v of Object.values(obj)) { const r = findBase64Image(v, depth + 1); if (r) return r; }
    }
    return null;
}

// Извлечь чистый base64 + mime из dataURL БЕЗ пересжатия (как sillyimages).
// nano-banana через xexexexe.sbs не любит canvas-перекодированные refs — теряются метаданные/EXIF
// и срабатывает фильтр IMAGE_OTHER. Берём оригинальные байты как есть.
function dataUrlToPngBase64(dataUrl, _maxDim = 768) {
    return new Promise((resolve, reject) => {
        if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) {
            reject(new Error('not a dataURL'));
            return;
        }
        const m = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
        if (!m) { reject(new Error('bad dataURL')); return; }
        // Возвращаем строку с маркером mime через первый символ (для совместимости с вызывающим кодом
        // ниже)? Нет — оставим только base64, а mime прокинем через глобальный side-channel.
        // Проще: просто отдадим объект — обновим вызывающий код.
        resolve({ mime: m[1], data: m[2] });
    });
}

// ── Fallback: генерация через slash /sd ──
export async function generateImageViaSD(prompt) {
    const c = ctx();
    if (typeof c.executeSlashCommandsWithOptions !== 'function') throw new Error('slash API недоступен');
    const safe = String(prompt).replace(/"/g, '\\"');
    const r = await c.executeSlashCommandsWithOptions(`/sd quiet=true "${safe}"`);
    const url = (r?.pipe || '').trim();
    if (!url) throw new Error('/sd вернул пусто (расширение SD включено?)');
    return url;
}

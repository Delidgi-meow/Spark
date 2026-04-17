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
    const body = {
        model,
        messages: [
            ...(opts.system ? [{ role: 'system', content: opts.system }] : []),
            { role: 'user', content: prompt },
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
export async function generateImage(prompt) {
    const cfg = getImageConfig();
    if (!cfg) throw new Error('Image API не настроен (ни в Spark, ни в sillyimages)');

    const s = getSettings();
    const prefix = (s.imagePromptPrefix || '').trim();
    const suffix = (s.imagePromptSuffix || '').trim();
    const negative = (s.imageNegativePrompt || '').trim();
    const fullPrompt = [prefix, prompt, suffix].filter(Boolean).join(', ');

    if (cfg.apiType === 'gemini') return await generateImageGemini(fullPrompt, cfg);
    if (cfg.apiType === 'naistera') {
        throw new Error('Spark пока не поддерживает naistera. Переключи sillyimages на openai/gemini или задай openai-совместимый imageApi в настройках Spark.');
    }
    return await generateImageOpenAI(fullPrompt, cfg, negative);
}

async function generateImageOpenAI(prompt, cfg, negativePrompt = '') {
    const url = `${cfg.endpoint}/v1/images/generations`;
    const body = { model: cfg.model, prompt, n: 1, size: cfg.size, response_format: 'b64_json' };
    if (negativePrompt) body.negative_prompt = negativePrompt;
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

async function generateImageGemini(prompt, cfg) {
    // Mimics sillyimages generateImageGemini OpenAI-style proxy call (gemini via OpenAI-compatible
    // gateway). Most users wire nano-banana through such a proxy; full native Gemini SDK is overkill.
    const url = `${cfg.endpoint}/v1/chat/completions`;
    const body = {
        model: cfg.model,
        messages: [{ role: 'user', content: prompt }],
        modalities: ['image', 'text'],
    };
    const resp = await directFetch(url, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${cfg.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        const t = await resp.text().catch(() => '');
        throw new Error(`Gemini image ${resp.status}: ${t.slice(0, 200)}`);
    }
    const data = await resp.json();
    // ищем data:image или b64
    const txt = JSON.stringify(data);
    const dataUrlMatch = txt.match(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/);
    if (dataUrlMatch) return dataUrlMatch[0];
    const b64Match = data.choices?.[0]?.message?.images?.[0]?.image_url?.url
        || data.choices?.[0]?.message?.content?.match?.(/[A-Za-z0-9+/=]{200,}/)?.[0];
    if (b64Match) return b64Match.startsWith('data:') ? b64Match : `data:image/png;base64,${b64Match}`;
    throw new Error('Gemini не вернул картинку. Проверь model в sillyimages (нужна *image* модель типа gemini-2.0-flash-exp-image-generation).');
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

// ═══════════════════════════════════════════
// SCORING — вынесено отдельно чтобы избежать круговых импортов
// ═══════════════════════════════════════════

import { getRoster } from './roster.js';
import { loadState } from './state.js';

export function matchScore(boyId, swipeType) {
    const boy = getRoster()[boyId];
    if (!boy) return 0;
    const { vibe } = loadState();
    let raw = 0, maxRaw = 0;
    for (const [tag, weight] of Object.entries(boy.tags || {})) {
        raw += weight * ((vibe[tag] || 0) + 1);
        maxRaw += Math.abs(weight) * 5;
    }
    let score = Math.max(0, Math.min(100, 50 + (raw / Math.max(maxRaw, 1)) * 50));
    if (swipeType === 'super') score += 25;
    score += (Math.random() - 0.5) * 30;
    return Math.max(0, Math.min(100, Math.round(score)));
}

export function isMatch(score) {
    if (score >= 60) return true;
    if (score < 40) return false;
    return Math.random() < (score - 40) / 20;
}

// ═══════════════════════════════════════════
// ШАБЛОН ЛОРБУКА для Spark Roster
// ═══════════════════════════════════════════
// 
// Создай в SillyTavern новый лорбук с любым именем (например "spark-roster-data"),
// добавь в него ОДНУ запись с:
//   • comment = "spark-roster"
//   • content = JSON ниже (можно обернуть в ```json ... ``` или без)
//   • триггеры/глубина по вкусу (для самого расширения они не важны)
//
// В настройках Spark (шестерёнка) впиши имя лорбука и нажми "Перезагрузить ростер".
//
// Поля карточки:
//   name, age, distance       — UI
//   bio                       — текст био на анкете
//   tags_ui: []               — теги-чипы
//   redflag                   — текст красного флага (видимый)
//   tags: { tag: weight }     — для скоринга совместимости (-3..+3)
//   writeStyle                — короткий код стиля
//   styleNote                 — описание стиля для LLM
//   imagePrompt               — промпт для /sd
//   avatarGradient            — CSS для placeholder-аватара
//   initial                   — буква-плейсхолдер
//
// Дополнительно:
//   _order: [...]             — порядок свайпа (если не указан — Object.keys)

const TEMPLATE = {
    "_order": ["artyom", "nikita", "stas", "lev", "yura", "vadim"],

    "artyom": {
        "name": "Артём", "age": 28, "distance": "1.2 км",
        "bio": "Пеку хлеб, читаю Олди, ищу человека для долгого разговора и совместного утреннего кофе. Без игр.",
        "tags_ui": ["серьёзные отношения", "готовка", "книги", "животные"],
        "redflag": "«без игр» в био — может читаться как нуждающийся в стабильности больше нормы.",
        "tags": { "comfort": 3, "soft": 2, "monogamy": 2, "vanilla": 1, "casual": -2, "dom": -2, "cruelty": -3 },
        "writeStyle": "eager_burst",
        "styleNote": "Отвечает мгновенно, 2-3 длинных тёплых сообщения подряд. Эмодзи редко но искренне. Anxious-attached — переспрашивает, извиняется. PTSD flinch на грубость.",
        "imagePrompt": "warm 28yo man, hazel eyes, messy dark blond hair, soft smile, flour on apron, in artisan bakery with window light, candid photorealistic dating app photo",
        "avatarGradient": "linear-gradient(135deg, #f4a261 0%, #e76f51 100%)",
        "initial": "А"
    }

    // ... остальные парни в том же формате
};

// (этот файл — только для документации, расширение его не загружает)
export default TEMPLATE;

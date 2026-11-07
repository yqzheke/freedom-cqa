// UI explanations are localized; evidence and machine-readable values are not.
// Applied last to both initial and repair instructions, independent of transcript language.
export const explanationLanguage =
  "Язык пояснений интерфейса: русский. Во всех результатах reason и непустой evidence.expected пиши по-русски, независимо от языка диалога, служебных подсказок и предыдущих кандидатов repair. Объясняй только подтверждённые факты; не добавляй факты ради перевода и не копируй пример как готовую оценку. Поле quote не переводи, не перефразируй и не исправляй: оно должно дословно сохранять исходный текст. Для message-reference сервер сам извлечёт исходную реплику без перевода. Сохраняй оригинальное написание имён, названий продуктов и кодов ошибок, если они нужны в пояснении. Не переводи JSON-ключи, id, status, kind, answer или значения шкал; answer сохраняет требуемый тип и литерал. Пустой expected при цитате или ссылке остаётся пустым.";
export const outputLanguage = {
  reason: "ru",
  nonemptyExpected: "ru",
  quote: "verbatim_source_language",
  machineValues: "unchanged",
} as const;

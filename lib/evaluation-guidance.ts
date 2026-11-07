import { isDeepStrictEqual } from "node:util";
import type { Criterion } from "./domain";
import { official } from "./official";

// Supplemental reading guidance, never a replacement for a saved rubric.
// Match the complete definition so a reused ID in a custom version cannot
// silently inherit the official criterion's semantics.
export function evaluationGuidance(c: Criterion) {
  if (
    isDeepStrictEqual(
      c,
      official.criteria.find((c) => c.id === "contact"),
    )
  ) {
    return {
      requiredChecks: [
        "Use roleAnchors.firstOperatorMessageNumber as the first human operator response. Read that exact transcript entry; bot and system messages are not operator responses even if their text resembles a greeting or introduction. If there is no operator message, do not invent one.",
        "Check a greeting in the client's language in that first response.",
        "Separately check explicit operator self-introduction in that same response. A greeting or offer of help alone does not identify the operator.",
        "Return true only when both checks pass. A missing introduction means false even if greeting and politeness are correct. Explain both checks in reason and cite their exact evidence; for a missing introduction cite the inspected first-response range with nonempty expected.",
      ],
    };
  }
  if (
    isDeepStrictEqual(
      c,
      official.criteria.find((c) => c.id === "needs"),
    )
  ) {
    return {
      requiredChecks: [
        "Evaluate data sufficient from the start using only information already available before the operator's clarification. Never treat facts supplied later as initially known.",
        "Identify which missing detail was actually necessary for the substantive answer or next step. Follow the timeline: initial request, operator question, client's new detail, substantive answer. Use only observable content; do not invent an information gap.",
        "If necessary information was missing initially, the operator elicited it and used it before answering, choose applicable with true, not na. Explain the initial gap and when it was filled; cite the operator's clarifying question with the correct messageNumber.",
        "If necessary information was missing but the operator answered without clarifying it, choose applicable with false and an explained inspected range. Merely asking a question does not prove clarification was completed.",
        "If all information necessary for the answer was already present initially, choose na even if the operator asks a redundant question. Do not infer applicability from a question mark alone.",
        "The request being public or not requiring identity verification is not this criterion's NA condition. Successful resolution later does not prove initial sufficiency. A chat ending before a request was formulated is another criterion's condition, not a substitute for this one. If the evidence genuinely cannot establish this criterion's applicability, use review rather than inventing a fact.",
      ],
    };
  }
  if (
    isDeepStrictEqual(
      c,
      official.criteria.find((c) => c.id === "flow"),
    )
  ) {
    return {
      requiredChecks: [
        "Понятие заметного сбоя в этой шкале относится к ясности, связности, порядку ответов, предусмотренным требованиям скорости, грамотности и предупреждения об ожидании. Оценивай именно эти признаки, а не общее впечатление от обслуживания.",
        "Невежливость, оскорбление, отсутствие представления или неполнота решения сами по себе не являются основанием снижать этот критерий: их оценивают соответствующие отдельные критерии. Однако один эпизод может независимо нарушать и управление диалогом: тогда укажи конкретную неясность, противоречие, нарушение порядка или ожидания и доказательство. Не игнорируй такой реальный сбой лишь потому, что эпизод уже учтён в другом критерии.",
        "Выбирай уровень только по указанной шкале. При снижении в reason назови конкретный сбой именно управления диалогом и объясни соответствие ступени шкалы. Если ответы ясны и связны и требования ожидания выполнены, один лишь плохой тон не понижает этот уровень. При действительно недостаточных данных используй review, а не выдумывай сбой или автоматически ставь максимум.",
        "Различай соседние ступени по последствиям сбоя. 7: есть заметный сбой, но клиент понимает ответ и может продолжить. 4: клиенту приходится переспрашивать именно из-за формулировок или порядка ответа; если это установлено, факт последующего исправления или успешного завершения не превращает этот эпизод в 7. 0: бессвязность или противоречия делают ход диалога непонятным. 10: ясные связные ответы с выполненными требованиями ожидания. Не выбирай 7 как универсальную середину для любого недостатка.",
        "Не путай переспрашивание из-за неясного ответа с новым самостоятельным вопросом клиента, обычным подтверждением или запросом новой информации. Обоснуй причинную связь конкретными репликами: какой ответ был неясен и что клиент вынужден уточнять. Не придумывай эту связь. Если одновременно подходят разные ступени, укажи наиболее серьёзное подтверждённое последствие по этой шкале, а не усредняй их.",
      ],
    };
  }
  if (
    isDeepStrictEqual(
      c,
      official.criteria.find((c) => c.id === "close"),
    )
  ) {
    return {
      requiredChecks: [
        "Проверяй две независимые части: (оператор подвёл содержательный итог ИЛИ предложил дальнейшую помощь) И оператор попрощался. Да требует обе части; укажи отдельное основание каждой, они могут находиться в разных репликах оператора.",
        "Прощание и вежливый ответ на благодарность сами по себе не являются итогом или предложением помощи. Итог должен выражать результат или выполненное действие; предложение помощи должно явно относиться к дальнейшим вопросам или помощи. Не добавляй недосказанный смысл к короткой вежливой фразе.",
        "Используй реальные реплики с speaker=operator и roleAnchors; завершение бота или слова клиента не заменяют действие оператора. Если возможность завершить была, но одна обязательная часть отсутствует, поставь Нет и укажи проверенный диапазон. N/A только при подтверждённом обрыве до возможности завершения, не из-за отсутствия нужной фразы.",
      ],
    };
  }
  return undefined;
}

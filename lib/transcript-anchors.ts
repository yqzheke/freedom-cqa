import type { Dialogue } from "./domain";
// Deterministic role positions only. Never infer a speaker from the message text.
export function transcriptAnchors(d: Dialogue) {
  const positions = (role: string) =>
    d.transcript.flatMap((message, index) =>
      message.speaker === role ? [index + 1] : [],
    );
  const operatorMessageNumbers = positions("operator");
  return {
    firstOperatorMessageNumber: operatorMessageNumbers[0] ?? null,
    lastOperatorMessageNumber: operatorMessageNumbers.at(-1) ?? null,
    operatorMessageNumbers,
    botMessageNumbers: positions("bot"),
    systemMessageNumbers: positions("system"),
  };
}

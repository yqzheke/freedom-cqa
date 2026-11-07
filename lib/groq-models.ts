// Explicit allowlist: selection never changes provider or bypasses free-tier guards.
export const groqModel = "qwen/qwen3.8-27b";
export const groqModels = [groqModel, "openai/gpt-oss-120b"] as const;
export function isGroqModel(model: string): boolean {
  return groqModels.some(candidate => candidate === model);
}
export function configuredGroqModel(): string {
  const model = process.env.GROQ_TEXT_MODEL ?? groqModel;
  if (!isGroqModel(model)) throw Error("Unsupported GROQ_TEXT_MODEL");
  return model;
}
export function groqReasoning(model: string) {
  if (!isGroqModel(model)) throw Error("Unsupported Groq model");
  return model === groqModel
    ? { reasoning_format: "hidden", reasoning_effort: "none" }
    : { include_reasoning: false, reasoning_effort: "low" };
}

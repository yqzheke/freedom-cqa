import { expect, it } from "vitest";
import { explanationLanguage, outputLanguage } from "../../lib/output-language";
import { resolveMessageEvidence } from "../../lib/message-evidence";
import { finding } from "../../lib/domain";
import { seed } from "../../lib/store";
it.each(["demo-RU", "demo-KZ", "demo-EN"])(
  "localizes explanation policy without translating source evidence for %s",
  (id) => {
    const doc = seed().docs.find((d) => d.id === id)!.data;
    const source = doc.transcript[1].text;
    const f = finding.parse(
      resolveMessageEvidence(
        {
          id: "contact",
          status: "applicable",
          answer: false,
          reason: "Оператор не представился",
          critical: false,
          evidence: [{ kind: "message", messageNumber: 2 }],
        },
        doc,
      ),
    );
    expect(f.reason).toBe("Оператор не представился");
    expect(f.evidence[0].quote).toBe(source);
    expect(f.evidence[0].expected).toBe("");
    expect(f.status).toBe("applicable");
    expect(f.answer).toBe(false);
    expect(outputLanguage.reason).toBe("ru");
    expect(outputLanguage.nonemptyExpected).toBe("ru");
    expect(explanationLanguage).toContain("не добавляй факты ради перевода");
    expect(explanationLanguage).toContain("Поле quote не переводи");
  },
);

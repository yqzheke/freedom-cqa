import { readFile } from "node:fs/promises";
const [truthFile, resultFile] = process.argv.slice(2);
if (!truthFile || !resultFile)
  throw Error("Usage: node scripts/compare.mjs truth.json results.json");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const truth = await read(truthFile),
  results = await read(resultFile);
function index(rows) {
  const map = new Map();
  for (const row of rows) {
    if (
      !row.conversation_id ||
      map.has(row.conversation_id) ||
      !row.answers ||
      !Object.hasOwn(row, "score") ||
      (row.score !== null && !Number.isFinite(row.score))
    )
      throw Error("Invalid or duplicate row");
    map.set(row.conversation_id, row);
  }
  return map;
}
const expected = index(truth),
  actual = index(results);
let distance = 0,
  numeric = 0,
  missing = 0,
  exact = 0,
  count = 0;
const criteria = {};
for (const [id, gold] of expected) {
  const row = actual.get(id);
  if (!row) {
    missing++;
    continue;
  }
  if (Number.isFinite(row.score) && Number.isFinite(gold.score)) {
    distance += Math.abs(row.score - gold.score);
    numeric++;
  }
  for (const [id, value] of Object.entries(gold.answers)) {
    const hit = row.answers[id] === value;
    count++;
    exact += Number(hit);
    const stat = (criteria[id] ??= { matched: 0, total: 0 });
    stat.matched += Number(hit);
    stat.total++;
  }
}
console.log(
  JSON.stringify(
    {
      referenceCount: expected.size,
      missing,
      pairedNumericScores: numeric,
      meanAbsoluteScoreError: numeric ? distance / numeric : null,
      criterionAgreement: count ? exact / count : null,
      criteria,
    },
    null,
    2,
  ),
);

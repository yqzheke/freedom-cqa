export function Observations({ value }: { value: string }) {
  let parsed: {
    segments: {
      criterionId: string;
      startSeconds: number;
      endSeconds: number;
      operatorIdentifiable: boolean;
      observation: string;
    }[];
    limitations: string;
  };
  try {
    parsed = JSON.parse(value);

  } catch {
    return <p>{value}</p>;
  }
  if (!parsed || !Array.isArray(parsed.segments)) return <p>{value}</p>;
  return (
    <>
      {parsed.segments.map((s, i) => (
        <article key={i}>
          <button
            onClick={() => {
              const player = document.querySelector("audio");
              if (player) {
                player.currentTime = s.startSeconds;
                void player.play().catch(() => {});
              }
            }}
          >
            ≈ {s.startSeconds}–{s.endSeconds} с · {s.criterionId}
          </button>
          <p>{s.observation}</p>
          {!s.operatorIdentifiable && <small>Говорящий не установлен</small>}
        </article>
      ))}
      <p>{parsed.limitations}</p>
    </>
  );
}

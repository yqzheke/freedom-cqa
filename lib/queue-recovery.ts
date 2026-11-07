/** After an ambiguous mutation failure, read persisted status before another step. */
export function recoverQueueState(refresh: () => Promise<void>, report: (error: unknown) => void, delay = 2500) {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout>;
  const retry = async () => {
    try { await refresh(); } catch (error) {
      if (cancelled) return;
      report(error);
      timer = setTimeout(retry, delay);
    }
  };
  timer = setTimeout(retry, delay);
  return () => { cancelled = true; clearTimeout(timer); };
}

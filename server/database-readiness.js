// A health request must finish before Render's five-second probe deadline.
// Keep at most one read-only query in flight, including after its HTTP timeout:
// abandoning the wait must not enqueue another query behind a stalled pool.
export function createReadinessProbe(pool, { timeoutMs = 2000 } = {}) {
  let pending = null;
  return function probe() {
    if (pending) return pending.result;
    const current = {};
    let timer;
    const query = Promise.resolve().then(() => pool.query("SELECT 1"));
    current.result = Promise.race([
      query,
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(new Error("Database readiness timed out"), {
                code: "ETIMEDOUT",
              }),
            ),
          timeoutMs,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    pending = current;
    const settled = () => {
      if (pending === current) pending = null;
    };
    query.then(settled, settled);
    return current.result;
  };
}

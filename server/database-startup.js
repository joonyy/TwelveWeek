import { setTimeout as sleep } from "node:timers/promises";
import { databaseErrorCode, isDatabaseUnavailable } from "./database-errors.js";

export async function initializeDatabase({
  migrate,
  signal,
  wait = sleep,
  log = console.error,
}) {
  let attempts = 0;
  while (!signal?.aborted) {
    try {
      await migrate();
      return;
    } catch (error) {
      // Authentication, invalid schema, and failed migrations must fail closed.
      // Only connection availability is retried; user writes are never replayed.
      if (!isDatabaseUnavailable(error)) throw error;
      const delay = Math.min(1000 * 2 ** Math.min(attempts++, 4), 15000);
      log(
        "[database startup retry]",
        databaseErrorCode(error),
        `in ${delay}ms`,
      );
      await wait(delay, undefined, { signal });
    }
  }
  signal?.throwIfAborted();
}

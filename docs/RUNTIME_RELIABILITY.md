# API and database recovery

## Health endpoints

- `/api/live`: process liveness. Returns 503 until initial migrations succeed, then 200 independently of a temporary database outage. An optional `commit` is the Render-provided deployment SHA. Configure the Render API service's Health Check Path to this endpoint, as declared in `render.yaml`.
- `/api/health`: database readiness. Still executes `SELECT 1`, preserves feature flags, and returns 503 with `DATABASE_UNAVAILABLE` when connectivity fails. Keep monitoring this endpoint so a running process is never confused with a usable database.
- `/api/access`: existing DB-independent compatibility response, available during startup.

Initial connection failures retry with 1/2/4/8/15-second backoff, capped at 15 seconds, and stop on shutdown. Authentication errors and invalid migrations fail closed with exit 1. Data routes return 503 until initialization finishes. A running pool handles and discards broken idle connections; subsequent requests obtain a fresh connection.

Database readiness has a two-second overall deadline, including waiting for a pool connection. Concurrent health requests share one probe. If the HTTP deadline expires, the existing read-only query remains the only probe until it settles; subsequent requests return 503 without accumulating queries. Liveness remains independent of this probe after startup. This bounds readiness response time while the event loop can run; it cannot prevent a CPU stall or a provider restart.

Connection acquisition is bounded to 5 seconds, statements to 10 seconds, lock waits to 5 seconds, and client query waits to 15 seconds. Idle transactions expire after 30 seconds. A failed rollback discards its connection while preserving the original error. User writes, including a failed or ambiguous COMMIT, are never replayed automatically.

Browser API requests, including response-body reads, have a 30-second deadline. AI requests allow 120 seconds for the existing 90-second provider timeout, and calendar requests allow 90 seconds. A timed-out save tells the user to check whether it was applied before retrying; login tokens and editing state are not cleared as an authentication failure.

## Restart diagnostics

The API writes structured `process_started`, `database_ready`, `process_stopping`, `process_exit` and `process_fatal` records with a per-process `bootId`. Graceful shutdown records the received `SIGTERM` or `SIGINT`; the fatal monitor observes errors without suppressing Node's normal crash behavior. A hard kill such as SIGKILL/OOM cannot emit a shutdown record, so correlate the last sample with Render's instance events.

A `runtime_sample` every 30 seconds includes process RSS/heap/external memory, CPU use, maximum event-loop delay and sample lateness, active requests, database pool counts, and the most recent health-check outcomes. Slow, failed or disconnected requests log only their method and Express route template, status and duration. Diagnostic records exclude user IDs, raw URLs/query strings, headers, bodies, credentials, SQL and error messages/stacks. Code-less pg errors are classified as connection closed, connection timeout, pool acquisition timeout, query timeout or unusable client instead of one ambiguous connection label.

Vision background polling allows only one pending poll per open panel. Closing the panel or switching cycles prevents a late poll from applying its response. This removes a reproduced source of overlapping reads; it does not establish or resolve the cause of Aiven's OOM alerts.

## Free-tier operational limits

The ten-minute keepalive is an availability check, not a database power-on API or an uptime guarantee. Aiven Free can power down inactive services and has limited memory. If its console shows **Powered off**, power on the existing service and wait for **Running**; do not create a replacement database, reset credentials, or delete records. Check `/api/health` afterward. Aiven inactivity warnings and an actual OOM event are separate observations.

If a DB interruption leaves the API unavailable, restore the DB first, then restart the existing Render API instance if it does not recover. Deploy hooks are not used to repeatedly restart a stopped database. No additional paid resource or account-wide credential is required for these code changes.

References:

- https://node-postgres.com/apis/pool#events
- https://node-postgres.com/apis/client
- https://render.com/docs/health-checks
- https://aiven.io/docs/products/postgresql/concepts/pg-free-tier

## Validation

Unit coverage checks idle-error process survival without secret logging, no replay after a lost COMMIT, rollback cleanup, startup recovery/backoff/abort, and fatal migration/authentication failures. API checks distinguish initial readiness, DB failure, liveness, and recovery on the same application. An isolated `_test` PostgreSQL integration terminates only that test pool's backend session and verifies a new query reconnects; statement cancellation is also checked on a disposable test connection.

Operational observations and deployment receipts belong in the incident handoff; successful local tests alone do not establish that Render is running the new SHA or that Aiven is currently available.

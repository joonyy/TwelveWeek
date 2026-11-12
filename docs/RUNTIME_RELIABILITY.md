# API and database recovery

## Health endpoints

- `/api/live`: process liveness. Returns 503 until initial migrations succeed, then 200 independently of a temporary database outage. An optional `commit` is the Render-provided deployment SHA. Configure the Render API service's Health Check Path to this endpoint, as declared in `render.yaml`.
- `/api/health`: database readiness. Still executes `SELECT 1`, preserves feature flags, and returns 503 with `DATABASE_UNAVAILABLE` when connectivity fails. Keep monitoring this endpoint so a running process is never confused with a usable database.
- `/api/access`: existing DB-independent compatibility response, available during startup.

Initial connection failures retry with 1/2/4/8/15-second backoff, capped at 15 seconds, and stop on shutdown. Authentication errors and invalid migrations fail closed with exit 1. Data routes return 503 until initialization finishes. A running pool handles and discards broken idle connections; subsequent requests obtain a fresh connection.

Connection acquisition is bounded to 5 seconds, statements to 10 seconds, lock waits to 5 seconds, and client query waits to 15 seconds. Idle transactions expire after 30 seconds. A failed rollback discards its connection while preserving the original error. User writes, including a failed or ambiguous COMMIT, are never replayed automatically.

Browser API requests, including response-body reads, have a 30-second deadline. AI requests allow 120 seconds for the existing 90-second provider timeout, and calendar requests allow 90 seconds. A timed-out save tells the user to check whether it was applied before retrying; login tokens and editing state are not cleared as an authentication failure.

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

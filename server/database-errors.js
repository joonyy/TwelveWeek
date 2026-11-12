const networkCodes = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ENOTFOUND",
  "EAI_AGAIN",
]);
const temporaryPostgresCodes = new Set([
  "53300", // too many connections
  "55P03", // a concurrent startup temporarily holds the migration lock
  "57P01",
  "57P02",
  "57P03", // shutdown, crash, or starting up
]);

export function isDatabaseUnavailable(error) {
  return (
    networkCodes.has(error?.code) ||
    temporaryPostgresCodes.has(error?.code) ||
    /^08[0-9A-Z]{3}$/.test(error?.code || "") ||
    /^(Connection terminated(?: unexpectedly| due to connection timeout)?|timeout exceeded when trying to connect|Query read timeout|Client has encountered a connection error and is not queryable)$/.test(
      error?.message || "",
    )
  );
}

export function databaseErrorCode(error) {
  // Do not log raw errors: connection URLs, SQL, and parameters can be private.
  return /^[A-Z0-9_]{2,32}$/.test(error?.code || "")
    ? error.code
    : isDatabaseUnavailable(error)
      ? "CONNECTION_UNAVAILABLE"
      : "DATABASE_ERROR";
}

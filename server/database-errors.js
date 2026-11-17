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

const connectionMessages = new Map([
  ["Connection terminated", "CONNECTION_CLOSED"],
  ["Connection terminated unexpectedly", "CONNECTION_CLOSED"],
  ["Connection terminated due to connection timeout", "CONNECTION_TIMEOUT"],
  ["timeout exceeded when trying to connect", "POOL_ACQUIRE_TIMEOUT"],
  ["Query read timeout", "QUERY_TIMEOUT"],
  [
    "Client has encountered a connection error and is not queryable",
    "CLIENT_UNUSABLE",
  ],
]);

export function isDatabaseUnavailable(error) {
  return (
    networkCodes.has(error?.code) ||
    temporaryPostgresCodes.has(error?.code) ||
    /^08[0-9A-Z]{3}$/.test(error?.code || "") ||
    connectionMessages.has(error?.message)
  );
}

export function databaseErrorCode(error) {
  // Do not log raw errors: connection URLs, SQL, and parameters can be private.
  return /^[A-Z0-9_]{2,32}$/.test(error?.code || "")
    ? error.code
    : isDatabaseUnavailable(error)
      ? connectionMessages.get(error?.message) || "CONNECTION_UNAVAILABLE"
      : "DATABASE_ERROR";
}

export async function withRequestDeadline(task, timeoutMs = 30000) {
  const controller = new AbortController();
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(
        Object.assign(new Error("Request timed out"), {
          code: "REQUEST_TIMEOUT",
        }),
      );
      controller.abort();
    }, timeoutMs);
  });
  try {
    // Include response-body consumption in the deadline, not just headers.
    return await Promise.race([
      Promise.resolve().then(() => task(controller.signal)),
      deadline,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

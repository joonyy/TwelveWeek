import { randomUUID } from "node:crypto";
import { monitorEventLoopDelay, performance } from "node:perf_hooks";

// Only operational counters and Express route templates belong in these logs.
// Never include URLs, query strings, headers, bodies, error messages or stacks.
export function createRuntimeDiagnostics({
  pool,
  write = (line) => console.log(line),
  intervalMs = 30000,
  slowRequestMs = 1000,
} = {}) {
  const bootId = randomUUID();
  const delay = monitorEventLoopDelay({ resolution: 100 });
  delay.enable();
  const health = {};
  let activeRequests = 0;
  let previousCpu = process.cpuUsage();
  let previousTime = performance.now();
  function snapshot() {
    const memory = process.memoryUsage();
    return {
      uptimeSeconds: Math.round(process.uptime()),
      rssMiB: Math.round(memory.rss / 1048576),
      heapUsedMiB: Math.round(memory.heapUsed / 1048576),
      externalMiB: Math.round(memory.external / 1048576),
      eventLoopMaxMs: Math.round(delay.max / 1e6),
      activeRequests,
      pool: {
        total: pool?.totalCount || 0,
        idle: pool?.idleCount || 0,
        waiting: pool?.waitingCount || 0,
      },
    };
  }
  function record(event, fields = {}) {
    write(
      JSON.stringify({
        event,
        at: new Date().toISOString(),
        bootId,
        pid: process.pid,
        ...snapshot(),
        ...fields,
      }),
    );
  }
  const timer = setInterval(() => {
    const cpu = process.cpuUsage();
    const time = performance.now();
    const cpuMs =
      (cpu.user - previousCpu.user + cpu.system - previousCpu.system) / 1000;
    record("runtime_sample", {
      cpuPercent: Math.round((100 * cpuMs) / Math.max(1, time - previousTime)),
      sampleDelayMs: Math.max(0, Math.round(time - previousTime - intervalMs)),
      health,
    });
    previousCpu = cpu;
    previousTime = time;
    delay.reset();
  }, intervalMs);
  timer.unref();
  return {
    record,
    middleware(req, res, next) {
      const started = performance.now();
      activeRequests++;
      let finished = false;
      const complete = (aborted) => {
        if (finished) return;
        finished = true;
        activeRequests--;
        const durationMs = Math.round(performance.now() - started);
        const route =
          typeof req.route?.path === "string" ? req.route.path : "unmatched";
        const status = aborted ? 499 : res.statusCode;
        if (route === "/api/live" || route === "/api/health") {
          const previous = health[route];
          health[route] = {
            count: (previous?.count || 0) + 1,
            status,
            durationMs,
          };
        }
        if (aborted || durationMs >= slowRequestMs || status >= 500) {
          record("request_completed", {
            method: req.method,
            route,
            status,
            durationMs,
          });
        }
      };
      res.once("finish", () => complete(false));
      res.once("close", () => complete(!res.writableFinished));
      next();
    },
    close() {
      clearInterval(timer);
      delay.disable();
    },
  };
}

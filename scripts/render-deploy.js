// Use only service-scoped deploy hooks, never an account-wide Render API key.
import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

function deployURL({ hook, serviceId, sha }) {
  if (!/^[a-f0-9]{40}$/.test(sha || ""))
    throw new Error("A full tested commit SHA is required.");
  let url;
  try {
    url = new URL(hook);
  } catch {
    throw new Error("Missing or invalid Render deploy hook secret.");
  }
  if (
    url.origin !== "https://api.render.com" ||
    url.pathname !== `/deploy/${serviceId}` ||
    !url.searchParams.get("key") ||
    url.username ||
    url.password ||
    url.hash
  ) {
    throw new Error(
      "Deploy hook does not belong to the configured Render service.",
    );
  }
  url.searchParams.set("ref", sha);
  return url;
}

export async function requestDeploy(input, fetchImpl = fetch) {
  const url = deployURL(input);
  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "Render deploy request failed. Check the Render dashboard before retrying; the request may already have been accepted.",
    );
  }
  // Never log response bodies, hook URLs or raw transport errors: they can contain secrets.
  if (![200, 202].includes(response.status))
    throw new Error(
      `Render rejected the deploy request (HTTP ${response.status}).`,
    );
  if (response.status === 202) return { status: "queued", id: null };
  const data = await response.json().catch(() => null);
  if (!/^dep-[a-z0-9]+$/.test(data?.deploy?.id || ""))
    throw new Error(
      "Render accepted the request but returned no valid deploy ID. Check its dashboard before retrying.",
    );
  return { status: "started", id: data.deploy.id };
}

async function main() {
  // Validate both secrets before starting either service, so partial setup fails closed.
  const services = [
    {
      name: "API",
      serviceId: "srv-dbgq7khsrm7s73ehbbi0",
      hook: process.env.RENDER_API_DEPLOY_HOOK,
    },
    {
      name: "Web",
      serviceId: "srv-dbgq7khsrm7s73ehbbh0",
      hook: process.env.RENDER_WEB_DEPLOY_HOOK,
    },
  ];
  if (services.some((s) => !s.hook))
    throw new Error(
      "Set RENDER_API_DEPLOY_HOOK and RENDER_WEB_DEPLOY_HOOK repository secrets first.",
    );
  const sha = process.env.GITHUB_SHA;
  for (const service of services) deployURL({ ...service, sha });
  for (const service of services) {
    const result = await requestDeploy({ ...service, sha });
    const message = `${service.name}: ${result.status}${result.id ? ` (${result.id})` : ""} for ${sha}`;
    console.log(message);
    if (process.env.GITHUB_STEP_SUMMARY)
      await appendFile(process.env.GITHUB_STEP_SUMMARY, `${message}\n\n`);
  }
  if (process.env.GITHUB_STEP_SUMMARY)
    await appendFile(
      process.env.GITHUB_STEP_SUMMARY,
      "Deploy requests were accepted. Build completion and Live status are reported in the Render dashboard.\n",
    );
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

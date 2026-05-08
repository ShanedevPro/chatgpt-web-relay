import http from "node:http";

import { createConfig } from "./config.js";
import { ExtensionBroker, redactSensitiveData } from "./extensionBroker.js";
import { JobNotFoundError, JobValidationError, createJobStore } from "./jobStore.js";

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function sendText(response, statusCode, text) {
  response.writeHead(statusCode, {
    "content-type": "text/plain; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end(text);
}

function sendNoContent(response) {
  response.writeHead(204, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  response.end();
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    return {};
  }

  return JSON.parse(raw);
}

function toJobResponse(job) {
  const conversation = toConversationReference(job);
  return {
    id: job.id,
    status: job.status,
    mode: job.mode ?? "normal",
    conversation: job.conversation ?? "new",
    conversationId: conversation.conversationId,
    conversationUrl: conversation.conversationUrl,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    failedAt: job.failedAt,
    error: job.error,
    resultPath: job.resultPath,
  };
}

function conversationFromPageUrl(rawUrl) {
  if (!rawUrl) {
    return { conversationId: null, conversationUrl: null };
  }

  try {
    const parsed = new URL(rawUrl);
    const match = parsed.pathname.match(/^\/c\/([^/]+)/);
    if (!match) {
      return { conversationId: null, conversationUrl: null };
    }
    const conversationId = decodeURIComponent(match[1]);
    return {
      conversationId,
      conversationUrl: `${parsed.origin}/c/${encodeURIComponent(conversationId)}`,
    };
  } catch {
    return { conversationId: null, conversationUrl: null };
  }
}

function toConversationReference(job) {
  const evidence = job.extensionEvidence ?? {};
  const pageConversation = conversationFromPageUrl(job.extensionPageState?.url);
  const conversationId =
    evidence.response?.conversationId ??
    evidence.request?.conversationId ??
    evidence.deepResearchReport?.conversationId ??
    pageConversation.conversationId ??
    null;

  return {
    conversationId,
    conversationUrl:
      pageConversation.conversationUrl ??
      (conversationId ? `https://chatgpt.com/c/${encodeURIComponent(conversationId)}` : null),
  };
}

function toPublicSource(source = {}) {
  return {
    type: source.type ?? null,
    citationNumber: source.citationNumber ?? null,
    title: source.title ?? "",
    domain: source.domain ?? "",
    snippet: source.snippet ?? "",
    link: source.link ?? null,
  };
}

function toPublicImage(image = {}) {
  return {
    index: image.index ?? null,
    contentType: image.contentType ?? "",
    path: image.path ?? "",
    sourceUrl: image.sourceUrl ?? null,
    width: image.width ?? null,
    height: image.height ?? null,
    alt: image.alt ?? "",
  };
}

function toStructuredResultResponse(job, report) {
  const conversation = toConversationReference(job);
  const sourceEvidence = job.extensionEvidence?.sources;
  const sources = Array.isArray(sourceEvidence?.items)
    ? sourceEvidence.items.map((source) => toPublicSource(source))
    : [];
  const sourceCount =
    Number.isFinite(sourceEvidence?.count) && sourceEvidence.count >= sources.length
      ? sourceEvidence.count
      : sources.length;
  const imageEvidence = job.extensionEvidence?.images;
  const images = Array.isArray(imageEvidence?.items)
    ? imageEvidence.items.map((image) => toPublicImage(image))
    : [];
  const imageCount =
    Number.isFinite(imageEvidence?.count) && imageEvidence.count >= images.length
      ? imageEvidence.count
      : images.length;

  return {
    id: job.id,
    status: job.status,
    mode: job.mode ?? "normal",
    conversation: job.conversation ?? "new",
    conversationId: conversation.conversationId,
    conversationUrl: conversation.conversationUrl,
    report,
    sources,
    sourceCount,
    images,
    imageCount,
    resultPath: job.resultPath,
    completedAt: job.completedAt,
  };
}

export async function createRelayServer(options = {}) {
  const config = options.config ?? createConfig(options);
  const jobStore =
    options.jobStore ??
    createJobStore({
      rootDir: config.localDir,
      jobsDir: config.jobsDir,
      resultsDir: config.resultsDir,
      logsDir: config.logsDir,
    });
  await jobStore.ensureReady();

  const extensionBroker = options.extensionBroker ?? new ExtensionBroker({ jobStore });

  return http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host ?? "127.0.0.1"}`);

      if (request.method === "OPTIONS") {
        sendNoContent(response);
        return;
      }

      if (request.method === "POST" && url.pathname === "/jobs") {
        const body = await readJsonBody(request);
        const job = await jobStore.createJob({
          prompt: body.prompt,
          mode: body.mode,
          conversation: body.conversation,
        });
        extensionBroker.enqueueJob(job.id);
        sendJson(response, 202, toJobResponse(job));
        return;
      }

      if (request.method === "POST" && url.pathname === "/extension/register") {
        const body = await readJsonBody(request);
        const workerInfo = extensionBroker.registerWorker(body);
        sendJson(response, 201, { workerId: workerInfo.id, worker: workerInfo });
        return;
      }

      if (request.method === "GET" && url.pathname === "/extension/task") {
        const workerId = url.searchParams.get("workerId");
        const task = await extensionBroker.getNextTask(workerId);
        sendJson(response, 200, { task });
        return;
      }

      if (request.method === "GET" && url.pathname === "/extension/workers") {
        sendJson(response, 200, { workers: extensionBroker.listWorkers() });
        return;
      }

      const extensionEventMatch = url.pathname.match(/^\/extension\/jobs\/([^/]+)\/event$/);
      if (request.method === "POST" && extensionEventMatch) {
        const body = await readJsonBody(request);
        const job = await extensionBroker.handleJobEvent(extensionEventMatch[1], body);
        sendJson(response, 200, { job: toJobResponse(job) });
        return;
      }

      const extensionAssetMatch = url.pathname.match(/^\/extension\/jobs\/([^/]+)\/assets$/);
      if (request.method === "POST" && extensionAssetMatch) {
        const body = redactSensitiveData(await readJsonBody(request));
        const image = await jobStore.saveImageAsset(extensionAssetMatch[1], body);
        sendJson(response, 201, { image: toPublicImage(image) });
        return;
      }

      const jobMatch = url.pathname.match(/^\/jobs\/([^/]+)$/);
      if (request.method === "GET" && jobMatch) {
        const job = await jobStore.getJob(jobMatch[1]);
        sendJson(response, 200, toJobResponse(job));
        return;
      }

      const structuredResultMatch = url.pathname.match(/^\/jobs\/([^/]+)\/result\.json$/);
      if (request.method === "GET" && structuredResultMatch) {
        const job = await jobStore.getJob(structuredResultMatch[1]);
        const report = await jobStore.readResult(structuredResultMatch[1]);
        sendJson(response, 200, toStructuredResultResponse(job, report));
        return;
      }

      const resultMatch = url.pathname.match(/^\/jobs\/([^/]+)\/result$/);
      if (request.method === "GET" && resultMatch) {
        const text = await jobStore.readResult(resultMatch[1]);
        sendText(response, 200, text);
        return;
      }

      sendJson(response, 404, { error: "Not found." });
    } catch (error) {
      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: "Invalid JSON body." });
      } else if (error instanceof JobValidationError) {
        sendJson(response, 400, { error: error.message });
      } else if (error instanceof JobNotFoundError) {
        sendJson(response, 404, { error: error.message });
      } else {
        sendJson(response, 500, { error: error.message });
      }
    }
  });
}

export async function startServer(options = {}) {
  const config = options.config ?? createConfig(options);
  const server = await createRelayServer({ ...options, config });
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? config.port;

  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({ server, host, port });
    });
  });
}

import { randomUUID } from "node:crypto";

import { JobNotFoundError, JobValidationError, formatImageResultMarkdown } from "./jobStore.js";

export const SUPPORTED_CONTENT_VERSION = "2026-04-30-status-filter-relay";

const SENSITIVE_KEYS = /(?:authorization|cookie|set-cookie|access.?token|refresh.?token|session.?token|api.?key|csrf|secret)/i;
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_PATTERN = /\bBearer\s+[A-Za-z0-9._~+/=-]+\b/gi;
const ALLOWED_EVENT_STATUSES = new Set([
  "ready",
  "running",
  "progress",
  "needs_user_input",
  "completed",
  "failed",
]);

function nowIso() {
  return new Date().toISOString();
}

function buildWorkerId() {
  return `worker-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function redactString(value) {
  return value.replace(BEARER_PATTERN, "Bearer [redacted]").replace(JWT_PATTERN, "[jwt-redacted]");
}

export function redactSensitiveData(value) {
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SENSITIVE_KEYS.test(key) ? "[redacted]" : redactSensitiveData(item),
      ]),
    );
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}

function sanitizeWorkerInput(input = {}) {
  const redacted = redactSensitiveData(input);
  return {
    url: String(redacted.url ?? ""),
    title: String(redacted.title ?? ""),
    userAgent: String(redacted.userAgent ?? ""),
    pageState: redacted.pageState && typeof redacted.pageState === "object" ? redacted.pageState : {},
  };
}

function mergeEvidence(existing = {}, incoming = {}) {
  const safeExisting = existing && typeof existing === "object" ? existing : {};
  const safeIncoming = incoming && typeof incoming === "object" ? incoming : {};
  return {
    ...safeExisting,
    ...safeIncoming,
    images: safeIncoming.images ?? safeExisting.images,
  };
}

function imagesFromEvidence(evidence = {}) {
  return Array.isArray(evidence.images?.items) ? evidence.images.items : [];
}

function isWorkerStale(worker, workerStaleMs) {
  return Date.now() - worker.lastSeenMs > workerStaleMs;
}

function isWorkerOutdated(worker) {
  return worker.pageState?.contentVersion !== SUPPORTED_CONTENT_VERSION;
}

function hasActiveWorkerJob(workers, workerStaleMs) {
  return Array.from(workers.values()).some(
    (worker) =>
      worker.activeJobId &&
      !isWorkerStale(worker, workerStaleMs) &&
      !isWorkerOutdated(worker),
  );
}

function toPublicWorker(worker, workerStaleMs) {
  const stale = isWorkerStale(worker, workerStaleMs);
  const outdated = !stale && isWorkerOutdated(worker);
  return {
    id: worker.id,
    status: stale ? "stale" : outdated ? "outdated" : worker.status,
    activeJobId: worker.activeJobId,
    url: worker.url,
    title: worker.title,
    pageState: worker.pageState,
    registeredAt: worker.registeredAt,
    lastSeenAt: worker.lastSeenAt,
  };
}

export class ExtensionBroker {
  constructor({ jobStore, workerStaleMs = 30000 } = {}) {
    if (!jobStore) {
      throw new Error("ExtensionBroker requires a jobStore.");
    }

    this.jobStore = jobStore;
    this.workerStaleMs = workerStaleMs;
    this.workers = new Map();
    this.queue = [];
  }

  pruneInactiveStaleWorkers() {
    for (const [workerId, worker] of this.workers.entries()) {
      if (!worker.activeJobId && isWorkerStale(worker, this.workerStaleMs)) {
        this.workers.delete(workerId);
      }
    }
  }

  registerWorker(input = {}) {
    this.pruneInactiveStaleWorkers();
    const workerInput = sanitizeWorkerInput(input);
    const timestamp = nowIso();
    const worker = {
      id: buildWorkerId(),
      status: "ready",
      activeJobId: null,
      registeredAt: timestamp,
      lastSeenAt: timestamp,
      lastSeenMs: Date.now(),
      ...workerInput,
    };
    this.workers.set(worker.id, worker);
    return toPublicWorker(worker, this.workerStaleMs);
  }

  heartbeat(workerId, input = {}) {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new JobValidationError(`Extension worker not found: ${workerId}`);
    }

    const workerInput = sanitizeWorkerInput(input);
    Object.assign(worker, workerInput, {
      lastSeenAt: nowIso(),
      lastSeenMs: Date.now(),
    });
    if (!worker.activeJobId && worker.status !== "failed") {
      worker.status = "ready";
    }
    return toPublicWorker(worker, this.workerStaleMs);
  }

  listWorkers() {
    this.pruneInactiveStaleWorkers();
    return Array.from(this.workers.values()).map((worker) =>
      toPublicWorker(worker, this.workerStaleMs),
    );
  }

  enqueueJob(id) {
    if (!this.queue.includes(id)) {
      this.queue.push(id);
    }
  }

  async getNextTask(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) {
      throw new JobValidationError(`Extension worker not found: ${workerId}`);
    }

    worker.lastSeenAt = nowIso();
    worker.lastSeenMs = Date.now();

    if (
      worker.activeJobId ||
      this.queue.length === 0 ||
      hasActiveWorkerJob(this.workers, this.workerStaleMs)
    ) {
      return null;
    }

    if (isWorkerOutdated(worker)) {
      worker.status = "outdated";
      return null;
    }

    const jobId = this.queue.shift();
    let job;
    try {
      job = await this.jobStore.startJob(jobId);
    } catch (error) {
      if (error instanceof JobNotFoundError) {
        return null;
      }
      throw error;
    }

    worker.status = "running";
    worker.activeJobId = job.id;
    await this.jobStore.appendLog(job.id, `Assigned to extension worker ${worker.id}.`);

    return {
      id: job.id,
      mode: job.mode ?? "normal",
      conversation: job.conversation ?? "new",
      prompt: job.prompt,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
    };
  }

  async handleJobEvent(jobId, event = {}) {
    const safeEvent = redactSensitiveData(event);
    const status = String(safeEvent.status ?? safeEvent.type ?? "progress");
    if (!ALLOWED_EVENT_STATUSES.has(status)) {
      throw new JobValidationError(`Invalid extension event status: ${status}`);
    }

    const worker = this.workers.get(safeEvent.workerId);
    if (worker) {
      worker.lastSeenAt = nowIso();
      worker.lastSeenMs = Date.now();
      worker.pageState = safeEvent.pageState && typeof safeEvent.pageState === "object" ? safeEvent.pageState : worker.pageState;
    }

    await this.jobStore.appendLog(jobId, `Extension event: ${status}.`);

    if (status === "ready" || status === "progress" || status === "running") {
      if (worker) {
        worker.status = status === "running" ? "running" : worker.activeJobId ? "running" : "ready";
      }
      const current = await this.jobStore.getJob(jobId);
      return this.jobStore.updateJob(jobId, {
        extensionEvidence: mergeEvidence(current.extensionEvidence, safeEvent.evidence),
        extensionPageState: safeEvent.pageState,
        extensionPartialText: safeEvent.text,
      });
    }

    if (worker) {
      worker.activeJobId = null;
      worker.status = status === "failed" ? "failed" : "ready";
    }

    if (status === "completed") {
      const current = await this.jobStore.getJob(jobId);
      const extensionEvidence = mergeEvidence(current.extensionEvidence, safeEvent.evidence);
      await this.jobStore.updateJob(jobId, {
        extensionEvidence,
        extensionPageState: safeEvent.pageState,
      });

      let resultText = String(safeEvent.text ?? "").trim();
      if ((current.mode ?? "normal") === "create_image") {
        const images = imagesFromEvidence(extensionEvidence);
        if (images.length === 0) {
          return this.jobStore.failJob(
            jobId,
            "Create image completed without saved image assets.",
          );
        }
        resultText = resultText || formatImageResultMarkdown(images);
      }

      return this.jobStore.completeJob(jobId, resultText);
    }

    if (status === "needs_user_input") {
      const current = await this.jobStore.getJob(jobId);
      await this.jobStore.updateJob(jobId, {
        extensionEvidence: mergeEvidence(current.extensionEvidence, safeEvent.evidence),
        extensionPageState: safeEvent.pageState,
      });
      return this.jobStore.markNeedsUserInput(
        jobId,
        safeEvent.error ?? safeEvent.message ?? "ChatGPT needs manual input.",
      );
    }

    const current = await this.jobStore.getJob(jobId);
    await this.jobStore.updateJob(jobId, {
      extensionEvidence: mergeEvidence(current.extensionEvidence, safeEvent.evidence),
      extensionPageState: safeEvent.pageState,
    });
    return this.jobStore.failJob(jobId, safeEvent.error ?? safeEvent.message ?? "Extension job failed.");
  }

  async unregisterWorker(workerId) {
    const worker = this.workers.get(workerId);
    if (!worker) {
      return null;
    }

    this.workers.delete(workerId);
    if (worker.activeJobId) {
      await this.jobStore.markNeedsUserInput(
        worker.activeJobId,
        `Extension worker ${workerId} disconnected before the job completed.`,
      );
    }

    return toPublicWorker(worker, this.workerStaleMs);
  }
}

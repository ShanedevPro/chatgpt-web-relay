import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const VALID_STATUSES = new Set(["pending", "running", "needs_user_input", "completed", "failed"]);
const VALID_MODES = new Set(["normal", "deep_research", "create_image"]);
const VALID_CONVERSATIONS = new Set(["new", "current"]);
const IMAGE_EXTENSIONS_BY_CONTENT_TYPE = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/jpg", "jpg"],
  ["image/webp", "webp"],
  ["image/gif", "gif"],
]);

export class JobValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "JobValidationError";
  }
}

export class JobNotFoundError extends Error {
  constructor(id) {
    super(`Job not found: ${id}`);
    this.name = "JobNotFoundError";
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildJobId() {
  return `job-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function validatePrompt(prompt) {
  const normalized = String(prompt ?? "").trim();
  if (!normalized) {
    throw new JobValidationError("Prompt is required.");
  }
  return normalized;
}

function validateMode(mode) {
  const normalized = String(mode ?? "normal").trim() || "normal";
  if (!VALID_MODES.has(normalized)) {
    throw new JobValidationError(`Invalid job mode: ${normalized}`);
  }
  return normalized;
}

function validateConversation(conversation) {
  const normalized = String(conversation ?? "new").trim() || "new";
  if (!VALID_CONVERSATIONS.has(normalized)) {
    throw new JobValidationError(`Invalid conversation target: ${normalized}`);
  }
  return normalized;
}

function normalizeJobInput(input, maybeMode) {
  if (typeof input === "object" && input !== null) {
    return {
      prompt: validatePrompt(input.prompt),
      mode: validateMode(input.mode),
      conversation: validateConversation(input.conversation),
    };
  }

  return {
    prompt: validatePrompt(input),
    mode: validateMode(maybeMode),
    conversation: validateConversation(),
  };
}

function assertValidStatus(status) {
  if (!VALID_STATUSES.has(status)) {
    throw new JobValidationError(`Invalid job status: ${status}`);
  }
}

function normalizeImageContentType(contentType) {
  const normalized = String(contentType ?? "").trim().toLowerCase();
  if (!IMAGE_EXTENSIONS_BY_CONTENT_TYPE.has(normalized)) {
    throw new JobValidationError(`Unsupported image content type: ${normalized || "(empty)"}`);
  }
  return normalized;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function imageMarkdownAlt(image) {
  return `Generated image ${image.index}`;
}

export function formatImageResultMarkdown(images = []) {
  const validImages = Array.isArray(images) ? images : [];
  const summary = `Generated ${validImages.length} ${validImages.length === 1 ? "image" : "images"}.`;
  const links = validImages.map((image) => `![${imageMarkdownAlt(image)}](${image.path})`);
  return [summary, ...links].join("\n\n");
}

export function createJobStore(options = {}) {
  const rootDir = path.resolve(options.rootDir ?? process.cwd());
  const jobsDir = path.resolve(options.jobsDir ?? path.join(rootDir, "jobs"));
  const resultsDir = path.resolve(options.resultsDir ?? path.join(rootDir, "results"));
  const logsDir = path.resolve(options.logsDir ?? path.join(rootDir, "logs"));

  function jobPath(id) {
    return path.join(jobsDir, `${id}.json`);
  }

  function resultPath(id) {
    return path.join(resultsDir, `${id}.md`);
  }

  function imageResultsDir(id) {
    return path.join(resultsDir, id);
  }

  function logPath(id) {
    return path.join(logsDir, `${id}.log`);
  }

  async function ensureReady() {
    await Promise.all([
      mkdir(jobsDir, { recursive: true }),
      mkdir(resultsDir, { recursive: true }),
      mkdir(logsDir, { recursive: true }),
    ]);
  }

  async function writeJob(job) {
    await ensureReady();
    const outputPath = jobPath(job.id);
    const temporaryPath = `${outputPath}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(job, null, 2)}\n`, "utf8");
    await rename(temporaryPath, outputPath);
    return job;
  }

  async function getJob(id) {
    try {
      const raw = await readFile(jobPath(id), "utf8");
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === "ENOENT") {
        throw new JobNotFoundError(id);
      }
      throw error;
    }
  }

  async function createJob(input, mode) {
    const {
      prompt: normalizedPrompt,
      mode: normalizedMode,
      conversation: normalizedConversation,
    } = normalizeJobInput(input, mode);
    const timestamp = nowIso();
    const job = {
      id: buildJobId(),
      status: "pending",
      mode: normalizedMode,
      conversation: normalizedConversation,
      prompt: normalizedPrompt,
      createdAt: timestamp,
      updatedAt: timestamp,
      startedAt: null,
      completedAt: null,
      failedAt: null,
      error: null,
      resultPath: null,
      resultText: null,
    };

    return writeJob(job);
  }

  async function updateJob(id, patch) {
    const current = await getJob(id);
    if (patch.status) {
      assertValidStatus(patch.status);
    }

    const updated = {
      ...current,
      ...patch,
      updatedAt: nowIso(),
    };

    return writeJob(updated);
  }

  async function startJob(id) {
    return updateJob(id, {
      status: "running",
      startedAt: nowIso(),
      error: null,
    });
  }

  async function markNeedsUserInput(id, message) {
    return updateJob(id, {
      status: "needs_user_input",
      error: message,
    });
  }

  async function failJob(id, error) {
    const message = error instanceof Error ? error.message : String(error);
    return updateJob(id, {
      status: "failed",
      failedAt: nowIso(),
      error: message,
    });
  }

  async function completeJob(id, resultText) {
    const output = String(resultText ?? "").trim();
    const outputPath = resultPath(id);
    await ensureReady();
    await writeFile(outputPath, `${output}\n`, "utf8");

    return updateJob(id, {
      status: "completed",
      completedAt: nowIso(),
      error: null,
      resultPath: outputPath,
      resultText: output,
    });
  }

  async function saveImageAsset(id, input = {}) {
    const current = await getJob(id);
    const contentType = normalizeImageContentType(input.contentType);
    const extension = IMAGE_EXTENSIONS_BY_CONTENT_TYPE.get(contentType);
    const existingImages = Array.isArray(current.extensionEvidence?.images?.items)
      ? current.extensionEvidence.images.items
      : [];
    const index = existingImages.length + 1;
    const dataBase64 = String(input.dataBase64 ?? "").trim();
    if (!dataBase64) {
      throw new JobValidationError("Image dataBase64 is required.");
    }

    const bytes = Buffer.from(dataBase64, "base64");
    if (bytes.length === 0) {
      throw new JobValidationError("Image dataBase64 did not decode to bytes.");
    }

    await ensureReady();
    const outputDir = imageResultsDir(id);
    await mkdir(outputDir, { recursive: true });
    const outputPath = path.join(outputDir, `image-${index}.${extension}`);
    await writeFile(outputPath, bytes);

    const image = {
      index,
      contentType,
      path: outputPath,
      sourceUrl: input.sourceUrl ? String(input.sourceUrl) : null,
      width: numberOrNull(input.width),
      height: numberOrNull(input.height),
      alt: input.alt ? String(input.alt) : "generated image",
    };

    await updateJob(id, {
      extensionEvidence: {
        ...(current.extensionEvidence ?? {}),
        images: {
          count: existingImages.length + 1,
          items: [...existingImages, image],
        },
      },
    });

    return image;
  }

  async function readResult(id) {
    const job = await getJob(id);
    if (!job.resultPath) {
      throw new JobValidationError(`Job has no saved result: ${id}`);
    }
    return readFile(job.resultPath, "utf8").then((text) => text.replace(/\n$/, ""));
  }

  async function appendLog(id, message) {
    await ensureReady();
    const line = `[${nowIso()}] ${message}\n`;
    await writeFile(logPath(id), line, { encoding: "utf8", flag: "a" });
  }

  return {
    rootDir,
    jobsDir,
    resultsDir,
    logsDir,
    ensureReady,
    createJob,
    getJob,
    updateJob,
    startJob,
    markNeedsUserInput,
    failJob,
    completeJob,
    saveImageAsset,
    readResult,
    appendLog,
  };
}

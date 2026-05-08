import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ExtensionBroker,
  SUPPORTED_CONTENT_VERSION,
  redactSensitiveData,
} from "../src/extensionBroker.js";
import { createJobStore } from "../src/jobStore.js";

async function createBrokerFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-broker-"));
  const jobStore = createJobStore({ rootDir });
  await jobStore.ensureReady();
  const broker = new ExtensionBroker({ jobStore, workerStaleMs: 1000 });
  return { rootDir, jobStore, broker };
}

function registerWorker(broker, input = {}) {
  return broker.registerWorker({
    url: "https://chatgpt.com/",
    ...input,
    pageState: {
      contentVersion: SUPPORTED_CONTENT_VERSION,
      ...(input.pageState ?? {}),
    },
  });
}

test("redactSensitiveData removes token-like values and sensitive fields", () => {
  const redacted = redactSensitiveData({
    accessToken: "eyJabc.def.ghi",
    nested: {
      authorization: "Bearer secret-value",
      cookie: "oai=secret; other=value",
      text: "prefix eyJhbGciOi.test.signature suffix",
    },
  });

  assert.equal(redacted.accessToken, "[redacted]");
  assert.equal(redacted.nested.authorization, "[redacted]");
  assert.equal(redacted.nested.cookie, "[redacted]");
  assert.equal(redacted.nested.text, "prefix [jwt-redacted] suffix");
});

test("extension broker registers a worker and assigns one job at a time", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const worker = registerWorker(broker, {
      pageState: { editorFound: true },
    });
    const first = await jobStore.createJob({
      prompt: "Research this.",
      mode: "deep_research",
      conversation: "current",
    });
    const second = await jobStore.createJob("Normal follow-up.");
    broker.enqueueJob(first.id);
    broker.enqueueJob(second.id);

    const firstTask = await broker.getNextTask(worker.id);
    assert.equal(firstTask.id, first.id);
    assert.equal(firstTask.mode, "deep_research");
    assert.equal(firstTask.conversation, "current");
    assert.equal((await jobStore.getJob(first.id)).status, "running");

    const noSecondTaskWhileBusy = await broker.getNextTask(worker.id);
    assert.equal(noSecondTaskWhileBusy, null);

    await broker.handleJobEvent(first.id, {
      workerId: worker.id,
      status: "completed",
      text: "research answer",
      evidence: {
        deepResearchReport: { captureMethod: "deep_research_sandbox_root_frame" },
        response: { researchModelSeen: true },
        sources: {
          count: 1,
          items: [
            {
              citationNumber: "1",
              domain: "example.com",
              link: "https://example.com/source",
              snippet: "Example snippet.",
              title: "Example source",
              type: "citation",
            },
          ],
        },
      },
    });

    const completedFirst = await jobStore.getJob(first.id);
    assert.equal(completedFirst.status, "completed");
    assert.equal(completedFirst.extensionEvidence.sources.count, 1);
    assert.equal(completedFirst.extensionEvidence.sources.items[0].domain, "example.com");

    const secondTask = await broker.getNextTask(worker.id);
    assert.equal(secondTask.id, second.id);
    assert.equal(secondTask.mode, "normal");
    assert.equal(secondTask.conversation, "new");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker assigns create image jobs to workers", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const worker = registerWorker(broker);
    const imageJob = await jobStore.createJob({
      prompt: "Create a simple blue robot icon.",
      mode: "create_image",
    });
    broker.enqueueJob(imageJob.id);

    const task = await broker.getNextTask(worker.id);
    assert.equal(task.id, imageJob.id);
    assert.equal(task.mode, "create_image");
    assert.equal(task.conversation, "new");
    assert.equal(task.prompt, "Create a simple blue robot icon.");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker does not assign jobs to outdated content-script workers", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const outdated = broker.registerWorker({
      url: "https://chatgpt.com/c/old",
      pageState: { contentVersion: "2026-04-29-create-image-relay" },
    });
    const current = registerWorker(broker, {
      url: "https://chatgpt.com/",
    });
    const job = await jobStore.createJob("Use the current extension.");
    broker.enqueueJob(job.id);

    assert.equal((await broker.getNextTask(outdated.id)), null);

    const task = await broker.getNextTask(current.id);
    assert.equal(task.id, job.id);
    assert.equal(broker.listWorkers()[0].status, "outdated");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker assigns only one active job across multiple ready workers", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const firstWorker = registerWorker(broker, { url: "https://chatgpt.com/" });
    const secondWorker = registerWorker(broker, { url: "https://chatgpt.com/c/old" });
    const firstJob = await jobStore.createJob("First browser job.");
    const secondJob = await jobStore.createJob("Second browser job.");
    broker.enqueueJob(firstJob.id);
    broker.enqueueJob(secondJob.id);

    const firstTask = await broker.getNextTask(firstWorker.id);
    assert.equal(firstTask.id, firstJob.id);
    assert.equal(await broker.getNextTask(secondWorker.id), null);

    await broker.handleJobEvent(firstJob.id, {
      workerId: firstWorker.id,
      status: "completed",
      text: "first done",
    });

    const secondTask = await broker.getNextTask(secondWorker.id);
    assert.equal(secondTask.id, secondJob.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker reports stale workers even when the old worker was running", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    broker.workerStaleMs = 1;
    const worker = registerWorker(broker);
    const job = await jobStore.createJob("Long running task.");
    broker.enqueueJob(job.id);
    await broker.getNextTask(worker.id);

    await new Promise((resolve) => setTimeout(resolve, 5));

    const workers = broker.listWorkers();
    assert.equal(workers[0].status, "stale");
    assert.equal(workers[0].activeJobId, job.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker prunes inactive stale workers from the public worker list", async () => {
  const { rootDir, broker } = await createBrokerFixture();

  try {
    broker.workerStaleMs = 1;
    registerWorker(broker);
    await new Promise((resolve) => setTimeout(resolve, 5));
    const currentWorker = registerWorker(broker, {
      url: "https://chatgpt.com/c/current",
    });

    const workers = broker.listWorkers();
    assert.deepEqual(workers.map((worker) => worker.id), [currentWorker.id]);
    assert.equal(workers[0].status, "ready");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker does not let a stale active worker block new jobs", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    broker.workerStaleMs = 1;
    const staleWorker = registerWorker(broker);
    const staleJob = await jobStore.createJob("Interrupted task.");
    broker.enqueueJob(staleJob.id);
    await broker.getNextTask(staleWorker.id);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const currentWorker = registerWorker(broker);
    const currentJob = await jobStore.createJob("Fresh task.");
    broker.enqueueJob(currentJob.id);

    const task = await broker.getNextTask(currentWorker.id);
    assert.equal(task.id, currentJob.id);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker marks jobs as needing user input and handles worker disconnect", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const worker = registerWorker(broker);
    const inputJob = await jobStore.createJob({
      prompt: "Needs login.",
      mode: "deep_research",
    });
    broker.enqueueJob(inputJob.id);
    await broker.getNextTask(worker.id);

    await broker.handleJobEvent(inputJob.id, {
      workerId: worker.id,
      status: "needs_user_input",
      error: "ChatGPT login is required.",
    });
    assert.equal((await jobStore.getJob(inputJob.id)).status, "needs_user_input");

    const disconnectJob = await jobStore.createJob("Disconnect while running.");
    broker.enqueueJob(disconnectJob.id);
    await broker.getNextTask(worker.id);
    await broker.unregisterWorker(worker.id);

    const stored = await jobStore.getJob(disconnectJob.id);
    assert.equal(stored.status, "needs_user_input");
    assert.match(stored.error, /disconnected/i);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension broker preserves safe evidence for failed jobs", async () => {
  const { rootDir, jobStore, broker } = await createBrokerFixture();

  try {
    const worker = registerWorker(broker);
    const job = await jobStore.createJob("Extract this answer.");
    broker.enqueueJob(job.id);
    await broker.getNextTask(worker.id);

    await broker.handleJobEvent(job.id, {
      workerId: worker.id,
      status: "failed",
      error: "Timed out waiting for the ChatGPT answer to stabilize.",
      evidence: {
        answerDebug: {
          latestAssistantText: "visible answer",
          authorization: "Bearer secret",
        },
      },
    });

    const failed = await jobStore.getJob(job.id);
    assert.equal(failed.status, "failed");
    assert.equal(failed.extensionEvidence.answerDebug.latestAssistantText, "visible answer");
    assert.equal(failed.extensionEvidence.answerDebug.authorization, "[redacted]");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});

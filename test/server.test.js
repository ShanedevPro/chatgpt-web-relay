import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { createConfig } from "../src/config.js";
import { ExtensionBroker, SUPPORTED_CONTENT_VERSION } from "../src/extensionBroker.js";
import { createJobStore } from "../src/jobStore.js";
import { createRelayServer } from "../src/server.js";

async function listen(server) {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(`http://${address.address}:${address.port}`);
    });
  });
}

async function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

async function pollCompletedJob(baseUrl, id) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${baseUrl}/jobs/${id}`);
    assert.equal(response.status, 200);
    const job = await response.json();
    if (job.status === "completed") {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for completed job: ${id}`);
}

test("relay API creates a job and returns a saved extension result", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-api-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const extensionBroker = new ExtensionBroker({ jobStore });

  const server = await createRelayServer({ config, jobStore, extensionBroker });
  const baseUrl = await listen(server);

  try {
    const registeredResponse = await fetch(`${baseUrl}/extension/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://chatgpt.com/",
        pageState: { editorFound: true, contentVersion: SUPPORTED_CONTENT_VERSION },
      }),
    });
    assert.equal(registeredResponse.status, 201);
    const registered = await registeredResponse.json();

    const createdResponse = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Test API relay." }),
    });

    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    assert.equal(created.status, "pending");
    assert.equal(created.conversation, "new");

    const taskResponse = await fetch(`${baseUrl}/extension/task?workerId=${registered.workerId}`);
    assert.equal(taskResponse.status, 200);
    const { task } = await taskResponse.json();
    assert.equal(task.id, created.id);

    const eventResponse = await fetch(`${baseUrl}/extension/jobs/${created.id}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: registered.workerId,
        status: "completed",
        text: "fake relay result",
      }),
    });
    assert.equal(eventResponse.status, 200);

    const status = await pollCompletedJob(baseUrl, created.id);
    assert.equal(status.status, "completed");
    assert.equal(status.conversation, "new");
    assert.match(status.resultPath, /job-.+\.md$/);

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result`);
    assert.equal(resultResponse.status, 200);
    assert.equal(await resultResponse.text(), "fake relay result");
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension endpoints register a worker, assign a deep job, and save the result", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-extension-api-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const extensionBroker = new ExtensionBroker({ jobStore });

  const server = await createRelayServer({ config, jobStore, extensionBroker });
  const baseUrl = await listen(server);

  try {
    const registeredResponse = await fetch(`${baseUrl}/extension/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://chatgpt.com/",
        pageState: { editorFound: true, contentVersion: SUPPORTED_CONTENT_VERSION },
      }),
    });
    assert.equal(registeredResponse.status, 201);
    const registered = await registeredResponse.json();
    assert.match(registered.workerId, /^worker-/);

    const createdResponse = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Deep relay.",
        mode: "deep_research",
        conversation: "current",
      }),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    assert.equal(created.mode, "deep_research");
    assert.equal(created.conversation, "current");

    const taskResponse = await fetch(`${baseUrl}/extension/task?workerId=${registered.workerId}`);
    assert.equal(taskResponse.status, 200);
    const { task } = await taskResponse.json();
    assert.equal(task.id, created.id);
    assert.equal(task.mode, "deep_research");
    assert.equal(task.conversation, "current");

    const eventResponse = await fetch(`${baseUrl}/extension/jobs/${created.id}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: registered.workerId,
        status: "completed",
        text: "extension deep result",
        evidence: { response: { researchModelSeen: true } },
      }),
    });
    assert.equal(eventResponse.status, 200);

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result`);
    assert.equal(resultResponse.status, 200);
    assert.equal(await resultResponse.text(), "extension deep result");

    const workersResponse = await fetch(`${baseUrl}/extension/workers`);
    assert.equal(workersResponse.status, 200);
    const workers = await workersResponse.json();
    assert.equal(workers.workers[0].status, "ready");
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("structured result endpoint returns a deep research report with public sources", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-result-json-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const extensionBroker = new ExtensionBroker({ jobStore });

  const server = await createRelayServer({ config, jobStore, extensionBroker });
  const baseUrl = await listen(server);

  try {
    const registeredResponse = await fetch(`${baseUrl}/extension/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://chatgpt.com/",
        pageState: { editorFound: true, contentVersion: SUPPORTED_CONTENT_VERSION },
      }),
    });
    assert.equal(registeredResponse.status, 201);
    const registered = await registeredResponse.json();

    const createdResponse = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Deep relay with sources.", mode: "deep_research" }),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();

    const taskResponse = await fetch(`${baseUrl}/extension/task?workerId=${registered.workerId}`);
    assert.equal(taskResponse.status, 200);

    const eventResponse = await fetch(`${baseUrl}/extension/jobs/${created.id}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: registered.workerId,
        status: "completed",
        text: "structured deep research result",
        evidence: {
          deepResearchReport: { captureMethod: "deep_research_sandbox_root_frame" },
          response: { conversationId: "conversation-123" },
          sources: {
            count: 55,
            items: [
              {
                type: "citation",
                citationNumber: "1",
                title: "Smoke Test - ISTQB Glossary",
                domain: "istqb-glossary.page",
                snippet: "Smoke Test. A test suite...",
                link: "https://istqb-glossary.page/smoke-test",
                rawMetadata: "not public",
              },
            ],
          },
        },
      }),
    });
    assert.equal(eventResponse.status, 200);

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result.json`);
    assert.equal(resultResponse.status, 200);
    const result = await resultResponse.json();

    assert.equal(result.id, created.id);
    assert.equal(result.status, "completed");
    assert.equal(result.mode, "deep_research");
    assert.equal(result.conversation, "new");
    assert.equal(result.conversationId, "conversation-123");
    assert.equal(result.conversationUrl, "https://chatgpt.com/c/conversation-123");
    assert.equal(result.report, "structured deep research result");
    assert.deepEqual(result.sources, [
      {
        type: "citation",
        citationNumber: "1",
        title: "Smoke Test - ISTQB Glossary",
        domain: "istqb-glossary.page",
        snippet: "Smoke Test. A test suite...",
        link: "https://istqb-glossary.page/smoke-test",
      },
    ]);
    assert.equal(result.sourceCount, 55);
    assert.match(result.resultPath, /job-.+\.md$/);
    assert.match(result.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Object.hasOwn(result, "extensionEvidence"), false);
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("structured result endpoint returns empty sources for normal completed jobs", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-result-json-normal-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const worker = {
    enqueueJob: async () => {},
  };

  const server = await createRelayServer({ config, jobStore, worker });
  const baseUrl = await listen(server);

  try {
    const created = await jobStore.createJob({ prompt: "Normal relay." });
    await jobStore.completeJob(created.id, "normal relay result");

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result.json`);
    assert.equal(resultResponse.status, 200);
    const result = await resultResponse.json();

    assert.equal(result.id, created.id);
    assert.equal(result.status, "completed");
    assert.equal(result.mode, "normal");
    assert.equal(result.conversation, "new");
    assert.equal(result.conversationId, null);
    assert.equal(result.conversationUrl, null);
    assert.equal(result.report, "normal relay result");
    assert.deepEqual(result.sources, []);
    assert.equal(result.sourceCount, 0);
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("extension asset endpoint saves generated images and exposes them in result json", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-image-api-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const extensionBroker = new ExtensionBroker({ jobStore });

  const server = await createRelayServer({ config, jobStore, extensionBroker });
  const baseUrl = await listen(server);

  try {
    const registeredResponse = await fetch(`${baseUrl}/extension/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        url: "https://chatgpt.com/",
        pageState: { editorFound: true, contentVersion: SUPPORTED_CONTENT_VERSION },
      }),
    });
    assert.equal(registeredResponse.status, 201);
    const registered = await registeredResponse.json();

    const createdResponse = await fetch(`${baseUrl}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        prompt: "Create a simple blue robot icon.",
        mode: "create_image",
      }),
    });
    assert.equal(createdResponse.status, 202);
    const created = await createdResponse.json();
    assert.equal(created.mode, "create_image");

    const taskResponse = await fetch(`${baseUrl}/extension/task?workerId=${registered.workerId}`);
    assert.equal(taskResponse.status, 200);
    const { task } = await taskResponse.json();
    assert.equal(task.id, created.id);
    assert.equal(task.mode, "create_image");

    const assetResponse = await fetch(`${baseUrl}/extension/jobs/${created.id}/assets`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: registered.workerId,
        contentType: "image/png",
        dataBase64: "iVBORw0KGgo=",
        sourceUrl: "https://chatgpt.com/backend-api/generated-image.png",
        width: 1024,
        height: 1024,
        alt: "generated image",
      }),
    });
    assert.equal(assetResponse.status, 201);
    const asset = await assetResponse.json();
    assert.equal(asset.image.index, 1);
    assert.equal(asset.image.contentType, "image/png");
    assert.match(asset.image.path, /job-.+\/image-1\.png$/);
    assert.deepEqual(await readFile(asset.image.path), Buffer.from("iVBORw0KGgo=", "base64"));

    const eventResponse = await fetch(`${baseUrl}/extension/jobs/${created.id}/event`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workerId: registered.workerId,
        status: "completed",
        text: "",
        evidence: { response: { conversationId: "image-conversation-123" } },
      }),
    });
    assert.equal(eventResponse.status, 200);

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result`);
    assert.equal(resultResponse.status, 200);
    const markdown = await resultResponse.text();
    assert.match(markdown, /^Generated 1 image\./);
    assert.match(markdown, /!\[Generated image 1\]\(.+image-1\.png\)/);

    const resultJsonResponse = await fetch(`${baseUrl}/jobs/${created.id}/result.json`);
    assert.equal(resultJsonResponse.status, 200);
    const result = await resultJsonResponse.json();
    assert.equal(result.mode, "create_image");
    assert.equal(result.imageCount, 1);
    assert.deepEqual(result.images, [
      {
        index: 1,
        contentType: "image/png",
        path: asset.image.path,
        sourceUrl: "https://chatgpt.com/backend-api/generated-image.png",
        width: 1024,
        height: 1024,
        alt: "generated image",
      },
    ]);
    assert.equal(result.conversationId, "image-conversation-123");
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

test("structured result endpoint returns the existing no-result error for incomplete jobs", async () => {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-result-json-empty-"));
  const config = createConfig({ rootDir, localDir: rootDir });
  const jobStore = createJobStore({
    rootDir,
    jobsDir: config.jobsDir,
    resultsDir: config.resultsDir,
    logsDir: config.logsDir,
  });
  const worker = {
    enqueueJob: async () => {},
  };

  const server = await createRelayServer({ config, jobStore, worker });
  const baseUrl = await listen(server);

  try {
    const created = await jobStore.createJob({ prompt: "Do not complete yet." });

    const resultResponse = await fetch(`${baseUrl}/jobs/${created.id}/result.json`);
    assert.equal(resultResponse.status, 400);
    const error = await resultResponse.json();
    assert.equal(error.error, `Job has no saved result: ${created.id}`);
  } finally {
    await close(server);
    await rm(rootDir, { recursive: true, force: true });
  }
});

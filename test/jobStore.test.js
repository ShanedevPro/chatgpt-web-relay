import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { JobValidationError, createJobStore } from "../src/jobStore.js";

async function withTempStore(run) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "chatgpt-web-relay-store-"));
  try {
    const store = createJobStore({ rootDir });
    await store.ensureReady();
    await run(store, rootDir);
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
}

test("job store creates and persists a pending job", async () => {
  await withTempStore(async (store, rootDir) => {
    const created = await store.createJob("Explain relay testing.");

    assert.equal(created.status, "pending");
    assert.equal(created.mode, "normal");
    assert.equal(created.conversation, "new");
    assert.equal(created.prompt, "Explain relay testing.");
    assert.match(created.id, /^job-/);
    assert.match(created.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(created.error, null);
    assert.equal(created.resultPath, null);

    const reloadedStore = createJobStore({ rootDir });
    const reloaded = await reloadedStore.getJob(created.id);
    assert.deepEqual(reloaded, created);
  });
});

test("job store stores supported job modes", async () => {
  await withTempStore(async (store) => {
    const normal = await store.createJob("Normal relay.");
    const deep = await store.createJob({
      prompt: "Deep relay.",
      mode: "deep_research",
    });
    const image = await store.createJob({
      prompt: "Create a blue robot icon.",
      mode: "create_image",
    });

    assert.equal(normal.mode, "normal");
    assert.equal(deep.mode, "deep_research");
    assert.equal(image.mode, "create_image");
    assert.equal((await store.getJob(deep.id)).mode, "deep_research");
    assert.equal((await store.getJob(image.id)).mode, "create_image");
  });
});

test("job store stores supported conversation targets", async () => {
  await withTempStore(async (store) => {
    const defaultConversation = await store.createJob("Default conversation.");
    const currentConversation = await store.createJob({
      prompt: "Use the open thread.",
      conversation: "current",
    });
    const newConversation = await store.createJob({
      prompt: "Use a fresh thread.",
      conversation: "new",
    });

    assert.equal(defaultConversation.conversation, "new");
    assert.equal(currentConversation.conversation, "current");
    assert.equal(newConversation.conversation, "new");
    assert.equal((await store.getJob(currentConversation.id)).conversation, "current");
  });
});

test("job store rejects unsupported conversation targets", async () => {
  await withTempStore(async (store) => {
    await assert.rejects(
      () => store.createJob({ prompt: "Bad conversation.", conversation: "history" }),
      JobValidationError,
    );
  });
});

test("job store rejects unsupported job modes", async () => {
  await withTempStore(async (store) => {
    await assert.rejects(
      () => store.createJob({ prompt: "Bad mode.", mode: "image" }),
      JobValidationError,
    );
  });
});

test("job store rejects empty prompts", async () => {
  await withTempStore(async (store) => {
    await assert.rejects(
      () => store.createJob("   \n\t  "),
      (error) => error instanceof JobValidationError && error.message === "Prompt is required.",
    );
  });
});

test("job store updates job status and writes result text", async () => {
  await withTempStore(async (store) => {
    const created = await store.createJob("Return a short answer.");
    const updated = await store.completeJob(created.id, "Short answer.");

    assert.equal(updated.status, "completed");
    assert.equal(updated.resultText, "Short answer.");
    assert.match(updated.resultPath, /job-.+\.md$/);

    const saved = await store.readResult(created.id);
    assert.equal(saved, "Short answer.");
  });
});

test("job store saves image assets under the job result directory", async () => {
  await withTempStore(async (store) => {
    const created = await store.createJob({
      prompt: "Create a tiny transparent PNG.",
      mode: "create_image",
    });
    const image = await store.saveImageAsset(created.id, {
      contentType: "image/png",
      dataBase64: "iVBORw0KGgo=",
      sourceUrl: "https://chatgpt.com/generated/image.png",
      width: 1024,
      height: 1024,
      alt: "generated image",
    });

    assert.equal(image.index, 1);
    assert.equal(image.contentType, "image/png");
    assert.match(image.path, /job-.+\/image-1\.png$/);
    assert.equal(image.sourceUrl, "https://chatgpt.com/generated/image.png");
    assert.equal(image.width, 1024);
    assert.equal(image.height, 1024);
    assert.equal(image.alt, "generated image");

    const stored = await store.getJob(created.id);
    assert.deepEqual(stored.extensionEvidence.images.items, [image]);
    assert.equal(stored.extensionEvidence.images.count, 1);
  });
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import test from "node:test";

async function loadSharedHelpers() {
  const source = await readFile(new URL("../extension/shared.js", import.meta.url), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.ChatGptRelayShared;
}

function fakeElement(text) {
  return {
    innerText: text,
    textContent: text,
  };
}

function fakeDocument(mapping) {
  return {
    querySelectorAll(selector) {
      return mapping[selector] ?? [];
    },
  };
}

test("extension shared helpers recognize current Deep Research UI labels", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(helpers.isDeepResearchControlLabel("Deep research"), true);
  assert.equal(helpers.isDeepResearchControlLabel("深入研究"), true);
  assert.equal(helpers.isDeepResearchControlLabel("Extended"), false);
  assert.equal(helpers.isDeepResearchControlLabel("Extended, click to remove"), false);
  assert.equal(helpers.isDeepResearchControlLabel("Look something up"), false);
  assert.equal(helpers.isDeepResearchSelectedLabel("Deep research, click to remove"), true);
  assert.equal(helpers.isSelectedModeLabel("Extended, click to remove"), true);
  assert.equal(helpers.isToolsMenuControlLabel("Add files and more"), true);
  assert.equal(helpers.isToolsMenuControlLabel("+"), true);
});

test("extension shared helpers recognize New chat controls", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(helpers.isNewConversationControlLabel("New chat"), true);
  assert.equal(helpers.isNewConversationControlLabel("New conversation"), true);
  assert.equal(helpers.isNewConversationControlLabel("Start new chat"), true);
  assert.equal(helpers.isNewConversationControlLabel("Deep research"), false);
});

test("extension shared helpers recognize logged-out ChatGPT controls", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(helpers.isLoginControlLabel("Log in"), true);
  assert.equal(helpers.isLoginControlLabel("Sign up for free"), true);
  assert.equal(helpers.isLoginControlLabel("Continue with Google"), true);
  assert.equal(helpers.isLoginControlLabel("New chat"), false);
});

test("extension shared helpers recognize Create image controls", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(helpers.isCreateImageControlLabel("Create image"), true);
  assert.equal(helpers.isCreateImageControlLabel("Create an image"), true);
  assert.equal(helpers.isCreateImageControlLabel("Generate image"), true);
  assert.equal(helpers.isCreateImageControlLabel("Deep research"), false);
});

test("extension shared helpers recognize Create image composer placeholders", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(helpers.isCreateImageComposerLabel("Describe or edit an image"), true);
  assert.equal(helpers.isCreateImageComposerLabel("Describe an image"), true);
  assert.equal(helpers.isCreateImageComposerLabel("Message ChatGPT"), false);
});

test("extension shared helpers identify generated image candidates", async () => {
  const helpers = await loadSharedHelpers();

  assert.equal(
    helpers.isGeneratedImageCandidate({
      sourceUrl: "https://images.example/generated.png",
      width: 1024,
      height: 1024,
      renderedWidth: 512,
      renderedHeight: 512,
      alt: "generated image",
    }),
    true,
  );
  assert.equal(
    helpers.isGeneratedImageCandidate({
      sourceUrl: "https://images.example/avatar.png",
      width: 32,
      height: 32,
      renderedWidth: 32,
      renderedHeight: 32,
      alt: "avatar",
    }),
    false,
  );
  assert.equal(
    helpers.isGeneratedImageCandidate({
      sourceUrl: "",
      width: 1024,
      height: 1024,
      renderedWidth: 512,
      renderedHeight: 512,
      alt: "generated image",
    }),
    false,
  );
});

test("extension shared helper extracts latest assistant text from generic ChatGPT articles", async () => {
  const helpers = await loadSharedHelpers();
  const documentNode = fakeDocument({
    "main article": [
      fakeElement("Reply with exactly: relay recovery smoke ok"),
      fakeElement("relay recovery smoke ok"),
    ],
  });

  const text = helpers.extractLatestAssistantText(documentNode, {
    promptToIgnore: "Reply with exactly: relay recovery smoke ok",
  });

  assert.equal(text, "relay recovery smoke ok");
});

test("extension shared helper does not treat the user prompt as an answer", async () => {
  const helpers = await loadSharedHelpers();
  const documentNode = fakeDocument({
    "main article": [fakeElement("Reply with exactly: relay recovery smoke ok")],
  });

  const text = helpers.extractLatestAssistantText(documentNode, {
    promptToIgnore: "Reply with exactly: relay recovery smoke ok",
  });

  assert.equal(text, "");
});

test("extension shared helper ignores assistant thinking status without final content", async () => {
  const helpers = await loadSharedHelpers();
  const documentNode = fakeDocument({
    "[data-testid^='conversation-turn-'] .markdown": [fakeElement("Thought for a second")],
    "main [data-testid^='conversation-turn-']": [
      fakeElement("You said:\nReply with exactly: relay post deep normal ok"),
      fakeElement("ChatGPT said:\nThought for a second"),
    ],
  });

  const text = helpers.extractLatestAssistantText(documentNode, {
    promptToIgnore: "Reply with exactly: relay post deep normal ok",
  });

  assert.equal(text, "");
});

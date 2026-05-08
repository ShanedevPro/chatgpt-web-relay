import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

async function loadReportFrameHelpers() {
  const source = await readFile(new URL("../extension/reportFrameShared.js", import.meta.url), "utf8");
  const context = {};
  vm.createContext(context);
  vm.runInContext(source, context);
  return context.ChatGptRelayReportFrameShared;
}

function fakeElement({ text = "", attributes = {}, href = "", rect = {} } = {}) {
  return {
    href,
    innerText: text,
    textContent: text,
    getAttribute(name) {
      return attributes[name] ?? null;
    },
    getBoundingClientRect() {
      return { width: 100, height: 20, top: 0, ...rect };
    },
    querySelectorAll(selector) {
      return selector === "a[href]" ? (this.links ?? []) : [];
    },
    links: [],
  };
}

function fakeDocument(mapping) {
  return {
    querySelectorAll(selector) {
      return mapping[selector] ?? [];
    },
  };
}

test("report frame helper separates report text from Sources panel text", async () => {
  const helpers = await loadReportFrameHelpers();
  const reportText = helpers.extractReportTextFromFullText(`
    Software Smoke Tests
    Executive summary

    Final report body.

    Sources
    Activity - 5m

    Citations - 3
    example.com
  `);

  assert.equal(reportText, "Software Smoke Tests\n    Executive summary\n\n    Final report body.");
});

test("report frame helper extracts citation and scanned source cards", async () => {
  const helpers = await loadReportFrameHelpers();
  const citationAnchor = fakeElement({
    text: "glossary.istqb.org",
    href: "https://glossary.istqb.org/en_US/term/smoke-test",
    rect: { top: 10 },
  });
  const citationTitle = fakeElement({
    text: "smoke test",
    href: "https://glossary.istqb.org/en_US/term/smoke-test",
    rect: { top: 25 },
  });
  const citationSnippet = fakeElement({
    text: "A test suite used before planned testing begins.Read more",
    href: "https://glossary.istqb.org/en_US/term/smoke-test",
    rect: { top: 25 },
  });
  const citationButton = fakeElement({
    text: "1\nsmoke test\nA test suite used before planned testing begins.Read more",
    attributes: { "aria-label": "Open source 1" },
    rect: { top: 20 },
  });
  citationButton.links = [citationTitle, citationSnippet];

  const scannedAnchor = fakeElement({
    text: "docs.github.com",
    href: "https://docs.github.com/actions",
    rect: { top: 30 },
  });
  const scannedButton = fakeElement({
    text: "A workflow with a path filter can run on selected push events.Read more",
    attributes: { "aria-label": "Open scanned source Workflow syntax for GitHub Actions" },
    rect: { top: 40 },
  });

  const documentNode = fakeDocument({
    "a[href]": [citationAnchor, citationTitle, citationSnippet, scannedAnchor],
    "button[aria-label^='Open source'], button[aria-label^='Open scanned source']": [
      citationButton,
      scannedButton,
    ],
  });

  const sources = JSON.parse(JSON.stringify(helpers.extractSources(documentNode)));

  assert.deepEqual(sources, [
    {
      type: "citation",
      citationNumber: "1",
      title: "smoke test",
      domain: "glossary.istqb.org",
      snippet: "A test suite used before planned testing begins.",
      link: "https://glossary.istqb.org/en_US/term/smoke-test",
    },
    {
      type: "scanned",
      citationNumber: null,
      title: "Workflow syntax for GitHub Actions",
      domain: "docs.github.com",
      snippet: "A workflow with a path filter can run on selected push events.",
      link: "https://docs.github.com/actions",
    },
  ]);
});

test("report frame helper does not treat the pre-start plan as a sourced report", async () => {
  const helpers = await loadReportFrameHelpers();
  const documentNode = fakeDocument({
    "button[aria-label^='Open source'], button[aria-label^='Open scanned source']": [
      fakeElement({ text: "Edit" }),
      fakeElement({ text: "Cancel" }),
      fakeElement({ text: "Start" }),
    ],
  });

  const sources = JSON.parse(JSON.stringify(helpers.extractSources(documentNode)));

  assert.deepEqual(sources, []);
});

test("report frame helper finds the report expand button", async () => {
  const helpers = await loadReportFrameHelpers();
  const documentNode = fakeDocument({
    "button, [role='button']": [
      fakeElement({ attributes: { "aria-label": "Export" } }),
      fakeElement({ attributes: { "aria-label": "Expand" } }),
      fakeElement({ attributes: { "aria-label": "Sources and activity" } }),
    ],
  });

  const label = helpers.findReportExpandButton(documentNode)?.getAttribute("aria-label");

  assert.equal(label, "Expand");
});

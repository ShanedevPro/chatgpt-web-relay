(() => {
  if (window.__chatgptWebRelayReportFrameLoaded) {
    return;
  }
  window.__chatgptWebRelayReportFrameLoaded = true;

  const SOURCE = "chatgpt-web-relay";
  const REPORT_POLL_MS = 1500;
  const MIN_REPORT_LENGTH = 80;
  let lastText = "";
  let lastSourceCount = -1;

  const shared = window.ChatGptRelayReportFrameShared;

  function rootDocument() {
    return document.querySelector("iframe#root")?.contentDocument ?? null;
  }

  async function ensureSourcesPanelOpen(documentNode) {
    const toggle = shared?.findSourcesToggle?.(documentNode);
    if (!toggle || toggle.getAttribute("aria-expanded") === "true") {
      return;
    }
    toggle.click();
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  async function ensureReportExpanded(documentNode) {
    if (shared.extractSources(documentNode).length > 0) {
      return;
    }

    const expandButton = shared.findReportExpandButton(documentNode);
    if (!expandButton) {
      return;
    }

    expandButton.click();
    await new Promise((resolve) => setTimeout(resolve, 800));
  }

  function readReportPayload(documentNode) {
    const fullText = documentNode?.body?.innerText || "";
    const text = shared.extractReportTextFromFullText(fullText);
    const sources = shared.extractSources(documentNode);
    return { text, sources };
  }

  function reportLooksReady(text, sources) {
    return (
      text.length >= MIN_REPORT_LENGTH &&
      /\n/.test(text) &&
      sources.length > 0 &&
      !/(^|\n)(Edit\nCancel\nStart|Start)(\n|$)/i.test(text)
    );
  }

  function publishReport(text, sources) {
    window.parent.postMessage(
      {
        source: SOURCE,
        type: "deepResearchReport",
        text,
        evidence: {
          deepResearchReport: {
            captureMethod: "deep_research_sandbox_root_frame",
            reportTextLength: text.length,
            reportUrl: window.location.href,
          },
          sources: {
            captureMethod: "deep_research_sources_panel",
            count: sources.length,
            items: sources,
          },
        },
      },
      "https://chatgpt.com",
    );
  }

  async function pollReport() {
    while (true) {
      const documentNode = rootDocument();
      if (documentNode && shared) {
        await ensureReportExpanded(documentNode);
        await ensureSourcesPanelOpen(documentNode);
      }

      const { text, sources } = documentNode && shared
        ? readReportPayload(documentNode)
        : { text: "", sources: [] };
      if (reportLooksReady(text, sources) && (text !== lastText || sources.length !== lastSourceCount)) {
        lastText = text;
        lastSourceCount = sources.length;
        publishReport(text, sources);
      }
      await new Promise((resolve) => setTimeout(resolve, REPORT_POLL_MS));
    }
  }

  pollReport();
})();

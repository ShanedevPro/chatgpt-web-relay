(() => {
  if (window.__chatgptWebRelayContentLoaded) {
    return;
  }
  window.__chatgptWebRelayContentLoaded = true;

  const DEFAULT_SERVER_URL = "http://127.0.0.1:8787";
  const TASK_POLL_MS = 1500;
  const STABLE_READS = 5;
  const STABLE_INTERVAL_MS = 1000;
  const NORMAL_TIMEOUT_MS = 180000;
  const DEEP_RESEARCH_TIMEOUT_MS = 35 * 60 * 1000;
  const IMAGE_TIMEOUT_MS = 10 * 60 * 1000;
  const PROGRESS_REPORT_INTERVAL_MS = 15000;
  const DEEP_RESEARCH_ACTIVATION_GRACE_MS = 60 * 1000;
  const CONTENT_VERSION = "2026-04-30-status-filter-relay";

  let workerId = null;
  let currentTask = null;
  let overlay = null;
  let evidence = {};
  let latestDeepResearchFrameReport = null;
  let acceptDeepResearchReportAfterMs = 0;
  let lastProgressReportAtMs = 0;
  let deepResearchStartClickedAtMs = 0;
  const shared = window.ChatGptRelayShared ?? {
    isDeepResearchControlLabel: (label) => /\bdeep research\b|深入研究/i.test(String(label ?? "").trim()),
    isDeepResearchSelectedLabel: (label) =>
      (/\bdeep research\b|深入研究/i.test(String(label ?? "").trim()) &&
        /click to remove|remove/i.test(String(label ?? "").trim())),
    isSelectedModeLabel: (label) => /click to remove|remove/i.test(label),
    isToolsMenuControlLabel: (label) => /^(\+|add files and more)$/i.test(String(label ?? "").trim()),
    isNewConversationControlLabel: (label) =>
      /\b(new|start new)\s+(chat|conversation)\b/i.test(String(label ?? "").trim()),
    isLoginControlLabel: (label) =>
      /\b(log in|sign up for free|continue with google|continue with apple|continue with phone)\b|登录|注册/i.test(
        String(label ?? "").trim(),
      ),
    isCreateImageControlLabel: (label) =>
      /\b(create|generate)\s+(an\s+)?image\b|创建图片|生成图片/i.test(String(label ?? "").trim()),
    isCreateImageComposerLabel: (label) =>
      /\bdescribe\b.*\bimage\b|\bedit\b.*\bimage\b/i.test(String(label ?? "").trim()),
    isGeneratedImageCandidate: (candidate) => {
      const sourceUrl = String(candidate?.sourceUrl ?? "").trim();
      const width = Number(candidate?.width ?? 0);
      const height = Number(candidate?.height ?? 0);
      const renderedWidth = Number(candidate?.renderedWidth ?? 0);
      const renderedHeight = Number(candidate?.renderedHeight ?? 0);
      return Boolean(sourceUrl) && ((width >= 256 && height >= 256) || (renderedWidth >= 180 && renderedHeight >= 180));
    },
    extractLatestAssistantText: () => "",
  };

  function serverUrl() {
    return window.localStorage.getItem("CHATGPT_RELAY_SERVER_URL") || DEFAULT_SERVER_URL;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function visibleText(element) {
    if (!element) {
      return "";
    }
    return (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  }

  function isVisible(element) {
    if (!element) {
      return false;
    }
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function findPromptEditor() {
    const selectors = [
      "#prompt-textarea",
      "[contenteditable='true'][data-placeholder]",
      "[contenteditable='true']",
      "textarea",
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        return element;
      }
    }
    return null;
  }

  function promptEditorLabel() {
    const editor = findPromptEditor();
    if (!editor) {
      return "";
    }
    return [
      editor.getAttribute("placeholder"),
      editor.getAttribute("data-placeholder"),
      editor.getAttribute("aria-label"),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function findSendButton() {
    const selectors = [
      "button[data-testid='send-button']",
      "button[aria-label='Send prompt']",
      "button[aria-label='Send message']",
      "button[type='submit']",
    ];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && isVisible(element)) {
        return element;
      }
    }
    return null;
  }

  function interactiveElements() {
    return Array.from(
      document.querySelectorAll(
        "button, [role='button'], [role='menuitem'], [role='menuitemradio'], [role='option']",
      ),
    );
  }

  function newConversationElements() {
    return Array.from(document.querySelectorAll("a[href], button, [role='button'], [role='link']"));
  }

  function findDeepResearchButton() {
    for (const element of interactiveElements()) {
      const label = buttonLabel(element);
      if (shared.isDeepResearchControlLabel(label) && isVisible(element)) {
        return element;
      }
    }
    return null;
  }

  function findCreateImageButton() {
    for (const element of interactiveElements()) {
      const label = buttonLabel(element);
      if (shared.isCreateImageControlLabel(label) && isVisible(element)) {
        return element;
      }
    }
    return null;
  }

  function findToolsMenuButton() {
    for (const button of interactiveElements()) {
      const label = buttonLabel(button);
      if (shared.isToolsMenuControlLabel(label) && isVisible(button)) {
        return button;
      }
    }
    return null;
  }

  function findNewConversationButton() {
    for (const element of newConversationElements()) {
      const label = buttonLabel(element);
      if (shared.isNewConversationControlLabel(label) && isVisible(element) && !isDisabled(element)) {
        return element;
      }
    }
    return null;
  }

  function hasVisibleLoginControl() {
    return newConversationElements().some((element) => {
      const label = buttonLabel(element);
      return shared.isLoginControlLabel(label) && isVisible(element) && !isDisabled(element);
    });
  }

  function buttonLabel(button) {
    return [
      button?.getAttribute("aria-label"),
      button?.getAttribute("title"),
      visibleText(button),
    ]
      .filter(Boolean)
      .join(" ");
  }

  function isPressed(button) {
    return (
      button?.getAttribute("aria-pressed") === "true" ||
      button?.getAttribute("data-state") === "on" ||
      button?.getAttribute("aria-checked") === "true"
    );
  }

  function isDisabled(element) {
    return Boolean(element?.disabled || element?.getAttribute("aria-disabled") === "true");
  }

  function isMenuLikeOption(element) {
    const role = element?.getAttribute("role");
    return (
      role === "menuitem" ||
      role === "menuitemradio" ||
      role === "option" ||
      Boolean(element?.closest?.("[role='menu'], [role='listbox']"))
    );
  }

  function isToolMenuCandidate(element) {
    return (
      isMenuLikeOption(element) ||
      Boolean(element?.closest?.(
        "[data-radix-popper-content-wrapper], [data-radix-menu-content], [data-radix-menu-item]",
      ))
    );
  }

  function findToolMenuItem(matchesLabel) {
    for (const element of interactiveElements()) {
      const label = buttonLabel(element);
      if (isVisible(element) && isToolMenuCandidate(element) && matchesLabel(label)) {
        return element;
      }
    }
    return null;
  }

  function isDeepResearchModeChip(element) {
    if (isMenuLikeOption(element)) {
      return false;
    }
    const label = buttonLabel(element);
    return (
      shared.isDeepResearchControlLabel(label) &&
      (shared.isDeepResearchSelectedLabel?.(label) || shared.isSelectedModeLabel(label))
    );
  }

  function isDeepResearchSelected(element) {
    return !isMenuLikeOption(element) && isDeepResearchModeChip(element);
  }

  function isCreateImageSelected(element) {
    const label = buttonLabel(element);
    return (
      shared.isCreateImageControlLabel(label) &&
      (isPressed(element) || shared.isSelectedModeLabel(label))
    );
  }

  function findSelectedDeepResearchControl() {
    return interactiveElements().find((element) => isVisible(element) && isDeepResearchSelected(element)) ?? null;
  }

  function findSelectedCreateImageControl() {
    return interactiveElements().find((element) => isVisible(element) && isCreateImageSelected(element)) ?? null;
  }

  function isCreateImageComposerReady() {
    return (
      shared.isCreateImageComposerLabel(promptEditorLabel()) ||
      shared.isCreateImageComposerLabel(visibleText(document.body))
    );
  }

  function pageState() {
    const text = visibleText(document.body).toLowerCase();
    const editorFound = Boolean(findPromptEditor());
    const verificationVisible =
      text.includes("just a moment") ||
      text.includes("verify you are human") ||
      text.includes("checking your browser");
    const loginVisible =
      hasVisibleLoginControl() ||
      (!editorFound && (/\blog in\b/i.test(text) || /\bsign up\b/i.test(text) || text.includes("登录")));
    const deepResearchButton = findDeepResearchButton();
    const createImageButton = findCreateImageButton();

    return {
      url: window.location.href,
      title: document.title,
      editorFound,
      loginVisible,
      verificationVisible,
      deepResearchVisible: Boolean(deepResearchButton),
      deepResearchSelected: Boolean(findSelectedDeepResearchControl()),
      createImageVisible: Boolean(createImageButton),
      createImageSelected: Boolean(findSelectedCreateImageControl() || isCreateImageComposerReady()),
      contentVersion: CONTENT_VERSION,
    };
  }

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement("div");
    overlay.id = "chatgpt-web-relay-status";
    overlay.style.cssText = [
      "position:fixed",
      "right:12px",
      "bottom:12px",
      "z-index:2147483647",
      "max-width:280px",
      "padding:10px 12px",
      "border-radius:12px",
      "background:rgba(16,24,32,0.92)",
      "color:white",
      "font:12px/1.4 ui-sans-serif,system-ui,sans-serif",
      "box-shadow:0 8px 30px rgba(0,0,0,0.28)",
    ].join(";");
    document.documentElement.appendChild(overlay);
    return overlay;
  }

  function setOverlay(status, detail = "") {
    const state = pageState();
    ensureOverlay().textContent = [
      `ChatGPT Relay: ${status}`,
      workerId ? `Worker: ${workerId.slice(0, 18)}` : "Worker: not registered",
      state.editorFound ? "Editor: ready" : "Editor: not ready",
      detail,
    ]
      .filter(Boolean)
      .join("\n");
  }

  async function postJson(path, body) {
    const response = await fetch(`${serverUrl()}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function readJson(path) {
    const response = await fetch(`${serverUrl()}${path}`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `HTTP ${response.status}`);
    }
    return payload;
  }

  async function registerWorker() {
    const payload = await postJson("/extension/register", {
      url: window.location.href,
      title: document.title,
      userAgent: navigator.userAgent,
      pageState: pageState(),
    });
    workerId = payload.workerId;
    setOverlay("ready");
  }

  async function reportTask(status, body = {}) {
    if (!currentTask) {
      return;
    }
    await postJson(`/extension/jobs/${currentTask.id}/event`, {
      workerId,
      status,
      pageState: pageState(),
      evidence,
      ...body,
    });
  }

  async function reportTaskProgress(text = "") {
    if (!currentTask || Date.now() - lastProgressReportAtMs < PROGRESS_REPORT_INTERVAL_MS) {
      return;
    }
    lastProgressReportAtMs = Date.now();
    await reportTask("progress", { text: String(text ?? "").slice(0, 2000) }).catch(() => {});
  }

  function injectPageScript() {
    const script = document.createElement("script");
    script.src = chrome.runtime.getURL("injected.js");
    script.onload = () => script.remove();
    (document.head || document.documentElement).appendChild(script);
  }

  function mergeEvidence(kind, nextEvidence) {
    evidence = {
      ...evidence,
      [kind]: {
        ...(evidence[kind] || {}),
        ...(nextEvidence || {}),
      },
    };
  }

  function mergeDeepResearchReportEvidence(nextEvidence) {
    if (nextEvidence?.deepResearchReport) {
      mergeEvidence("deepResearchReport", nextEvidence.deepResearchReport);
    } else {
      mergeEvidence("deepResearchReport", nextEvidence);
    }

    if (nextEvidence?.sources) {
      mergeEvidence("sources", nextEvidence.sources);
    }
  }

  function isDeepResearchReportMessage(event) {
    return (
      event.data?.source === "chatgpt-web-relay" &&
      event.data?.type === "deepResearchReport" &&
      /^https:\/\/connector_openai_deep_research\.web-sandbox\.oaiusercontent\.com$/i.test(event.origin)
    );
  }

  window.addEventListener("message", (event) => {
    if (isDeepResearchReportMessage(event)) {
      const text = String(event.data.text ?? "").trim();
      if (
        currentTask?.mode === "deep_research" &&
        Date.now() >= acceptDeepResearchReportAfterMs &&
        text.length > 0
      ) {
        latestDeepResearchFrameReport = {
          text,
          receivedAtMs: Date.now(),
        };
        mergeDeepResearchReportEvidence(event.data.evidence);
      }
      return;
    }

    if (event.source !== window || event.data?.source !== "chatgpt-web-relay") {
      return;
    }
    if (event.data.type === "evidence") {
      mergeEvidence(event.data.kind, event.data.evidence);
    }
  });

  function assertPageReadyForTask() {
    const state = pageState();
    assertNoBlockingPageState(state);
    if (!state.editorFound) {
      throw new Error("ChatGPT prompt editor was not found.");
    }
  }

  function assertNoBlockingPageState(state = pageState()) {
    if (state.verificationVisible) {
      throw new Error("ChatGPT human verification is visible.");
    }
    if (state.loginVisible) {
      throw new Error("ChatGPT login is required.");
    }
  }

  async function waitFor(condition, timeoutMs, message) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const value = await condition();
      if (value) {
        return value;
      }
      await sleep(250);
    }
    throw new Error(message);
  }

  async function clickLikeUser(element) {
    const rect = element.getBoundingClientRect();
    const options = {
      bubbles: true,
      cancelable: true,
      composed: true,
      view: window,
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
      button: 0,
      buttons: 1,
    };

    element.focus?.();
    element.dispatchEvent(new PointerEvent("pointerover", { ...options, pointerId: 1, pointerType: "mouse" }));
    element.dispatchEvent(new PointerEvent("pointerenter", { ...options, pointerId: 1, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mouseover", options));
    element.dispatchEvent(new MouseEvent("mouseenter", options));
    element.dispatchEvent(new PointerEvent("pointerdown", { ...options, pointerId: 1, pointerType: "mouse" }));
    element.dispatchEvent(new MouseEvent("mousedown", options));
    element.dispatchEvent(new PointerEvent("pointerup", {
      ...options,
      pointerId: 1,
      pointerType: "mouse",
      buttons: 0,
    }));
    element.dispatchEvent(new MouseEvent("mouseup", { ...options, buttons: 0 }));
    element.dispatchEvent(new MouseEvent("click", { ...options, buttons: 0 }));
    await sleep(250);
  }

  async function selectDeepResearch() {
    if (findSelectedDeepResearchControl()) {
      return;
    }

    const toolsButton = await waitFor(
      () => findToolsMenuButton(),
      8000,
      "Add files and more button was not found.",
    );
    await clickLikeUser(toolsButton);

    const button = await waitFor(
      () => findToolMenuItem(shared.isDeepResearchControlLabel),
      8000,
      "Deep Research item was not found after opening the tools menu.",
    );

    if (isDisabled(button)) {
      throw new Error("Deep Research button is disabled.");
    }

    await clickLikeUser(button);
    await waitFor(
      () => findSelectedDeepResearchControl(),
      8000,
      "Deep Research did not become selected.",
    );
  }

  async function selectCreateImage() {
    if (findSelectedCreateImageControl() || isCreateImageComposerReady()) {
      return;
    }

    const toolsButton = await waitFor(
      () => findToolsMenuButton(),
      8000,
      "Add files and more button was not found.",
    );
    await clickLikeUser(toolsButton);

    const button = await waitFor(
      () => findToolMenuItem(shared.isCreateImageControlLabel),
      8000,
      "Create image item was not found after opening the tools menu.",
    );

    if (isDisabled(button)) {
      throw new Error("Create image button is disabled.");
    }

    await clickLikeUser(button);
    await sleep(1000);
  }

  function isFreshConversationUrl() {
    return window.location.pathname === "/";
  }

  async function ensureConversationTarget(conversation) {
    if (conversation !== "new") {
      return;
    }

    if (isFreshConversationUrl() && findPromptEditor()) {
      return;
    }

    const button = await waitFor(
      () => findNewConversationButton(),
      8000,
      "New chat button was not found.",
    );
    await clickLikeUser(button);
    await waitFor(
      () => isFreshConversationUrl() && findPromptEditor(),
      8000,
      "New chat did not become ready.",
    );
  }

  function setEditorText(editor, prompt) {
    editor.focus();
    if (editor.tagName === "TEXTAREA" || editor.tagName === "INPUT") {
      editor.value = prompt;
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    document.execCommand("selectAll", false, null);
    const inserted = document.execCommand("insertText", false, prompt);
    if (!inserted || visibleText(editor) !== prompt) {
      editor.textContent = prompt;
      editor.dispatchEvent(new InputEvent("input", { bubbles: true, data: prompt }));
    }
  }

  async function submitPrompt(prompt) {
    const editor = findPromptEditor();
    if (!editor) {
      throw new Error("ChatGPT prompt editor was not found.");
    }
    setEditorText(editor, prompt);

    const sendButton = await waitFor(() => {
      const button = findSendButton();
      if (!button || button.disabled || button.getAttribute("aria-disabled") === "true") {
        return null;
      }
      return button;
    }, 8000, "Send button did not become available.");

    await clickLikeUser(sendButton);
  }

  function latestAssistantText() {
    const sharedText = shared.extractLatestAssistantText?.(document, {
      promptToIgnore: currentTask?.prompt ?? "",
    });
    if (sharedText) {
      return sharedText;
    }

    const selectors = [
      "[data-message-author-role='assistant']",
      "[data-testid^='conversation-turn-'] .markdown",
      "article .markdown",
      "[data-testid='research-report']",
      "[data-testid*='research']",
      "[class*='research']",
    ];
    const candidates = selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)));
    const visibleCandidates = candidates
      .filter(isVisible)
      .map(visibleText)
      .filter((text) => text.length > 0);
    return visibleCandidates.at(-1) || "";
  }

  function answerDebugEvidence() {
    const selectors = [
      "[data-message-author-role]",
      "[data-testid^='conversation-turn-']",
      "main article",
      "article .markdown",
      "[data-message-id]",
    ];
    const candidates = [];
    const seen = new Set();
    for (const selector of selectors) {
      for (const element of document.querySelectorAll(selector)) {
        if (seen.has(element)) {
          continue;
        }
        seen.add(element);
        if (!isVisible(element)) {
          continue;
        }
        const text = visibleText(element);
        if (text) {
          candidates.push({
            selector,
            role: element.getAttribute("data-message-author-role") || null,
            testId: element.getAttribute("data-testid") || null,
            textPreview: text.slice(0, 500),
          });
        }
      }
    }

    return {
      latestAssistantText: latestAssistantText().slice(0, 1000),
      bodyPreview: visibleText(document.body).slice(0, 1200),
      candidateCount: candidates.length,
      candidates: candidates.slice(-8),
      generating: isGenerating(),
      url: window.location.href,
      title: document.title,
    };
  }

  function composerDebugEvidence() {
    const editor = findPromptEditor();
    const buttons = Array.from(document.querySelectorAll("button"))
      .filter(isVisible)
      .map((button) => ({
        label: buttonLabel(button).slice(0, 160),
        disabled: isDisabled(button),
        type: button.getAttribute("type") || null,
        testId: button.getAttribute("data-testid") || null,
        ariaDisabled: button.getAttribute("aria-disabled") || null,
      }))
      .slice(-30);

    return {
      editorFound: Boolean(editor),
      editorTag: editor?.tagName || null,
      editorLabel: promptEditorLabel(),
      editorText: editor ? visibleText(editor).slice(0, 500) : "",
      editorHtml: editor?.innerHTML?.slice(0, 500) || "",
      sendButtonFound: Boolean(findSendButton()),
      sendButtonLabel: buttonLabel(findSendButton()).slice(0, 160),
      buttons,
    };
  }

  function deepResearchWaitDebugEvidence() {
    const startButton = findDeepResearchStartButton();
    const controls = interactiveElements()
      .filter(isVisible)
      .map((element) => {
        const label = buttonLabel(element).slice(0, 160);
        return {
          label,
          role: element.getAttribute("role") || null,
          testId: element.getAttribute("data-testid") || null,
          disabled: isDisabled(element),
          startCandidate: isDeepResearchStartControlLabel(label),
        };
      })
      .slice(-40);

    return {
      selected: Boolean(findSelectedDeepResearchControl()),
      startButtonFound: Boolean(startButton),
      startButtonLabel: buttonLabel(startButton).slice(0, 160),
      editorLabel: promptEditorLabel(),
      latestAssistantText: latestAssistantText().slice(0, 500),
      controls,
    };
  }

  function latestDeepResearchReportText() {
    if (latestDeepResearchFrameReport?.text) {
      return latestDeepResearchFrameReport.text;
    }

    const bodyText = visibleText(document.body);
    if (!/research completed/i.test(bodyText)) {
      return "";
    }

    const candidates = Array.from(document.querySelectorAll("article, section, main, [role='document'], div"))
      .filter(isVisible)
      .map(visibleText)
      .filter((text) =>
        /research completed/i.test(text) &&
        /citation|citations/i.test(text) &&
        /search|searches/i.test(text),
      )
      .sort((left, right) => left.length - right.length);

    return candidates[0] || bodyText;
  }

  function isGenerating() {
    return Boolean(
      document.querySelector("button[aria-label='Stop streaming'], button[data-testid='stop-button']"),
    );
  }

  function generatedImageCandidates(previousSourceUrls = new Set()) {
    const seen = new Set();
    return Array.from(document.querySelectorAll("img"))
      .filter(isVisible)
      .map((image) => {
        const rect = image.getBoundingClientRect();
        return {
          element: image,
          sourceUrl: image.currentSrc || image.src || "",
          width: image.naturalWidth || 0,
          height: image.naturalHeight || 0,
          renderedWidth: rect.width,
          renderedHeight: rect.height,
          alt: image.alt || "generated image",
        };
      })
      .filter((candidate) => {
        if (seen.has(candidate.sourceUrl) || previousSourceUrls.has(candidate.sourceUrl)) {
          return false;
        }
        seen.add(candidate.sourceUrl);
        return shared.isGeneratedImageCandidate(candidate);
      });
  }

  function currentGeneratedImageSourceUrls() {
    return new Set(generatedImageCandidates(new Set()).map((candidate) => candidate.sourceUrl));
  }

  async function waitForGeneratedImages(previousSourceUrls, timeoutMs) {
    const startedAt = Date.now();
    let stableSignature = "";
    let stableCount = 0;

    while (Date.now() - startedAt < timeoutMs) {
      const candidates = generatedImageCandidates(previousSourceUrls);
      const signature = candidates.map((candidate) => candidate.sourceUrl).join("\n");
      if (candidates.length > 0 && !isGenerating()) {
        if (signature === stableSignature) {
          stableCount += 1;
        } else {
          stableSignature = signature;
          stableCount = 1;
        }
        if (stableCount >= 2) {
          return candidates;
        }
      } else {
        stableCount = 0;
      }
      await reportTaskProgress(`Waiting for generated images. Candidate count: ${candidates.length}.`);
      await sleep(STABLE_INTERVAL_MS);
    }

    throw new Error("Timed out waiting for generated images.");
  }

  function inferImageContentType(sourceUrl, blobType) {
    if (/^image\//i.test(blobType || "")) {
      return blobType.toLowerCase();
    }
    if (/\.jpe?g(?:[?#]|$)/i.test(sourceUrl)) {
      return "image/jpeg";
    }
    if (/\.webp(?:[?#]|$)/i.test(sourceUrl)) {
      return "image/webp";
    }
    if (/\.gif(?:[?#]|$)/i.test(sourceUrl)) {
      return "image/gif";
    }
    return "image/png";
  }

  async function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = String(reader.result ?? "");
        resolve(result.includes(",") ? result.split(",").at(-1) : result);
      };
      reader.onerror = () => reject(reader.error ?? new Error("Failed to read generated image bytes."));
      reader.readAsDataURL(blob);
    });
  }

  async function uploadGeneratedImage(taskId, candidate) {
    let response;
    try {
      response = await fetch(candidate.sourceUrl);
    } catch (error) {
      throw new Error(`Could not fetch generated image bytes: ${error.message}`);
    }
    if (!response.ok) {
      throw new Error(`Could not fetch generated image bytes: HTTP ${response.status}`);
    }

    const blob = await response.blob();
    const dataBase64 = await blobToBase64(blob);
    const payload = await postJson(`/extension/jobs/${taskId}/assets`, {
      workerId,
      contentType: inferImageContentType(candidate.sourceUrl, blob.type),
      dataBase64,
      sourceUrl: candidate.sourceUrl,
      width: candidate.width || null,
      height: candidate.height || null,
      alt: candidate.alt || "generated image",
    });
    return payload.image;
  }

  function hasDeepResearchHintValue(value) {
    return /(^|[:_\s-])research($|[:_\s-])|deep_research|connector_openai_deep_research/i.test(String(value ?? ""));
  }

  function hasDeepResearchActivationEvidence() {
    const requestHints = [
      ...(evidence.request?.systemHints ?? []),
      ...(evidence.request?.messageSystemHints ?? []),
    ];
    return Boolean(
      evidence.request?.researchHintSeen ||
        requestHints.some(hasDeepResearchHintValue) ||
        evidence.response?.researchHintSeen ||
        evidence.response?.researchModelSeen ||
        evidence.deepResearchReport?.captureMethod,
    );
  }

  function isDeepResearchStartControlLabel(label) {
    const value = String(label ?? "").replace(/\s+/g, " ").trim();
    if (!value || /dictation|voice/i.test(value)) {
      return false;
    }
    return (
      /^start$/i.test(value) ||
      /\b(start|begin)\b.*\b(research|report)\b/i.test(value) ||
      /\b(research|report)\b.*\b(start|begin)\b/i.test(value) ||
      /开始.*(研究|报告)/i.test(value)
    );
  }

  function findDeepResearchStartButton() {
    if (!findSelectedDeepResearchControl()) {
      return null;
    }
    for (const element of interactiveElements()) {
      const label = buttonLabel(element);
      if (isVisible(element) && !isDisabled(element) && isDeepResearchStartControlLabel(label)) {
        return element;
      }
    }
    return null;
  }

  async function clickDeepResearchStartIfVisible() {
    if (deepResearchStartClickedAtMs) {
      return false;
    }
    const button = findDeepResearchStartButton();
    if (!button) {
      return false;
    }

    const label = buttonLabel(button).slice(0, 160);
    await clickLikeUser(button);
    deepResearchStartClickedAtMs = Date.now();
    mergeEvidence("flow", {
      deepResearchStartClickedAt: new Date(deepResearchStartClickedAtMs).toISOString(),
      deepResearchStartLabel: label,
    });
    await reportTask("progress", { text: `Clicked Deep Research start: ${label}` }).catch(() => {});
    return true;
  }

  async function waitForAssistantAnswer(previousText, timeoutMs, options = {}) {
    const startedAt = Date.now();
    let stableText = "";
    let stableCount = 0;
    let backendDoneWithoutResearchAtMs = 0;
    const requireResearchReport = Boolean(options.requireResearchReport);

    while (Date.now() - startedAt < timeoutMs) {
      if (requireResearchReport) {
        await clickDeepResearchStartIfVisible();
        mergeEvidence("deepResearchWaitDebug", deepResearchWaitDebugEvidence());
      }

      const researchReport = latestDeepResearchReportText();
      const text = requireResearchReport ? researchReport : researchReport || latestAssistantText();
      const researchActivated = hasDeepResearchActivationEvidence();
      if (requireResearchReport && evidence.response?.doneSeen && !researchActivated && !researchReport) {
        backendDoneWithoutResearchAtMs ||= Date.now();
        if (Date.now() - backendDoneWithoutResearchAtMs >= DEEP_RESEARCH_ACTIVATION_GRACE_MS) {
          throw new Error(
            "Deep Research did not activate: ChatGPT returned a normal conversation stream without research request markers or a report frame.",
          );
        }
      } else {
        backendDoneWithoutResearchAtMs = 0;
      }

      if (text && text !== previousText && !isGenerating()) {
        if (text === stableText) {
          stableCount += 1;
        } else {
          stableText = text;
          stableCount = 1;
        }
        if (stableCount >= STABLE_READS) {
          return text;
        }
      } else {
        stableCount = 0;
      }
      await reportTaskProgress(text || latestAssistantText());
      await sleep(STABLE_INTERVAL_MS);
    }

    throw new Error("Timed out waiting for the ChatGPT answer to stabilize.");
  }

  async function processTask(task) {
    currentTask = task;
    evidence = {};
    latestDeepResearchFrameReport = null;
    acceptDeepResearchReportAfterMs = Number.POSITIVE_INFINITY;
    lastProgressReportAtMs = 0;
    deepResearchStartClickedAtMs = 0;
    setOverlay("running", `${task.mode}/${task.conversation ?? "new"}: ${task.id}`);
    await reportTask("running");

    try {
      assertNoBlockingPageState();
      await ensureConversationTarget(task.conversation ?? "new");
      assertPageReadyForTask();
      const previousText = latestAssistantText();
      const previousImageSourceUrls =
        task.mode === "create_image" ? currentGeneratedImageSourceUrls() : new Set();
      if (task.mode === "deep_research") {
        await selectDeepResearch();
      } else if (task.mode === "create_image") {
        await selectCreateImage();
      }
      await submitPrompt(task.prompt);
      mergeEvidence("flow", {
        promptSubmittedAt: new Date().toISOString(),
        afterSubmitUrl: window.location.href,
      });
      await reportTask("progress", { text: latestAssistantText() });
      if (task.mode === "deep_research") {
        acceptDeepResearchReportAfterMs = Date.now() + 1000;
      }
      if (task.mode === "create_image") {
        const candidates = await waitForGeneratedImages(previousImageSourceUrls, IMAGE_TIMEOUT_MS);
        const images = [];
        for (const candidate of candidates) {
          images.push(await uploadGeneratedImage(task.id, candidate));
        }
        if (images.length === 0) {
          throw new Error("No generated image bytes were captured.");
        }
        mergeEvidence("images", { count: images.length, items: images });
        await reportTask("completed", { text: "" });
        setOverlay("completed", `${task.id}: ${images.length} image(s)`);
        return;
      }

      const timeoutMs = task.mode === "deep_research" ? DEEP_RESEARCH_TIMEOUT_MS : NORMAL_TIMEOUT_MS;
      const answer = await waitForAssistantAnswer(previousText, timeoutMs, {
        requireResearchReport: task.mode === "deep_research",
      });
      await reportTask("completed", { text: answer });
      setOverlay("completed", task.id);
    } catch (error) {
      const state = pageState();
      mergeEvidence("answerDebug", answerDebugEvidence());
      mergeEvidence("composerDebug", composerDebugEvidence());
      const activationFailure = /Deep Research did not activate/i.test(error.message);
      const needsUser =
        !activationFailure &&
        (state.loginVisible ||
          state.verificationVisible ||
          /login|verification|human|deep research|new chat|new conversation/i.test(error.message));
      await reportTask(needsUser ? "needs_user_input" : "failed", { error: error.message });
      setOverlay(needsUser ? "needs user input" : "failed", error.message);
    } finally {
      currentTask = null;
    }
  }

  async function pollForTask() {
    if (!workerId || currentTask) {
      return;
    }
    const { task } = await readJson(`/extension/task?workerId=${encodeURIComponent(workerId)}`);
    if (task) {
      await processTask(task);
    } else {
      setOverlay("ready");
    }
  }

  async function mainLoop() {
    injectPageScript();
    while (true) {
      try {
        if (!workerId) {
          await registerWorker();
        }
        await pollForTask();
      } catch (error) {
        setOverlay("disconnected", error.message);
        workerId = null;
      }
      await sleep(TASK_POLL_MS);
    }
  }

  mainLoop();
})();

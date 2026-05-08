((root) => {
  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim();
  }

  function elementVisible(element) {
    if (!element?.getBoundingClientRect || !root.getComputedStyle) {
      return true;
    }
    const rect = element.getBoundingClientRect();
    const style = root.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
  }

  function visibleText(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function cleanConversationChromeText(text) {
    return normalizeText(text).replace(/^(?:chatgpt said:|you said:)\s*/i, "").trim();
  }

  function isDeepResearchControlLabel(label) {
    const value = normalizeText(label);
    return /\bdeep research\b|深入研究/i.test(value);
  }

  function isDeepResearchSelectedLabel(label) {
    return isDeepResearchControlLabel(label) && /click to remove|remove/i.test(String(label ?? ""));
  }

  function isSelectedModeLabel(label) {
    return /click to remove|remove/i.test(String(label ?? ""));
  }

  function isToolsMenuControlLabel(label) {
    const value = String(label ?? "").trim();
    return /^(\+|add files and more)$/i.test(value);
  }

  function isNewConversationControlLabel(label) {
    const value = String(label ?? "").trim();
    return /\b(new|start new)\s+(chat|conversation)\b/i.test(value);
  }

  function isLoginControlLabel(label) {
    const value = String(label ?? "").trim();
    return /\b(log in|sign up for free|continue with google|continue with apple|continue with phone)\b|登录|注册/i.test(value);
  }

  function isCreateImageControlLabel(label) {
    const value = String(label ?? "").trim();
    return /\b(create|generate)\s+(an\s+)?image\b|创建图片|生成图片/i.test(value);
  }

  function isCreateImageComposerLabel(label) {
    const value = String(label ?? "").trim();
    return /\bdescribe\b.*\bimage\b|\bedit\b.*\bimage\b/i.test(value);
  }

  function isGeneratedImageCandidate(candidate = {}) {
    const sourceUrl = String(candidate.sourceUrl ?? "").trim();
    const width = Number(candidate.width ?? 0);
    const height = Number(candidate.height ?? 0);
    const renderedWidth = Number(candidate.renderedWidth ?? 0);
    const renderedHeight = Number(candidate.renderedHeight ?? 0);
    const alt = String(candidate.alt ?? "");

    if (!sourceUrl || /^data:/i.test(sourceUrl)) {
      return false;
    }

    if (/avatar|icon|logo|user|profile/i.test(alt) && Math.max(width, height, renderedWidth, renderedHeight) < 256) {
      return false;
    }

    return (
      (width >= 256 && height >= 256) ||
      (renderedWidth >= 180 && renderedHeight >= 180)
    );
  }

  function uniqueElements(elements) {
    const seen = new Set();
    return elements.filter((element) => {
      if (!element || seen.has(element)) {
        return false;
      }
      seen.add(element);
      return true;
    });
  }

  function isPromptEcho(text, promptToIgnore) {
    const normalizedText = normalizeText(text);
    const normalizedPrompt = normalizeText(promptToIgnore);
    return Boolean(normalizedPrompt) && (
      normalizedText === normalizedPrompt ||
      normalizedText.startsWith(normalizedPrompt)
    );
  }

  function isUiOrComposerText(text) {
    return /^(message chatgpt|what are you working on\?|new chat|search chats)$/i.test(normalizeText(text));
  }

  function isAssistantStatusText(text) {
    return /^thought for\b/i.test(cleanConversationChromeText(text));
  }

  function extractTextFromCandidates(documentNode, selectors, options = {}) {
    const promptToIgnore = options.promptToIgnore ?? "";
    const candidates = uniqueElements(
      selectors.flatMap((selector) => Array.from(documentNode.querySelectorAll(selector))),
    )
      .filter(elementVisible)
      .map(visibleText)
      .map(cleanConversationChromeText)
      .filter((text) => (
        text.length > 0 &&
        !isUiOrComposerText(text) &&
        !isAssistantStatusText(text) &&
        !isPromptEcho(text, promptToIgnore)
      ));

    return candidates.at(-1) || "";
  }

  function extractLatestAssistantText(documentNode, options = {}) {
    const explicit = extractTextFromCandidates(documentNode, [
      "[data-message-author-role='assistant']",
      "article[data-message-author-role='assistant']",
      "[data-testid^='conversation-turn-'] [data-message-author-role='assistant']",
      "[data-testid^='conversation-turn-'] .markdown",
      "article .markdown",
    ], options);
    if (explicit) {
      return explicit;
    }

    return extractTextFromCandidates(documentNode, [
      "main article",
      "main [data-testid^='conversation-turn-']",
      "main [data-message-id]",
      "main [data-testid*='message']",
    ], options);
  }

  root.ChatGptRelayShared = {
    extractLatestAssistantText,
    isDeepResearchControlLabel,
    isDeepResearchSelectedLabel,
    isSelectedModeLabel,
    isToolsMenuControlLabel,
    isNewConversationControlLabel,
    isLoginControlLabel,
    isCreateImageControlLabel,
    isCreateImageComposerLabel,
    isGeneratedImageCandidate,
  };
})(globalThis);

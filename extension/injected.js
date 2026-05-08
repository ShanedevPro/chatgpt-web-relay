(() => {
  if (window.__chatgptWebRelayInjected) {
    return;
  }
  window.__chatgptWebRelayInjected = true;

  const originalFetch = window.fetch.bind(window);

  function postEvidence(kind, evidence) {
    window.postMessage(
      {
        source: "chatgpt-web-relay",
        type: "evidence",
        kind,
        evidence,
      },
      window.location.origin,
    );
  }

  function isConversationUrl(url) {
    try {
      const parsed = new URL(url, window.location.href);
      return /^\/backend-api\/(?:f\/)?conversation/.test(parsed.pathname);
    } catch {
      return false;
    }
  }

  function maybeParseJson(raw) {
    if (!raw || typeof raw !== "string") {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function extractRequestEvidence(payload) {
    if (!payload || typeof payload !== "object") {
      return null;
    }

    const messageSystemHints = [];
    for (const message of payload.messages ?? []) {
      const hints = message?.metadata?.system_hints;
      if (Array.isArray(hints)) {
        messageSystemHints.push(...hints.map(String));
      }
    }

    return {
      action: payload.action ?? null,
      model: payload.model ?? null,
      conversationId: payload.conversation_id ?? null,
      systemHints: Array.isArray(payload.system_hints) ? payload.system_hints.map(String) : [],
      messageSystemHints,
      researchHintSeen:
        (Array.isArray(payload.system_hints) && payload.system_hints.includes("research")) ||
        messageSystemHints.includes("research"),
    };
  }

  function extractResponseEvidence(text) {
    if (!text || typeof text !== "string") {
      return null;
    }

    const evidence = {};
    if (/"(?:model_slug|resolved_model_slug)"\s*:\s*"research"/.test(text)) {
      evidence.researchModelSeen = true;
    }
    if (/"system_hints"\s*:\s*\[[^\]]*"research"/.test(text)) {
      evidence.researchHintSeen = true;
    }
    if (/"citations"\s*:/.test(text) || /"content_references"\s*:/.test(text)) {
      evidence.citationMarkersSeen = true;
    }
    const conversationMatch = text.match(/"conversation_id"\s*:\s*"([^"]+)"/);
    if (conversationMatch) {
      evidence.conversationId = conversationMatch[1];
    }
    if (text.includes("[DONE]") || /"status"\s*:\s*"finished_successfully"/.test(text)) {
      evidence.doneSeen = true;
    }

    return Object.keys(evidence).length ? evidence : null;
  }

  function mergeEvidence(left, right) {
    return {
      ...(left ?? {}),
      ...(right ?? {}),
    };
  }

  async function inspectStreamingResponse(response, url) {
    let clone;
    try {
      clone = response.clone();
    } catch {
      return;
    }

    if (!clone.body) {
      return;
    }

    const reader = clone.body.getReader();
    const decoder = new TextDecoder();
    let aggregateEvidence = {};
    let responseTextPreview = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          postEvidence("response", {
            ...aggregateEvidence,
            doneSeen: true,
            url,
            textPreview: responseTextPreview.slice(0, 2000),
          });
          return;
        }

        const text = decoder.decode(value, { stream: true });
        responseTextPreview = (responseTextPreview + text).slice(0, 2000);
        const evidence = extractResponseEvidence(text);
        if (evidence) {
          aggregateEvidence = mergeEvidence(aggregateEvidence, evidence);
          postEvidence("response", {
            ...aggregateEvidence,
            textPreview: responseTextPreview.slice(0, 2000),
          });
        }
      }
    } catch {
      // Evidence capture must never interfere with ChatGPT's own stream handling.
    }
  }

  window.fetch = async (...args) => {
    const request = args[0];
    const init = args[1] ?? {};
    const url = request instanceof Request ? request.url : String(request);
    const method = String(init.method ?? (request instanceof Request ? request.method : "GET")).toUpperCase();
    const shouldInspect = method === "POST" && isConversationUrl(url);

    if (shouldInspect) {
      let rawBody = typeof init.body === "string" ? init.body : null;
      if (!rawBody && request instanceof Request) {
        rawBody = await request.clone().text().catch(() => null);
      }
      const requestEvidence = extractRequestEvidence(maybeParseJson(rawBody));
      if (requestEvidence) {
        postEvidence("request", requestEvidence);
      }
    }

    const response = await originalFetch(...args);
    if (shouldInspect) {
      inspectStreamingResponse(response, url);
    }
    return response;
  };
})();

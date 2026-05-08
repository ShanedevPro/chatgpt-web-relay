((root) => {
  function normalizeText(value) {
    return String(value ?? "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function visibleText(element) {
    return normalizeText(element?.innerText || element?.textContent || "");
  }

  function extractReportTextFromFullText(fullText) {
    const normalized = normalizeText(fullText);
    const sourcePanelMatch = normalized.match(/(?:^|\n)\s*Sources\s*\n\s*Activity\b/i);
    if (!sourcePanelMatch) {
      return normalized;
    }
    return normalized.slice(0, sourcePanelMatch.index).trim();
  }

  function domainFromUrl(url) {
    try {
      return new URL(url).hostname.replace(/^www\./i, "");
    } catch {
      return "";
    }
  }

  function cleanSnippet(value) {
    return normalizeText(value).replace(/\s*Read more\s*$/i, "").trim();
  }

  function nearestPreviousAnchor(documentNode, element) {
    const elementRect = element.getBoundingClientRect();
    return Array.from(documentNode.querySelectorAll("a[href]"))
      .filter((anchor) => {
        const rect = anchor.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.top <= elementRect.top;
      })
      .at(-1) ?? null;
  }

  function sourceFromButton(documentNode, button) {
    const aria = button.getAttribute("aria-label") || "";
    const citationMatch = aria.match(/^Open source\s+(\d+)/i);
    const scannedMatch = aria.match(/^Open scanned source\s+(.+)/i);
    if (!citationMatch && !scannedMatch) {
      return null;
    }

    const links = Array.from(button.querySelectorAll("a[href]")).map((anchor) => ({
      text: visibleText(anchor),
      href: anchor.href,
    }));
    const nearestAnchor = nearestPreviousAnchor(documentNode, button);
    const primaryLink = links[0]?.href || nearestAnchor?.href || "";
    const lines = visibleText(button)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const citationNumber = citationMatch?.[1] ?? null;
    const title =
      links[0]?.text ||
      scannedMatch?.[1] ||
      (citationNumber && lines[0] === citationNumber ? lines[1] : lines[0]) ||
      "";
    const snippet =
      links[1]?.text ||
      (citationNumber && lines[0] === citationNumber ? lines.slice(2).join(" ") : lines.join(" ")) ||
      "";

    return {
      type: citationMatch ? "citation" : "scanned",
      citationNumber,
      title: normalizeText(title),
      domain: domainFromUrl(primaryLink) || visibleText(nearestAnchor),
      snippet: cleanSnippet(snippet),
      link: primaryLink || null,
    };
  }

  function sourceKey(source) {
    return [
      source.type,
      source.citationNumber ?? "",
      source.link ?? "",
      source.title,
      source.snippet,
    ].join("\u001f");
  }

  function extractSources(documentNode, options = {}) {
    const limit = options.limit ?? 200;
    const buttons = Array.from(
      documentNode.querySelectorAll(
        "button[aria-label^='Open source'], button[aria-label^='Open scanned source']",
      ),
    );
    const seen = new Set();
    const sources = [];

    for (const button of buttons) {
      const source = sourceFromButton(documentNode, button);
      if (!source || !source.title) {
        continue;
      }

      const key = sourceKey(source);
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      sources.push(source);
      if (sources.length >= limit) {
        break;
      }
    }

    return sources;
  }

  function findSourcesToggle(documentNode) {
    return Array.from(documentNode.querySelectorAll("button, [role='button']")).find((element) =>
      /sources and activity/i.test(
        [
          element.getAttribute("aria-label"),
          element.getAttribute("title"),
          visibleText(element),
        ]
          .filter(Boolean)
        .join(" "),
      ),
    ) ?? null;
  }

  function findReportExpandButton(documentNode) {
    return Array.from(documentNode.querySelectorAll("button, [role='button']")).find((element) => {
      const label = [
        element.getAttribute("aria-label"),
        element.getAttribute("title"),
        visibleText(element),
      ]
        .filter(Boolean)
        .join(" ");
      return /^expand$/i.test(label.trim());
    }) ?? null;
  }

  root.ChatGptRelayReportFrameShared = {
    cleanSnippet,
    domainFromUrl,
    extractReportTextFromFullText,
    extractSources,
    findReportExpandButton,
    findSourcesToggle,
    normalizeText,
  };
})(globalThis);

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

function parseFrontmatterSubset(markdown, fileLabel) {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n/);
  assert.ok(match, `${fileLabel} must start with YAML frontmatter`);

  const parsed = {};

  for (const line of match[1].split("\n")) {
    if (!line.trim()) continue;

    const fieldMatch = line.match(/^([A-Za-z][A-Za-z0-9_-]*):(?: (.*))?$/);
    assert.ok(fieldMatch, `${fileLabel} has unsupported frontmatter line: ${line}`);

    const [, key, rawValue = ""] = fieldMatch;
    const quoted = rawValue.startsWith("\"") && rawValue.endsWith("\"");
    assert.ok(
      quoted || !rawValue.includes(": "),
      `${fileLabel} frontmatter value for ${key} must be quoted when it contains ': '`,
    );

    parsed[key] = quoted ? JSON.parse(rawValue) : rawValue;
  }

  return parsed;
}

async function findNamedFiles(directoryUrl, fileName) {
  const found = [];

  for (const entry of await readdir(directoryUrl, { withFileTypes: true })) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);

    if (entry.isDirectory()) {
      found.push(...await findNamedFiles(entryUrl, fileName));
    } else if (entry.name === fileName) {
      found.push(entryUrl);
    }
  }

  return found;
}

test("package and extension manifest versions stay in sync", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const manifestJson = JSON.parse(await readFile(new URL("../extension/manifest.json", import.meta.url), "utf8"));

  assert.equal(packageJson.version, "0.1.0");
  assert.equal(manifestJson.version, packageJson.version);
  assert.equal(packageJson.private, false);
  assert.equal(packageJson.license, "MIT");
});

test("skill frontmatter stays parseable by GitHub and agent tooling", async () => {
  const skillFiles = await findNamedFiles(new URL("../skills/", import.meta.url), "SKILL.md");
  assert.ok(skillFiles.length > 0, "at least one SKILL.md must exist");

  for (const skillFile of skillFiles) {
    const fileLabel = fileURLToPath(skillFile);
    const skill = await readFile(skillFile, "utf8");
    const frontmatter = parseFrontmatterSubset(skill, fileLabel);

    assert.match(frontmatter.name, /^[A-Za-z0-9-]+$/, `${fileLabel} must have a valid skill name`);
    assert.match(frontmatter.description, /^Use when /, `${fileLabel} description must describe when to use it`);
  }
});

test("README points agents to the universal relay skill", async () => {
  const readme = await readFile(new URL("../README.md", import.meta.url), "utf8");
  const chineseReadme = await readFile(new URL("../README.zh-CN.md", import.meta.url), "utf8");

  assert.match(readme, /\[中文\]\(README\.zh-CN\.md\)/);
  assert.match(readme, /skills\/chatgpt-web-relay\/SKILL\.md/);
  assert.doesNotMatch(readme, /CLAUDE\.md/);
  assert.doesNotMatch(readme, /<your-fork-url>/);
  assert.doesNotMatch(readme, /<owner>/);
  assert.match(readme, /git clone https:\/\/github\.com\/ShanedevPro\/chatgpt-web-relay\.git/);
  assert.match(readme, /Install As An Agent Skill/);
  assert.match(readme, /Browser Path Discovery/);
  assert.match(readme, /CHATGPT_RELAY_WINDOWS_EDGE/);
  assert.match(readme, /generate an image/);
  assert.match(readme, /Deep Research report/);
  assert.match(readme, /npm ci/);
  assert.match(readme, /Why This Exists/);
  assert.match(readme, /中文文档/);
  assert.match(chineseReadme, /# ChatGPT Web Relay/);
  assert.match(chineseReadme, /为什么需要这个项目/);
  assert.match(chineseReadme, /npm run relay:start -- --port 8787/);
  assert.match(chineseReadme, /skills\/chatgpt-web-relay\/SKILL\.md/);
  assert.match(chineseReadme, /作为 Agent Skill 安装/);
  assert.match(chineseReadme, /浏览器路径自动发现/);
  assert.match(chineseReadme, /CHATGPT_RELAY_WINDOWS_EDGE/);
  assert.match(chineseReadme, /生成图片/);
  assert.match(chineseReadme, /Deep Research 报告/);
});

test("universal relay skill covers capability use, bootstrap, readiness, modes, and safety", async () => {
  const skill = await readFile(
    new URL("../skills/chatgpt-web-relay/SKILL.md", import.meta.url),
    "utf8",
  );

  assert.match(skill, /^---\nname: chatgpt-web-relay\n/m);
  assert.match(skill, /generate images/);
  assert.match(skill, /Deep Research reports/);
  assert.match(skill, /send prompts through a real logged-in ChatGPT web page/);
  assert.match(skill, /cheap readiness check/);
  assert.match(skill, /Reuse an existing repo/);
  assert.match(skill, /Only clone, install, start, or ask for login when needed/);
  assert.match(skill, /Do not reinstall dependencies, restart the relay, or ask the user to log in/);
  assert.match(skill, /git clone https:\/\/github\.com\/ShanedevPro\/chatgpt-web-relay\.git/);
  assert.match(skill, /CHATGPT_WEB_RELAY_HOME/);
  assert.match(skill, /npm ci/);
  assert.match(skill, /npm install/);
  assert.match(skill, /npm run relay:start -- --port 8787/);
  assert.match(skill, /npm run relay:doctor -- --port 8787/);
  assert.match(skill, /worker_ready/);
  assert.match(skill, /browser discovery/);
  assert.match(skill, /browser_not_found/);
  assert.match(skill, /CHATGPT_RELAY_WINDOWS_EDGE/);
  assert.match(skill, /CHATGPT_RELAY_WINDOWS_CHROME/);
  assert.match(skill, /chatgpt_logged_out/);
  assert.match(skill, /chatgpt_verification_required/);
  assert.match(skill, /normal/);
  assert.match(skill, /deep_research/);
  assert.match(skill, /create_image/);
  assert.match(skill, /Map User Intent To Job Mode/);
  assert.match(skill, /Image generation/);
  assert.match(skill, /sourced report/);
  assert.match(skill, /\/jobs\/<job-id>\/result\.json/);
  assert.match(skill, /Never ask for, inject, print, store, or inspect ChatGPT cookies/);
});

test("troubleshooting documents Deep Research plus-menu requirement", async () => {
  const troubleshooting = await readFile(
    new URL("../docs/troubleshooting.md", import.meta.url),
    "utf8",
  );

  assert.match(troubleshooting, /Deep Research must appear in the `\+` menu/);
  assert.match(troubleshooting, /`Web search` is a separate ChatGPT tool/);
});

test("contributing guide protects local runtime and account data", async () => {
  const contributing = await readFile(new URL("../CONTRIBUTING.md", import.meta.url), "utf8");

  assert.match(contributing, /npm test/);
  assert.match(contributing, /\.local/);
  assert.match(contributing, /browser profiles/);
  assert.match(contributing, /token, cookie, session injection/);
});

# ChatGPT Web Relay

[English](README.md) | [中文](README.zh-CN.md)

ChatGPT Web Relay 是一个本地优先的 relay 工具。它通过浏览器扩展和独立的 Chrome 或 Edge profile，把外部应用的任务发送到真实的 ChatGPT 网页，再把结果保存回来。

```text
你的应用 -> 本地 relay server -> 浏览器扩展 -> 真实 ChatGPT 网页 -> 本地 relay server -> 你的应用
```

这个项目不会注入 cookie、session token 或 auth token。用户只需要在打开的真实浏览器 profile 里正常登录 ChatGPT，之后这个 profile 会保存登录状态，直到 ChatGPT 自己要求重新登录。

## 快速开始

环境要求：

- Node.js 22 或更新版本。
- 已安装 Windows Edge 或 Google Chrome。
- 一个可以使用目标功能的 ChatGPT 账号。
- 支持 WSL，目前主要按 Windows/WSL 场景测试。

安装：

```bash
git clone https://github.com/ShanedevPro/chatgpt-web-relay.git
cd chatgpt-web-relay
npm ci
```

如果你的 fork 没有可用 lockfile，可以使用 `npm install`。

启动 relay：

```bash
npm run relay:start -- --port 8787
```

这个命令会启动本地 server、自动寻找 Edge 或 Chrome、复制并加载 unpacked extension、打开专用浏览器 profile，并进入 `https://chatgpt.com/`。

如果 ChatGPT 显示未登录，请在打开的浏览器窗口里登录。登录后保持 ChatGPT 标签页打开。

检查状态：

```bash
npm run relay:doctor -- --port 8787
```

健康状态应该是：

```text
worker_ready
```

运行一个 smoke test：

```bash
npm run relay:prompt -- "Reply with exactly: relay smoke ok"
```

## 常用任务

普通聊天：

```bash
npm run relay:prompt -- "Reply with exactly: relay smoke ok"
```

Deep Research：

```bash
npm run relay:prompt -- --deep "Use Deep Research to briefly explain what a software smoke test is."
```

Deep Research 要求真实 ChatGPT 的 `+` 菜单里能看到 `Deep research`。`Web search` 是另一个工具，不会被当成 Deep Research。

生成图片：

```bash
npm run relay:prompt -- --image "Create a simple blue robot icon on a white background."
```

继续当前打开的 ChatGPT 会话，而不是新建会话：

```bash
npm run relay:prompt -- --conversation current "Continue the previous answer."
```

## 作为 Agent Skill 安装

如果你希望 AI agent 直接具备这个能力，比如生成图片、做 Deep Research 报告、调用真实 ChatGPT 网页，可以安装这个 skill：

- [ChatGPT Web Relay Skill](skills/chatgpt-web-relay/SKILL.md)

你可以对 agent 说：

```text
Install the skill from https://github.com/ShanedevPro/chatgpt-web-relay/tree/main/skills/chatgpt-web-relay
```

重启 agent 后，就可以这样用：

```text
Use chatgpt-web-relay to generate an image of a blue robot icon.
Use chatgpt-web-relay to run a Deep Research report about smoke testing.
Use chatgpt-web-relay to ask ChatGPT to summarize this text.
```

这个 skill 会在需要时 clone 本 repo、安装依赖、启动本地 relay、在需要登录时提示你到真实浏览器登录，然后提交任务并返回保存的结果。

## 给其他应用使用

如果你在做另一个产品、UI 或 agent，调用流程是：

1. 启动 relay。
2. 保持一个已登录 ChatGPT 且加载 extension 的标签页打开。
3. 创建任务。
4. 轮询任务直到完成。
5. 读取纯文本结果或结构化 JSON。

创建任务：

```bash
curl -sS -X POST http://127.0.0.1:8787/jobs \
  -H 'content-type: application/json' \
  -d '{"prompt":"Reply with exactly: hello from relay","mode":"normal"}'
```

轮询任务：

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>
```

读取文本结果：

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result
```

读取结构化 JSON。可包含报告文本、sources 和图片元数据：

```bash
curl -sS http://127.0.0.1:8787/jobs/<job-id>/result.json
```

更多集成文档：

- [Consumer Integration Guide](docs/consumer-integration-guide.md)
- [Windows And WSL Setup](docs/setup-windows.md)
- [Troubleshooting](docs/troubleshooting.md)

## 为什么需要这个项目

有时候，一个产品、本地工具或 coding agent 想使用 ChatGPT 网页里的能力，比如 Deep Research 或 Create Image。常见做法都有一些限制：

- 手动使用 ChatGPT 网页最可靠，但很慢。用户需要打开网页、粘贴 prompt、等待结果、复制或下载内容，再放回自己的产品里。
- 使用某些 agent 内置的能力很方便，但它通常绑定特定 app、特定账号或官方集成。如果用户使用的是另一个本地 UI、另一个 coding agent，或者自定义 API 配置，这条路可能就不通用。
- 使用很重的第三方 gateway 项目也可以很强，但它们通常在解决账号池、代理、计费、多服务部署等更大的问题。对于只想在本地做一个轻量 relay 的开发者来说，复杂度太高。

ChatGPT Web Relay 的定位更小、更直接：你的应用把任务发到 `127.0.0.1`，浏览器扩展在真实 ChatGPT 页面里提交任务，然后 relay 把结果保存给你的应用读取。

它适合想要“简单、本地、真实浏览器登录”的开发者，不需要 token 注入、cookie 复制、账号池基础设施，也不需要托管 gateway。

## 功能

- 普通聊天任务。
- Deep Research 任务，可在页面可见时保存报告文本和来源信息。
- Create Image 任务，可把生成的图片保存到本地。
- 默认每个任务开启新的 ChatGPT 会话。
- 支持命名浏览器 profile，一个 profile 对应一个 ChatGPT 账号。
- 提供本地 HTTP API，方便其他应用和 agent 调用。
- 支持 Windows/WSL 启动器，会自动寻找 Edge 或 Chrome 并加载 unpacked extension。
- 可选桌面快捷方式。

## 浏览器路径自动发现

`relay:start` 和 `relay:doctor` 会自动查找 Edge 和 Chrome 的常见安装位置，包括 `Program Files`、`Program Files (x86)` 和 `%LOCALAPPDATA%`。

如果你的浏览器装在别的位置，可以设置回退变量：

```bash
CHATGPT_RELAY_WINDOWS_EDGE="/mnt/c/path/to/msedge.exe"
CHATGPT_RELAY_WINDOWS_CHROME="/mnt/c/path/to/chrome.exe"
```

在原生 Windows 上，请直接写 Windows 路径，例如 `C:\Path\To\chrome.exe`。

## Profile

默认使用 Edge：

```bash
npm run relay:start -- --port 8787
```

使用 Chrome：

```bash
npm run relay:start -- --browser chrome --port 8787
```

使用命名 profile：

```bash
npm run relay:start -- --profile account-a --port 8787
```

Profile 名称只能包含字母、数字、连字符和下划线。建议一个 ChatGPT 账号使用一个 profile。

## 排查问题

常见 `relay:doctor` 状态：

- `browser_not_found`：安装 Edge/Chrome，或者设置浏览器路径环境变量。
- `chatgpt_logged_out`：需要在打开的浏览器窗口里登录。
- `chatgpt_verification_required`：需要完成页面上的真人验证。
- `extension_not_loaded`：重新运行 `npm run relay:start`。
- `extension_outdated`：关闭旧的 ChatGPT relay 标签页并重新启动。
- `server_down`：需要先启动 relay。

## 桌面快捷方式

Windows/WSL 下可以运行：

```bash
npm run relay:shortcut
```

这个命令会创建一个本地命令文件和桌面快捷方式，用当前默认配置启动 relay。

## 运行时文件

运行时状态会被 git 忽略：

```text
.local/jobs
.local/results
.local/logs
```

Windows 浏览器 profile 和复制后的 extension 位于：

```text
%LOCALAPPDATA%\chatgpt-web-relay\
```

不要提交浏览器 profile、日志、生成结果、截图或账号数据。

## 环境变量

如果想自定义路径或默认配置，可以复制 `.env.example`：

```bash
cp .env.example .env
```

常用变量：

- `CHATGPT_RELAY_PORT`
- `CHATGPT_RELAY_PROFILE`
- `CHATGPT_RELAY_EXTENSION_BROWSER`
- `CHATGPT_RELAY_WINDOWS_BROWSER_PROFILES`
- `CHATGPT_RELAY_WINDOWS_EXTENSION_DIR`
- `CHATGPT_RELAY_WINDOWS_EDGE`
- `CHATGPT_RELAY_WINDOWS_CHROME`
- `CHATGPT_RELAY_WINDOWS_LOCALAPPDATA`

## 测试

```bash
npm test
```

测试是离线的，使用 Node 内置 test runner。

## Roadmap

- 小型本地状态 dashboard。
- 可选 extended-thinking selector。
- 更好的多 profile 管理 UI。
- 随着 ChatGPT UI 变化，继续增强 selector 稳定性。

## 安全和隐私

- 这个 relay 是 local-first，默认只绑定到 `127.0.0.1`。
- 不要把它暴露到公网。
- 不要通过 jobs 发送 auth token、cookie、密码或 API key。
- 详见 [SECURITY.md](SECURITY.md) 和 [PRIVACY.md](PRIVACY.md)。

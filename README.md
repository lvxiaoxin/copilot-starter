<div align="center">

# 🐣 copilot-starter

**A beautiful terminal UI for managing GitHub Copilot CLI sessions.**

Fuzzy search · Project grouping · Live preview · One-key resume.

[![npm version](https://img.shields.io/npm/v/copilot-starter.svg?color=cb3837&logo=npm)](https://www.npmjs.com/package/copilot-starter)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=node.js)](https://nodejs.org)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-23%20passing-brightgreen)](./test)
[![Made with Copilot CLI](https://img.shields.io/badge/built%20with-Copilot%20CLI-24292e?logo=github)](https://github.com/github/gh-copilot)

[English](#english) · [中文](#中文)

</div>

---

> **About this project**
>
> `copilot-starter` is a port of [`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter) for the **GitHub Copilot CLI**. The original tool gives Claude Code users a fast session manager; this one brings the same workflow to `copilot` users while leveraging Copilot CLI's richer storage (per-session SQLite + FTS5 + workspace metadata).
>
> The entire codebase — data layer, blessed TUI, tests, and this README — was **fully implemented by the GitHub Copilot CLI itself**. Yes, Copilot wrote its own session manager. 🐣

---

## English

```
┌─ Sessions ──────────────────────────────┐  ┌─ Preview ────────────────────────────┐
│ + New Session — start a fresh session   │  │  Configure Copilot MCP Servers       │
│ ● copilot-starter [LOCKED] Create…      │  │  b08615e2-…                          │
│ ● lvxin Configure Copilot MCP Servers   │  │                                      │
│                                         │  │  cwd      ~/lvxin                    │
│                                         │  │  project  lvxin                      │
│                                         │  │  messages 3                          │
│                                         │  │                                      │
│                                         │  │  Recent turns                        │
│                                         │  │  ▸ user  add the github mcp server   │
│                                         │  │  ▸ assistant  Done — wrote ~/.copilot/…│
└─────────────────────────────────────────┘  └──────────────────────────────────────┘
 ↑↓/jk nav • Enter resume • n new • / search • p project • s sort • r rename • c copy id • x delete • q quit
```

### Table of Contents

- [Why](#why)
- [Features](#features)
- [Installation](#installation)
- [Usage](#usage)
- [Keybindings](#keybindings)
- [How It Works](#how-it-works)
- [Safety](#safety)
- [Development](#development)
- [Roadmap](#roadmap)
- [Acknowledgments](#acknowledgments)
- [License](#license)

### Why

The built-in `copilot --resume` opens a picker over UUIDs and names — no project context, no preview, no search. For anyone juggling more than a handful of conversations across repos, that's not enough.

| Capability                              | `copilot --resume` | `copilot-starter` |
| --------------------------------------- | :----------------: | :---------------: |
| Browse all sessions                     |         ✅         |        ✅         |
| Filter by project / `cwd`               |         ❌         |        ✅         |
| Full-text search across turns (FTS5)    |         ❌         |        ✅         |
| Live preview of recent turns + files    |         ❌         |        ✅         |
| Sort by recency, message count, etc.    |         ❌         |        ✅         |
| Safe rename (survives auto-summary)     |         ❌         |        ✅         |
| Safe delete (lock-aware, transactional) |         ❌         |        ✅         |
| Vim-style keybindings                   |         ❌         |        ✅         |

`copilot-starter` is a **read-mostly client** of Copilot CLI's existing storage. No daemons, no telemetry, no config required.

### Features

- ⚡ **Instant `/` search** across session names, project, repo/branch, summaries, _and_ full-text turn content (FTS5).
- 📁 **Project grouping** — `p` to filter by `cwd`; per-project color tags.
- 👀 **Live preview pane** — recent user/assistant turns, touched files, refs.
- 🔀 **Sort cycling** — `s` cycles `updated → messages → checkpoints → files → project → name`.
- ✏️ **Safe rename** — edits `workspace.yaml` only; Copilot's auto-summary stays untouched.
- 🗑 **Safe delete** — refuses live sessions, removes both the state directory and _all_ DB rows (incl. the FTS5 index) in a single transaction.
- 🚀 **One-key resume** — `Enter` spawns `copilot --resume=<id>` in the session's original `cwd`.
- 🎨 **Tokyo Night palette** — easy on the eyes, terminfo-aware.
- 🛡 **Read-only by default** — opens the shared SQLite store read-only; writes only when you rename/delete.

### Installation

> **Requirements:** [Node.js](https://nodejs.org) **20+** and the [GitHub Copilot CLI](https://github.com/github/gh-copilot) on your `$PATH`.

📦 Available on npm: **[`copilot-starter`](https://www.npmjs.com/package/copilot-starter)**

```bash
# Run without installing
npx copilot-starter

# Or install globally
npm install -g copilot-starter
copilot-starter
```

> 💡 **Windows note:** `better-sqlite3` may need build tools (Visual Studio Build Tools or `windows-build-tools`). macOS arm64/x64 and Linux x64/arm64 ship prebuilt binaries.

### Usage

```bash
copilot-starter                        # launch the TUI
copilot-starter --list                 # plain table to stdout (default 30)
copilot-starter --list 100             # show 100 most-recent
copilot-starter --list --search MCP    # filter --list by keyword
copilot-starter --exclude '/tmp/'      # hide sessions whose cwd matches
copilot-starter --copilot-home ./fixt  # use an alternate ~/.copilot
copilot-starter --help                 # full help
copilot-starter --version
```

### Keybindings

| Key                 | Action                                                                |
| ------------------- | --------------------------------------------------------------------- |
| `↑` `↓` / `j` `k`   | Navigate the session list                                             |
| `Enter`             | Resume selected session (or start new if `+ New Session` is selected) |
| `n`                 | Start a new `copilot` session                                         |
| `/`                 | Instant search — type to filter, `Esc` to clear                       |
| `Esc`               | Clear search/project filter, or cancel a modal                        |
| `Backspace`         | Edit search; auto-exit search when empty                              |
| `p`                 | Filter by project (popup)                                             |
| `s`                 | Cycle sort: updated → messages → checkpoints → files → project → name |
| `r`                 | Rename selected session                                               |
| `c`                 | Copy session id to clipboard                                          |
| `x` / `Delete`      | Delete selected session (with confirm)                                |
| `g` / `G`           | Jump to top / bottom                                                  |
| `Ctrl-D` / `Ctrl-U` | Page down / up                                                        |
| `q` / `Ctrl-C`      | Quit                                                                  |

### How It Works

`copilot-starter` reads exactly what the GitHub Copilot CLI already writes to disk:

```
~/.copilot/
├── session-store.db                     # SQLite: sessions, turns, checkpoints,
│                                        #         session_files, session_refs,
│                                        #         FTS5 search_index
└── session-state/<session-uuid>/
    ├── workspace.yaml                   # name, cwd, user_named, summary, dates
    ├── events.jsonl                     # full event stream (not parsed by us)
    ├── checkpoints/…
    ├── files/…
    ├── session.db                       # per-session DB (untouched)
    └── inuse.<pid>.lock                 # present while a copilot is attached
```

The shared SQLite store is opened **read-only by default**. A second writable connection is opened only for rename and delete operations, and `journal_mode` is never modified — so we never disrupt a running Copilot.

> Set `COPILOT_HOME` (or pass `--copilot-home`) to point at an alternate Copilot home — useful for testing or sandboxing.

### Safety

#### Rename

Rename writes **only** to `workspace.yaml` (`name`, `user_named: true`, `updated_at`). It does **not** touch `sessions.summary` because Copilot may regenerate that field at any time and would clobber your edit.

The display title precedence is:

```
user-named workspace name → DB summary → auto workspace name → first 8 chars of id
```

The DB summary is shown separately in the preview as _"Generated summary"_ when it differs from the title.

#### Delete

Delete:

1. Refuses sessions with a live `inuse.<pid>.lock`.
2. Validates the id is UUID-shaped.
3. Refuses any path that escapes `~/.copilot/session-state/`.
4. Runs all `DELETE`s in a single transaction across `turns`, `checkpoints`, `session_files`, `session_refs`, `search_index`, and `sessions`.
5. Then `rm -rf`s the state directory.

Stale locks (PID no longer alive) are cleaned up incidentally.

### Development

```bash
git clone https://github.com/lvxiaoxin/copilot-starter
cd copilot-starter
npm install
npm test                                 # 23 tests for data + filter layers
node index.js --list                     # smoke check against your real ~/.copilot
node index.js                            # launch the TUI
```

**Project layout**

```
copilot-starter/
├── index.js              # CLI entry + blessed TUI
├── lib/
│   ├── cli.js            # arg parsing
│   ├── clipboard.js      # cross-platform pbcopy/wl-copy/xclip/xsel
│   ├── filters.js        # pure sort/search/project helpers
│   ├── format.js         # relTime, escTags, ellipsize, …
│   ├── locks.js          # PID-aware inuse.<pid>.lock detection
│   ├── paths.js          # honors $COPILOT_HOME
│   ├── sessions.js       # SessionStore — read-only default, FTS5 escaping
│   └── workspace.js      # atomic js-yaml round-trip of workspace.yaml
└── test/
    ├── _fixture.js       # builds a real SQLite DB matching Copilot's schema
    ├── filters.test.js
    ├── sessions.test.js
    └── workspace.test.js
```

The data layer (`lib/sessions.js`, `lib/workspace.js`, `lib/locks.js`, `lib/filters.js`) is pure and unit-tested. The TUI lives in `index.js`. Fixture-based tests build a real SQLite DB matching Copilot's schema, so any upstream schema change is detected by the test suite.

### Roadmap

- [ ] Optional `events.jsonl` viewer for richer conversation playback
- [ ] CI matrix (Node 20 / 22 across macOS / Linux / Windows)
- [ ] `--update` self-updater
- [ ] Session tagging / pinning
- [ ] Bulk operations (multi-select)

Issues and PRs welcome.

### Acknowledgments

- **[`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter)** — the original inspiration and UX blueprint. Many of the keybindings and the dual-pane layout are intentional ports.
- **[`blessed`](https://github.com/chjj/blessed)** — the venerable Node.js TUI library that powers the interface.
- **[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3)** — fast, synchronous SQLite bindings.
- **GitHub Copilot CLI** — for both providing the storage we read _and_ writing this entire codebase. 🐣

### License

[MIT](./LICENSE) © lvxin

---

## 中文

`copilot-starter` 是 [`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter) 的 **GitHub Copilot CLI 移植版**。原项目为 Claude Code 用户提供了一个快捷的会话管理器；本项目把同样的工作流带给 `copilot` 用户，并利用 Copilot CLI 更丰富的存储结构（每会话 SQLite + FTS5 + workspace 元数据）做了适配。

> 整个项目（数据层、blessed TUI、测试、README）**完全由 GitHub Copilot CLI 自己实现** —— Copilot 给自己写了一个会话管理器。🐣

### 为什么需要它

原生的 `copilot --resume` 只给你一个 UUID/名称的简易选择器：没有项目上下文、没有预览、没有搜索。`copilot-starter` 提供：

- ⚡ **`/` 即时搜索** —— 同时匹配会话名、项目、仓库/分支、摘要，以及全文内容（FTS5）。
- 📁 **项目筛选** —— 按 `p` 选择项目过滤；每个项目自动着色。
- 👀 **实时预览** —— 最近的用户/助手对话、修改过的文件、引用。
- 🔀 **多种排序** —— `s` 循环：更新时间 → 消息数 → checkpoint → 文件数 → 项目 → 名称。
- ✏️ **安全重命名** —— 只修改 `workspace.yaml`，不会被 Copilot 的自动摘要覆盖。
- 🗑 **安全删除** —— 拒绝正在使用的会话；在单个事务中清理状态目录与所有数据库记录（含 FTS5 索引）。
- 🚀 **一键恢复** —— `Enter` 在会话原始 `cwd` 下执行 `copilot --resume=<id>`。

### 安装

需要 **Node.js 20+** 与已安装的 GitHub Copilot CLI。

```bash
npx copilot-starter             # 直接运行
npm install -g copilot-starter  # 全局安装
```

### 用法

```bash
copilot-starter                        # 启动 TUI
copilot-starter --list                 # 纯文本列表（默认 30 条）
copilot-starter --list 100             # 列出最近 100 条
copilot-starter --list --search MCP    # 列表模式下按关键词过滤
copilot-starter --exclude '/tmp/'      # 隐藏 cwd 匹配的会话
copilot-starter --copilot-home ./fixt  # 使用其他 ~/.copilot 目录
```

### 快捷键

| 按键                | 操作                             |
| ------------------- | -------------------------------- |
| `↑` `↓` / `j` `k`   | 浏览会话列表                     |
| `Enter`             | 恢复选中的会话（或新建会话）     |
| `n`                 | 新建 `copilot` 会话              |
| `/`                 | 即时搜索（边输入边过滤）         |
| `Esc`               | 清空搜索/过滤，或取消弹窗        |
| `Backspace`         | 编辑搜索；为空时自动退出搜索模式 |
| `p`                 | 按项目过滤                       |
| `s`                 | 切换排序方式                     |
| `r`                 | 重命名会话                       |
| `c`                 | 复制会话 ID 到剪贴板             |
| `x` / `Delete`      | 删除会话（需确认）               |
| `g` / `G`           | 跳到列表顶部 / 底部              |
| `Ctrl-D` / `Ctrl-U` | 翻页                             |
| `q` / `Ctrl-C`      | 退出                             |

### 存储与安全

`copilot-starter` 只读取 Copilot CLI 已经写好的数据：`~/.copilot/session-store.db`（SQLite）和 `~/.copilot/session-state/<uuid>/`。默认以 **只读** 模式打开数据库，只在执行重命名/删除时打开写连接，不会修改 `journal_mode`，避免干扰正在运行的 Copilot。

- **重命名**：只写 `workspace.yaml`，不触碰 `sessions.summary`，避免被 Copilot 的自动摘要回滚。
- **删除**：校验 UUID、检查路径越界、拒绝带活动 lock 的会话；在单事务内清理所有相关表后再 `rm -rf` 状态目录。

### 致谢

- [`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter) —— 灵感来源与 UX 蓝本。
- [`blessed`](https://github.com/chjj/blessed) —— Node.js 终端 UI 库。
- [`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) —— 同步 SQLite 绑定。
- **GitHub Copilot CLI** —— 提供我们读取的存储，也亲手写了这整个代码库。🐣

### 许可证

[MIT](./LICENSE)

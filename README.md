# copilot-starter

A beautiful TUI for managing GitHub Copilot CLI sessions — fuzzy search, project grouping, conversation preview, one-key resume.

> **About this project**
> `copilot-starter` is a port of [`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter) for the **GitHub Copilot CLI**. The original tool gives Claude Code users a fast session manager; this one brings the same workflow to `copilot` users while taking advantage of Copilot CLI's richer storage (per-session SQLite + FTS5 + workspace metadata).
>
> The entire codebase — data layer, blessed TUI, tests, and this README — was **fully implemented by Copilot CLI itself**. Yes, Copilot wrote its own session manager. 🐣

> [中文文档](#中文)

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

## Why

`copilot --resume` opens a picker over UUIDs/names with no project context, no preview, no search. `copilot-starter` gives you:

- **Instant `/` search** across session names, project, repo/branch, summaries, *and* full-text content (FTS5).
- **Project grouping** — `p` to filter by `cwd`.
- **Live preview** — recent user/assistant turns, touched files, refs.
- **Sort modes** — `s` cycles updated → messages → checkpoints → files → project → name.
- **Safe rename** — edits `workspace.yaml` only (Copilot's auto-summary stays untouched).
- **Safe delete** — refuses live sessions, removes both the state directory and all DB rows (incl. FTS5 index).
- **One-key resume** — `Enter` spawns `copilot --resume=<id>` in the session's original `cwd`.

Built as a single read-mostly client of Copilot CLI's storage. No daemons, no telemetry, no config required.

## Install

Requires **Node.js 20+** (for `better-sqlite3` prebuilds and modern `node --test`) and the GitHub Copilot CLI on `$PATH`.

```bash
# Run without installing
npx copilot-starter

# Or install globally
npm install -g copilot-starter
copilot-starter
```

> Windows note: `better-sqlite3` may need build tools. macOS arm64/x64 and Linux x64/arm64 ship prebuilds.

## Usage

```bash
copilot-starter                        # launch the TUI
copilot-starter --list                 # plain table to stdout (default 30)
copilot-starter --list 100             # show 100 most-recent
copilot-starter --list --search MCP    # filter --list by query
copilot-starter --exclude '/tmp/'      # hide sessions whose cwd matches
copilot-starter --copilot-home ./fixt  # use an alternate ~/.copilot
```

### Keybindings

| Key                | Action                                   |
| ------------------ | ---------------------------------------- |
| `↑` `↓` / `j` `k`  | Navigate the session list                |
| `Enter`            | Resume selected session (or start a new one if `+ New Session` is selected) |
| `n`                | Start a new `copilot` session            |
| `/`                | Instant search — type to filter, Esc to clear |
| `Esc`              | Clear search/project filter, or cancel a modal |
| `Backspace`        | Edit search; auto-exit search when empty |
| `p`                | Filter by project (popup)                |
| `s`                | Cycle sort: updated → messages → checkpoints → files → project → name |
| `r`                | Rename selected session                  |
| `c`                | Copy session id to clipboard             |
| `x` / `Delete`     | Delete selected session (with confirm)   |
| `g` / `G`          | Jump to top / bottom                     |
| `Ctrl-D` / `Ctrl-U`| Page down / up                           |
| `q` / `Ctrl-C`     | Quit                                     |

### Storage layout

`copilot-starter` reads what the GitHub Copilot CLI already writes:

```
~/.copilot/
├── session-store.db                     # SQLite: sessions, turns, checkpoints,
│                                        # session_files, session_refs, FTS5 search_index
└── session-state/<session-uuid>/
    ├── workspace.yaml                   # name, cwd, user_named, summary, dates
    ├── events.jsonl                     # full event stream (not parsed by us)
    ├── checkpoints/…
    ├── files/…
    ├── session.db                       # per-session DB (untouched)
    └── inuse.<pid>.lock                 # present while a copilot is attached
```

The SQLite store is opened **read-only by default**. A second writable connection is opened only for rename and delete; `journal_mode` is never modified so we don't disrupt Copilot.

### Rename behavior

Rename writes ONLY to `workspace.yaml` (`name`, `user_named: true`, `updated_at`). It does **not** touch `sessions.summary` because Copilot may regenerate that field at any time and would clobber your edit. The display title precedence is: user-named workspace name → DB summary → auto workspace name → first 8 chars of id. The DB summary is shown separately in the preview as "Generated summary" when it differs from the title.

### Delete safety

Delete refuses sessions with a live `inuse.<pid>.lock`, validates the id is UUID-shaped, refuses any path that escapes `~/.copilot/session-state/`, runs all DELETEs in a single transaction, then `rm -rf`s the state directory. Stale locks (PID no longer alive) are cleaned up incidentally.

## Development

```bash
git clone https://github.com/<you>/copilot-starter
cd copilot-starter
npm install
npm test                                 # 23 tests for the data + filter layers
node index.js --list                     # smoke check against your real ~/.copilot
node index.js                            # launch the TUI
```

The data layer (`lib/sessions.js`, `lib/workspace.js`, `lib/locks.js`, `lib/filters.js`) is pure and unit-tested. The TUI lives in `index.js`. Fixture-based tests (`test/_fixture.js`) build a real SQLite DB with the same schema as Copilot's, so changes to that schema can be detected.

## License

MIT

---

## 中文

`copilot-starter` 是 [`Bojun-Vvibe/claude-starter`](https://github.com/Bojun-Vvibe/claude-starter) 的 **GitHub Copilot CLI 移植版**。原版项目为 Claude Code 用户提供了一个快捷的会话管理器；本项目把同样的工作流带给 `copilot` 用户，并利用 Copilot CLI 更丰富的存储结构（每会话 SQLite + FTS5 + workspace 元数据）做了适配。

> 整个项目（数据层、blessed TUI、测试、README）**完全由 Copilot CLI 自己实现** —— Copilot 给自己写了一个会话管理器。🐣

### 为什么需要它

原生的 `copilot --resume` 只给你一个 UUID/名称的简易选择器，没有项目上下文、没有预览、没有搜索。`copilot-starter` 提供：

- **`/` 即时搜索** —— 同时匹配会话名、项目、仓库/分支、摘要，以及全文内容（FTS5）。
- **项目筛选** —— 按 `p` 选择项目过滤。
- **实时预览** —— 最近的用户/助手对话、修改过的文件、引用。
- **多种排序** —— `s` 循环：更新时间 → 消息数 → checkpoint → 文件数 → 项目 → 名称。
- **安全重命名** —— 只修改 `workspace.yaml`，不会被 Copilot 的自动摘要覆盖。
- **安全删除** —— 拒绝正在使用的会话，会清理状态目录与所有数据库记录（含 FTS5 索引）。
- **一键恢复** —— `Enter` 在会话原始 `cwd` 下执行 `copilot --resume=<id>`。

### 安装

需要 **Node.js 20+** 与已安装的 GitHub Copilot CLI。

```bash
npx copilot-starter           # 直接运行
npm install -g copilot-starter # 或全局安装
```

### 用法

```bash
copilot-starter                      # 启动 TUI
copilot-starter --list               # 纯文本列表（默认 30 条）
copilot-starter --list 100           # 列出最近 100 条
copilot-starter --list --search MCP  # 列表模式下按关键词过滤
```

### 快捷键

| 按键              | 操作                                  |
| ----------------- | ------------------------------------- |
| `↑` `↓` / `j` `k` | 浏览会话列表                          |
| `Enter`           | 恢复选中的会话（或新建会话）          |
| `n`               | 新建 `copilot` 会话                   |
| `/`               | 即时搜索（边输入边过滤）              |
| `Esc`             | 清空搜索/过滤，或取消弹窗             |
| `Backspace`       | 编辑搜索；为空时自动退出搜索模式      |
| `p`               | 按项目过滤                            |
| `s`               | 切换排序方式                          |
| `r`               | 重命名会话                            |
| `c`               | 复制会话 ID 到剪贴板                  |
| `x` / `Delete`    | 删除会话（需确认）                    |
| `g` / `G`         | 跳到列表顶部/底部                     |
| `Ctrl-D` / `Ctrl-U` | 翻页                                |
| `q` / `Ctrl-C`    | 退出                                  |

### 存储说明

`copilot-starter` 只读取 Copilot CLI 已经写好的数据：`~/.copilot/session-store.db`（SQLite）和 `~/.copilot/session-state/<uuid>/`。默认以 **只读** 模式打开数据库，仅在执行重命名/删除时开启写连接，不会修改 `journal_mode`，避免干扰 Copilot 自身。

### 许可证

MIT

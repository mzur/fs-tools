# fs-tools

MCP server providing file system discovery tools for Claude Code.

## Tools

**ListDirectory** — list entries in a directory.
- `path` (required): directory to list
- `recursive`: recurse into subdirectories (default: false)
- `maxResults`: max entries to return (default: 100)
- `offset`: entries to skip, for pagination

**FindFiles** — find files whose name matches a glob pattern.
- `path` (required): directory to search under
- `pattern` (required): glob matched against filename only, e.g. `*.yaml`, `*config*`
- `maxResults`: max results to return (default: 100)
- `offset`: results to skip, for pagination

Both tools return a `(N more, use offset X)` hint when results are truncated.

## Setup

```sh
npm install
claude mcp add --scope user fs-tools node /home/m/.claude/fs-tools/index.js
```

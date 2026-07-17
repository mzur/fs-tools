#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { readdirSync, realpathSync } from "fs";
import { join, resolve, basename } from "path";
import { homedir } from "os";

const server = new Server(
  { name: "fs-tools", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

const expandPath = (p) => resolve(p.replace(/^~/, homedir()));

const resolveUnderCwd = (p = ".") => {
  // realpath follows symlinks, so a link inside cwd pointing outside is caught
  const cwd = realpathSync(process.cwd());
  const abs = realpathSync(resolve(cwd, p));
  if (abs !== cwd && !abs.startsWith(cwd + "/")) {
    throw new Error(`Path escapes current working directory: ${p}`);
  }
  return abs;
};

const globToRegex = (pattern) => {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".");
  return new RegExp(`^${escaped}$`);
};

const walkAll = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walkAll(full) : [full];
  });

const walk = (dir, recursive, depth = 0) =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name);
    const indent = "  ".repeat(depth);
    if (entry.isDirectory()) {
      return recursive
        ? [`${indent}${entry.name}/`, ...walk(full, recursive, depth + 1)]
        : [`${indent}${entry.name}/`];
    }
    return [`${indent}${entry.name}`];
  });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "ListDirectory",
      description: "List files in a directory, optionally recursive",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to list" },
          recursive: { type: "boolean", description: "Recurse into subdirectories" },
          maxResults: { type: "number", description: "Maximum number of entries to return (default 100)" },
          offset: { type: "number", description: "Number of entries to skip (for pagination)" }
        },
        required: ["path"]
      }
    },
    {
      name: "FindFiles",
      description: "Find files under a directory whose name matches a glob pattern (e.g. *.yaml, *config*)",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory to search under" },
          pattern: { type: "string", description: "Glob pattern matched against the filename (not the full path)" },
          maxResults: { type: "number", description: "Maximum number of results to return (default 100)" },
          offset: { type: "number", description: "Number of results to skip (for pagination)" }
        },
        required: ["path", "pattern"]
      }
    },
    {
      name: "ListDirectoryCurrent",
      description: "List files under the current working directory (or a relative subdirectory of it), optionally recursive",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subdirectory relative to the current working directory (default '.')" },
          recursive: { type: "boolean", description: "Recurse into subdirectories" },
          maxResults: { type: "number", description: "Maximum number of entries to return (default 100)" },
          offset: { type: "number", description: "Number of entries to skip (for pagination)" }
        }
      }
    },
    {
      name: "FindFilesCurrent",
      description: "Find files under the current working directory (or a relative subdirectory of it) whose name matches a glob pattern (e.g. *.yaml, *config*)",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Subdirectory relative to the current working directory (default '.')" },
          pattern: { type: "string", description: "Glob pattern matched against the filename (not the full path)" },
          maxResults: { type: "number", description: "Maximum number of results to return (default 100)" },
          offset: { type: "number", description: "Number of results to skip (for pagination)" }
        },
        required: ["pattern"]
      }
    }
  ]
}));

const toolResult = (text) => ({ content: [{ type: "text", text }] });
const errResult = (msg) => ({ content: [{ type: "text", text: `Error: ${msg}` }], isError: true });

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const paginate = (items, offset, maxResults = 100) => {
    const start = offset ?? 0;
    const sliced = items.slice(start, start + maxResults);
    const remaining = items.length - start - sliced.length;
    const suffix = remaining > 0 ? `\n(${remaining} more, use offset ${start + sliced.length})` : "";
    return { sliced, suffix };
  };

  if (name === "ListDirectory") {
    const { path: dirPath, recursive = false, maxResults, offset } = args;
    try {
      const absPath = expandPath(dirPath);
      const entries = walk(absPath, recursive);
      const { sliced, suffix } = paginate(entries, offset, maxResults);
      return toolResult(sliced.join("\n") + suffix || "(empty)");
    } catch (e) {
      return errResult(e.message);
    }
  }

  if (name === "FindFiles") {
    const { path: dirPath, pattern, maxResults, offset } = args;
    try {
      const absPath = expandPath(dirPath);
      const re = globToRegex(pattern);
      const matches = walkAll(absPath).filter(f => re.test(basename(f)));
      const { sliced, suffix } = paginate(matches, offset, maxResults);
      return toolResult(sliced.join("\n") + suffix || "(no matches)");
    } catch (e) {
      return errResult(e.message);
    }
  }

  if (name === "ListDirectoryCurrent") {
    const { path: dirPath, recursive = false, maxResults, offset } = args;
    try {
      const absPath = resolveUnderCwd(dirPath);
      const entries = walk(absPath, recursive);
      const { sliced, suffix } = paginate(entries, offset, maxResults);
      return toolResult(sliced.join("\n") + suffix || "(empty)");
    } catch (e) {
      return errResult(e.message);
    }
  }

  if (name === "FindFilesCurrent") {
    const { path: dirPath, pattern, maxResults, offset } = args;
    try {
      const absPath = resolveUnderCwd(dirPath);
      const re = globToRegex(pattern);
      const matches = walkAll(absPath).filter(f => re.test(basename(f)));
      const { sliced, suffix } = paginate(matches, offset, maxResults);
      return toolResult(sliced.join("\n") + suffix || "(no matches)");
    } catch (e) {
      return errResult(e.message);
    }
  }

  throw new Error(`Unknown tool: ${name}`);
});

await server.connect(new StdioServerTransport());

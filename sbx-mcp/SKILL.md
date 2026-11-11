---
name: sbx-mcp
description: Use inside a Docker sbx sandbox before driving a browser (Playwright, Chrome DevTools) or any MCP server missing from your tool list. Covers the MCP gateway (mcp-find, mcp-add, mcp-exec) and how host browsers reach sandbox ports.
---

# MCP and browsers inside an sbx sandbox

## Get a server's tools

Servers that aren't in your tool list sit behind the MCP gateway. `ToolSearch` doesn't index them, so don't search there.

1. `mcp__mcp-gateway__mcp-find` with the server name (`playwright`) confirms it exists.
2. `mcp__mcp-gateway__mcp-add` with that name enables it for the session.
3. Call its tools through `mcp__mcp-gateway__mcp-exec`, passing `name` (for example `browser_navigate`) and `arguments`. The tools stay out of your tool list after `mcp-add`.

Done when a tool call such as `browser_navigate` returns a page title.

## Reach sandbox servers from a browser

Playwright and Chrome DevTools run on the host, so `localhost` in the browser is the host's, not the sandbox's.

- Start the server bound to `0.0.0.0` so the published port can reach it.
- Browse to the host-side port of the mapping. Look for it in the repo's `AGENTS.md`; if it isn't there, ask the user to run `sbx ports $SANDBOX_NAME --publish HOST:SANDBOX/tcp` on the host.
- Use the sandbox-side port only for tools inside the sandbox, such as `curl`.

## Read results

- A navigate result lists console errors and points to a snapshot file. Read `browser_console_messages` for the error text.
- A `/favicon.ico` 404 is expected noise on sites without a favicon.

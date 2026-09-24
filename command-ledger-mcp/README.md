# command-ledger-mcp (Command Runbook & Pitfall Shield)

Lightweight, high-performance Go MCP server and CLI utility designed to remember which commands work and which fail/hang, preventing AI agents and developers from repeating previous mistakes ("stepping on rakes").

## Key Capabilities

- **Command Memory**: Logs exact commands, status (`works`, `failed`, `hung`, `caution`), rationale, and working solutions.
- **Dual-Mode**:
  - **MCP Server** (JSON-RPC 2.0 stdio) for Claude Code, Cursor, Antigravity, OpenClaw.
  - **CLI Tool** (`./bin/cmdlog`) for fast terminal queries and manual inspection.
- **Pre-seeded Knowledge**: Ships with common project pitfalls (macOS LaunchAgent conflicts, PYTHONPATH requirements, grep directory hangs, Brevo domain sender rules).
- **Runbook Generation**: Exports clean Markdown documentation (`COMMAND_RUNBOOK.md`) on demand.

## MCP Tools Provided

1. `log_command`: Record an execution result, explaining why it failed and what the solution is.
2. `check_command`: Query whether a command or tool has known failure modes before running it.
3. `list_gotchas`: Retrieve all documented pitfalls and recommended fixes.
4. `export_runbook`: Export the ledger to Markdown (`COMMAND_RUNBOOK.md`).

## Building

```bash
cd command-ledger-mcp
go build -o bin/cmdlog main.go
```

## CLI Usage

```bash
# Check if a command is safe or known to fail
./bin/cmdlog check "openclaw gateway"

# View all broken commands and their fixes
./bin/cmdlog gotchas

# Log a command result
./bin/cmdlog log --cmd "openclaw gateway restart" --status "works" --summary "Reloads LaunchAgent cleanly"

# Export to Markdown
./bin/cmdlog export COMMAND_RUNBOOK.md
```

## MCP Configuration (Claude Desktop / Cursor / OpenClaw)

```json
{
  "mcpServers": {
    "command-ledger": {
      "command": "/path/to/claude bot/command-ledger-mcp/bin/cmdlog",
      "args": ["--mcp"],
      "env": {
        "COMMAND_LEDGER_PATH": "/path/to/claude bot/command-ledger-mcp/.command_ledger.json"
      }
    }
  }
}
```

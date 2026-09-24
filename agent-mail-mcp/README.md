# agent-mail-mcp

Standalone Go MCP (Model Context Protocol) server for AI agents to securely send and receive emails via `send.waveio.me` and `mail.waveio.me`.

## Features
- **Zero credential leaks**: The agent only holds an `AGENT_TOKEN`. The master Brevo API keys remain securely inside the Cloudflare Worker.
- **Identity resolution**: The gateway automatically maps agent requests to `lokzu@ag.waveio.me` and sets `Reply-To`.
- **Full MCP 2024-11-05 standard**: Works over `stdio` with Claude, Cursor, Antigravity, OpenClaw, and Virtual Bot.
- **Tools provided**:
  - `send_email`: Send emails to external recipients.
  - `check_inbox`: View received emails in the agent mailbox.
  - `get_verification_code`: Fetch latest OTP/verification code.
  - `my_email`: Inspect mailbox info.

## Building
```bash
go build -o bin/agent-mail-mcp main.go
```

## Running
```bash
AGENT_TOKEN="ag_tok_lokzu_sec_2026" AGENT_EMAIL="lokzu@ag.waveio.me" ./bin/agent-mail-mcp
```

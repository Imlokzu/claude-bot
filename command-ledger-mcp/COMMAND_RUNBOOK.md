# Command Runbook & Pitfall Shield

*Generated on 2026-09-21 21:41:48 UTC from `.command_ledger.json`*

## ⚠️ Known Pitfalls & Gotchas (Do NOT Run Without Fix)

| Status | Command | Why It Fails / Gotcha | Recommended Solution / Safe Command |
| :--- | :--- | :--- | :--- |
| ❌ failed | `openclaw gateway run --force` | Conflicts with running macOS LaunchAgent daemon (pid already owns state dir) | **`openclaw gateway restart`** |
| ❌ failed | `cd "Virtual Bot" && pytest tests/ -q` | ModuleNotFoundError when importing local app modules without PYTHONPATH | **`cd "Virtual Bot" && PYTHONPATH="$PWD" .venv/bin/pytest tests/ -q`** |
| ⏳ hung | `grep -rn "pattern" "Virtual Bot"` | Scans large directories like .venv and node_modules, hanging background agents | **`git grep -i "pattern" "Virtual Bot" or grep --exclude-dir={.venv,node_modules}`** |
| ❌ failed | `curl -X POST send.waveio.me with sender=lokzuhd@gmail.com` | Brevo rejects senders whose domains are not verified in Brevo account | **`Send from noreply@waveio.me with Reply-To set to agent inbox lokzu@ag.waveio.me`** |

## ✅ Verified Working Commands

| Status | Command | Context / Summary | Tags |
| :--- | :--- | :--- | :--- |
| ✅ works | `openclaw models status` | Cleanly reports provider health, OAuth expiration and token usage quotas | `openclaw, auth` |
| ✅ works | `openclaw models auth login --provider openai --device-code` | Authenticates ChatGPT Plus via browser device code flow cleanly | `openclaw, auth, chatgpt` |

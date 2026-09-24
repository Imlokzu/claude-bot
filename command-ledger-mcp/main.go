package main

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"
)

const (
	mcpVersion          = "2024-11-05"
	defaultLedgerFile   = ".command_ledger.json"
	defaultRunbookFile  = "COMMAND_RUNBOOK.md"
)

// CommandEntry represents a logged shell command or operation result.
type CommandEntry struct {
	ID        string    `json:"id"`
	Command   string    `json:"command"`
	Status    string    `json:"status"` // "works", "failed", "hung", "caution"
	Summary   string    `json:"summary"`
	Solution  string    `json:"solution,omitempty"`
	Tags      []string  `json:"tags,omitempty"`
	WorkDir   string    `json:"workdir,omitempty"`
	ExitCode  *int      `json:"exit_code,omitempty"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Ledger holds and persists command entries.
type Ledger struct {
	sync.RWMutex
	filePath string
	Entries  []CommandEntry `json:"entries"`
}

func getLedgerPath() string {
	if custom := os.Getenv("COMMAND_LEDGER_PATH"); custom != "" {
		return custom
	}
	return defaultLedgerFile
}

func newLedger(path string) (*Ledger, error) {
	l := &Ledger{filePath: path, Entries: make([]CommandEntry, 0)}
	if err := l.load(); err != nil {
		return nil, err
	}
	return l, nil
}

func (l *Ledger) load() error {
	l.Lock()
	defer l.Unlock()

	data, err := os.ReadFile(l.filePath)
	if err != nil {
		if os.IsNotExist(err) {
			l.Entries = getDefaultSeedEntries()
			_ = l.saveUnlocked()
			return nil
		}
		return err
	}

	if len(data) == 0 {
		l.Entries = getDefaultSeedEntries()
		return nil
	}

	return json.Unmarshal(data, &l.Entries)
}

func (l *Ledger) saveUnlocked() error {
	data, err := json.MarshalIndent(l.Entries, "", "  ")
	if err != nil {
		return err
	}

	tmpFile := l.filePath + ".tmp"
	if err := os.WriteFile(tmpFile, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmpFile, l.filePath)
}

func (l *Ledger) Save() error {
	l.Lock()
	defer l.Unlock()
	return l.saveUnlocked()
}

func (l *Ledger) AddOrUpdate(entry CommandEntry) (CommandEntry, bool) {
	l.Lock()
	defer l.Unlock()

	now := time.Now().UTC()
	trimmedCmd := strings.TrimSpace(entry.Command)

	for i, existing := range l.Entries {
		if strings.TrimSpace(existing.Command) == trimmedCmd {
			l.Entries[i].Status = entry.Status
			l.Entries[i].Summary = entry.Summary
			if entry.Solution != "" {
				l.Entries[i].Solution = entry.Solution
			}
			if len(entry.Tags) > 0 {
				l.Entries[i].Tags = mergeTags(existing.Tags, entry.Tags)
			}
			if entry.WorkDir != "" {
				l.Entries[i].WorkDir = entry.WorkDir
			}
			if entry.ExitCode != nil {
				l.Entries[i].ExitCode = entry.ExitCode
			}
			l.Entries[i].UpdatedAt = now
			_ = l.saveUnlocked()
			return l.Entries[i], false
		}
	}

	if entry.ID == "" {
		entry.ID = fmt.Sprintf("cmd_%d", time.Now().UnixNano())
	}
	entry.CreatedAt = now
	entry.UpdatedAt = now
	l.Entries = append(l.Entries, entry)
	_ = l.saveUnlocked()
	return entry, true
}

func (l *Ledger) Search(query string, tag string) []CommandEntry {
	l.RLock()
	defer l.RUnlock()

	q := strings.ToLower(strings.TrimSpace(query))
	t := strings.ToLower(strings.TrimSpace(tag))

	var matches []CommandEntry
	for _, e := range l.Entries {
		matchQuery := q == "" || strings.Contains(strings.ToLower(e.Command), q) ||
			strings.Contains(strings.ToLower(e.Summary), q) ||
			strings.Contains(strings.ToLower(e.Solution), q)

		matchTag := true
		if t != "" {
			matchTag = false
			for _, item := range e.Tags {
				if strings.ToLower(item) == t {
					matchTag = true
					break
				}
			}
		}

		if matchQuery && matchTag {
			matches = append(matches, e)
		}
	}
	return matches
}

func (l *Ledger) Gotchas(limit int) []CommandEntry {
	l.RLock()
	defer l.RUnlock()

	var list []CommandEntry
	for _, e := range l.Entries {
		if e.Status == "failed" || e.Status == "hung" || e.Status == "caution" {
			list = append(list, e)
		}
	}
	if limit > 0 && len(list) > limit {
		list = list[:limit]
	}
	return list
}

func (l *Ledger) ExportMarkdown(targetPath string) error {
	l.RLock()
	defer l.RUnlock()

	if targetPath == "" {
		targetPath = defaultRunbookFile
	}

	var sb strings.Builder
	sb.WriteString("# Command Runbook & Pitfall Shield\n\n")
	sb.WriteString(fmt.Sprintf("*Generated on %s from `%s`*\n\n", time.Now().Format("2006-01-02 15:04:05 UTC"), l.filePath))

	sb.WriteString("## ⚠️ Known Pitfalls & Gotchas (Do NOT Run Without Fix)\n\n")
	sb.WriteString("| Status | Command | Why It Fails / Gotcha | Recommended Solution / Safe Command |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- |\n")

	gotchas := l.Gotchas(0)
	for _, g := range gotchas {
		statusBadge := "❌ " + g.Status
		if g.Status == "caution" {
			statusBadge = "⚠️ " + g.Status
		} else if g.Status == "hung" {
			statusBadge = "⏳ " + g.Status
		}
		cmdSafe := strings.ReplaceAll(g.Command, "|", "\\|")
		sumSafe := strings.ReplaceAll(g.Summary, "|", "\\|")
		solSafe := strings.ReplaceAll(g.Solution, "|", "\\|")
		if solSafe == "" {
			solSafe = "*(No solution documented yet)*"
		}
		sb.WriteString(fmt.Sprintf("| %s | `%s` | %s | **`%s`** |\n", statusBadge, cmdSafe, sumSafe, solSafe))
	}

	sb.WriteString("\n## ✅ Verified Working Commands\n\n")
	sb.WriteString("| Status | Command | Context / Summary | Tags |\n")
	sb.WriteString("| :--- | :--- | :--- | :--- |\n")

	for _, e := range l.Entries {
		if e.Status == "works" {
			cmdSafe := strings.ReplaceAll(e.Command, "|", "\\|")
			sumSafe := strings.ReplaceAll(e.Summary, "|", "\\|")
			tagsSafe := strings.Join(e.Tags, ", ")
			sb.WriteString(fmt.Sprintf("| ✅ works | `%s` | %s | `%s` |\n", cmdSafe, sumSafe, tagsSafe))
		}
	}

	return os.WriteFile(targetPath, []byte(sb.String()), 0644)
}

func mergeTags(oldTags, newTags []string) []string {
	seen := make(map[string]bool)
	var res []string
	for _, t := range append(oldTags, newTags...) {
		val := strings.TrimSpace(t)
		if val != "" && !seen[val] {
			seen[val] = true
			res = append(res, val)
		}
	}
	return res
}

func getDefaultSeedEntries() []CommandEntry {
	now := time.Now().UTC()
	return []CommandEntry{
		{
			ID:        "seed_openclaw_restart",
			Command:   "openclaw gateway run --force",
			Status:    "failed",
			Summary:   "Conflicts with running macOS LaunchAgent daemon (pid already owns state dir)",
			Solution:  "openclaw gateway restart",
			Tags:      []string{"openclaw", "macos", "service"},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "seed_openclaw_auth_status",
			Command:   "openclaw models status",
			Status:    "works",
			Summary:   "Cleanly reports provider health, OAuth expiration and token usage quotas",
			Solution:  "Use after authentication or restart to verify live credentials",
			Tags:      []string{"openclaw", "auth"},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "seed_pytest_pythonpath",
			Command:   "cd \"Virtual Bot\" && pytest tests/ -q",
			Status:    "failed",
			Summary:   "ModuleNotFoundError when importing local app modules without PYTHONPATH",
			Solution:  "cd \"Virtual Bot\" && PYTHONPATH=\"$PWD\" .venv/bin/pytest tests/ -q",
			Tags:      []string{"python", "test", "virtual-bot"},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "seed_grep_hang",
			Command:   "grep -rn \"pattern\" \"Virtual Bot\"",
			Status:    "hung",
			Summary:   "Scans large directories like .venv and node_modules, hanging background agents",
			Solution:  "git grep -i \"pattern\" \"Virtual Bot\" or grep --exclude-dir={.venv,node_modules}",
			Tags:      []string{"bash", "grep", "performance"},
			CreatedAt: now,
			UpdatedAt: now,
		},
		{
			ID:        "seed_brevo_sender_domain",
			Command:   "curl -X POST send.waveio.me with sender=lokzuhd@gmail.com",
			Status:    "failed",
			Summary:   "Brevo rejects senders whose domains are not verified in Brevo account",
			Solution:  "Send from noreply@waveio.me with Reply-To set to agent inbox lokzu@ag.waveio.me",
			Tags:      []string{"email", "brevo", "domain"},
			CreatedAt: now,
			UpdatedAt: now,
		},
	}
}

// -----------------------------------------------------------------------------
// MCP Server Structures (JSON-RPC 2.0 stdio)
// -----------------------------------------------------------------------------

type JSONRPCRequest struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      interface{}     `json:"id,omitempty"`
	Method  string          `json:"method"`
	Params  json.RawMessage `json:"params,omitempty"`
}

type JSONRPCResponse struct {
	JSONRPC string      `json:"jsonrpc"`
	ID      interface{} `json:"id,omitempty"`
	Result  interface{} `json:"result,omitempty"`
	Error   *RPCError   `json:"error,omitempty"`
}

type RPCError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type ToolInfo struct {
	Name        string      `json:"name"`
	Description string      `json:"description"`
	InputSchema interface{} `json:"inputSchema"`
}

type CallToolParams struct {
	Name      string                 `json:"name"`
	Arguments map[string]interface{} `json:"arguments"`
}

type TextContent struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

type CallToolResult struct {
	Content []TextContent `json:"content"`
	IsError bool          `json:"isError,omitempty"`
}

func getTools() []ToolInfo {
	return []ToolInfo{
		{
			Name: "log_command",
			Description: "Log a command execution result (success, failure, hang, or caution). " +
				"Use this whenever a command fails or behaves unexpectedly, documenting the rake and its solution.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"command": map[string]interface{}{
						"type":        "string",
						"description": "The exact command line string or action attempted.",
					},
					"status": map[string]interface{}{
						"type":        "string",
						"enum":        []string{"works", "failed", "hung", "caution"},
						"description": "Whether the command works, failed, hung, or requires caution.",
					},
					"summary": map[string]interface{}{
						"type":        "string",
						"description": "Short explanation of what happened or why it failed.",
					},
					"solution": map[string]interface{}{
						"type":        "string",
						"description": "The correct command or recommended workaround to use instead.",
					},
					"tags": map[string]interface{}{
						"type": "array",
						"items": map[string]interface{}{
							"type": "string",
						},
						"description": "Categories or tools involved (e.g. ['openclaw', 'macos']).",
					},
					"workdir": map[string]interface{}{
						"type":        "string",
						"description": "Working directory context if relevant.",
					},
					"exit_code": map[string]interface{}{
						"type":        "integer",
						"description": "Exit code if available.",
					},
				},
				"required": []string{"command", "status", "summary"},
			},
		},
		{
			Name: "check_command",
			Description: "Search the knowledge base before running a command to see if it previously failed, hung, or has a known fix.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"query": map[string]interface{}{
						"type":        "string",
						"description": "Substring of the command or tool you plan to run (e.g. 'openclaw gateway' or 'pytest').",
					},
					"tag": map[string]interface{}{
						"type":        "string",
						"description": "Optional category filter.",
					},
				},
				"required": []string{"query"},
			},
		},
		{
			Name: "list_gotchas",
			Description: "List all known pitfalls, broken commands, or hung operations along with their documented solutions.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum number of entries to return (default 20).",
					},
				},
			},
		},
		{
			Name: "export_runbook",
			Description: "Export the full command ledger into a clean Markdown runbook file (e.g. COMMAND_RUNBOOK.md).",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"file_path": map[string]interface{}{
						"type":        "string",
						"description": "Destination file path (defaults to COMMAND_RUNBOOK.md).",
					},
				},
			},
		},
	}
}

func handleCallTool(ledger *Ledger, params CallToolParams) CallToolResult {
	switch params.Name {
	case "log_command":
		cmd, _ := params.Arguments["command"].(string)
		status, _ := params.Arguments["status"].(string)
		summary, _ := params.Arguments["summary"].(string)
		solution, _ := params.Arguments["solution"].(string)
		workdir, _ := params.Arguments["workdir"].(string)

		if cmd == "" || status == "" || summary == "" {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: "Error: command, status, and summary are required fields"}},
				IsError: true,
			}
		}

		var tags []string
		if rawTags, ok := params.Arguments["tags"].([]interface{}); ok {
			for _, rt := range rawTags {
				if s, ok := rt.(string); ok {
					tags = append(tags, s)
				}
			}
		}

		var exitCodePtr *int
		if ec, ok := params.Arguments["exit_code"].(float64); ok {
			val := int(ec)
			exitCodePtr = &val
		}

		entry := CommandEntry{
			Command:  cmd,
			Status:   status,
			Summary:  summary,
			Solution: solution,
			Tags:     tags,
			WorkDir:  workdir,
			ExitCode: exitCodePtr,
		}

		saved, created := ledger.AddOrUpdate(entry)
		action := "logged"
		if !created {
			action = "updated"
		}

		msg := fmt.Sprintf("Successfully %s command '%s' [status: %s]\nSolution: %s",
			action, saved.Command, saved.Status, saved.Solution)
		return CallToolResult{Content: []TextContent{{Type: "text", Text: msg}}}

	case "check_command":
		query, _ := params.Arguments["query"].(string)
		tag, _ := params.Arguments["tag"].(string)

		matches := ledger.Search(query, tag)
		if len(matches) == 0 {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: fmt.Sprintf("No logged history found for query '%s'. It looks safe or untested.", query)}},
			}
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Found %d command ledger entries for '%s':\n\n", len(matches), query))
		for _, m := range matches {
			icon := "✅"
			if m.Status == "failed" {
				icon = "❌"
			} else if m.Status == "hung" {
				icon = "⏳"
			} else if m.Status == "caution" {
				icon = "⚠️"
			}
			sb.WriteString(fmt.Sprintf("%s Command: %s\n", icon, m.Command))
			sb.WriteString(fmt.Sprintf("   Status: %s\n", m.Status))
			sb.WriteString(fmt.Sprintf("   Summary: %s\n", m.Summary))
			if m.Solution != "" {
				sb.WriteString(fmt.Sprintf("   👉 Solution/Alternative: %s\n", m.Solution))
			}
			if len(m.Tags) > 0 {
				sb.WriteString(fmt.Sprintf("   Tags: [%s]\n", strings.Join(m.Tags, ", ")))
			}
			sb.WriteString("\n")
		}

		return CallToolResult{Content: []TextContent{{Type: "text", Text: sb.String()}}}

	case "list_gotchas":
		limit := 20
		if rawLimit, ok := params.Arguments["limit"].(float64); ok && rawLimit > 0 {
			limit = int(rawLimit)
		}

		gotchas := ledger.Gotchas(limit)
		if len(gotchas) == 0 {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: "No gotchas/failed commands currently recorded!"}},
			}
		}

		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("Recorded Pitfalls & Gotchas (%d items):\n\n", len(gotchas)))
		for i, g := range gotchas {
			sb.WriteString(fmt.Sprintf("%d. ❌ `%s`\n", i+1, g.Command))
			sb.WriteString(fmt.Sprintf("   Why: %s\n", g.Summary))
			if g.Solution != "" {
				sb.WriteString(fmt.Sprintf("   Fix: **%s**\n", g.Solution))
			}
			sb.WriteString("\n")
		}

		return CallToolResult{Content: []TextContent{{Type: "text", Text: sb.String()}}}

	case "export_runbook":
		path, _ := params.Arguments["file_path"].(string)
		if path == "" {
			path = defaultRunbookFile
		}

		if err := ledger.ExportMarkdown(path); err != nil {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Failed to export runbook: %v", err)}},
				IsError: true,
			}
		}
		return CallToolResult{
			Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Successfully exported markdown runbook to %s", path)}},
		}

	default:
		return CallToolResult{
			Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Unknown tool: %s", params.Name)}},
			IsError: true,
		}
	}
}

func runMCPServer(ledger *Ledger) {
	scanner := bufio.NewScanner(os.Stdin)
	writer := bufio.NewWriter(os.Stdout)

	for scanner.Scan() {
		line := scanner.Bytes()
		if len(line) == 0 {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal(line, &req); err != nil {
			sendResponse(writer, JSONRPCResponse{
				JSONRPC: "2.0",
				Error:   &RPCError{Code: -32700, Message: "Parse error"},
			})
			continue
		}

		switch req.Method {
		case "initialize":
			sendResponse(writer, JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"protocolVersion": mcpVersion,
					"serverInfo": map[string]interface{}{
						"name":    "command-ledger-mcp",
						"version": "1.0.0",
					},
					"capabilities": map[string]interface{}{
						"tools": map[string]interface{}{},
					},
				},
			})

		case "notifications/initialized":
			// No reply needed for initialized notification

		case "tools/list":
			sendResponse(writer, JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result: map[string]interface{}{
					"tools": getTools(),
				},
			})

		case "tools/call":
			var params CallToolParams
			if err := json.Unmarshal(req.Params, &params); err != nil {
				sendResponse(writer, JSONRPCResponse{
					JSONRPC: "2.0",
					ID:      req.ID,
					Error:   &RPCError{Code: -32602, Message: "Invalid params"},
				})
				continue
			}

			result := handleCallTool(ledger, params)
			sendResponse(writer, JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Result:  result,
			})

		default:
			sendResponse(writer, JSONRPCResponse{
				JSONRPC: "2.0",
				ID:      req.ID,
				Error:   &RPCError{Code: -32601, Message: fmt.Sprintf("Method not found: %s", req.Method)},
			})
		}
	}
}

func sendResponse(w *bufio.Writer, resp JSONRPCResponse) {
	data, _ := json.Marshal(resp)
	_, _ = w.Write(data)
	_, _ = w.WriteString("\n")
	_ = w.Flush()
}

// -----------------------------------------------------------------------------
// CLI Subcommands
// -----------------------------------------------------------------------------

func runCLI(ledger *Ledger, args []string) {
	if len(args) == 0 {
		printCLIHelp()
		return
	}

	cmd := args[0]
	switch cmd {
	case "check":
		if len(args) < 2 {
			fmt.Println("Usage: cmdlog check <query>")
			return
		}
		query := strings.Join(args[1:], " ")
		res := handleCallTool(ledger, CallToolParams{
			Name:      "check_command",
			Arguments: map[string]interface{}{"query": query},
		})
		fmt.Println(res.Content[0].Text)

	case "gotchas":
		res := handleCallTool(ledger, CallToolParams{
			Name:      "list_gotchas",
			Arguments: map[string]interface{}{"limit": 50.0},
		})
		fmt.Println(res.Content[0].Text)

	case "log":
		logFlags := flag.NewFlagSet("log", flag.ExitOnError)
		cmdFlag := logFlags.String("cmd", "", "Command executed")
		statusFlag := logFlags.String("status", "works", "Status: works | failed | hung | caution")
		summaryFlag := logFlags.String("summary", "", "Explanation / error description")
		fixFlag := logFlags.String("fix", "", "Solution or alternative")
		tagsFlag := logFlags.String("tags", "", "Comma-separated tags")

		_ = logFlags.Parse(args[1:])
		if *cmdFlag == "" || *summaryFlag == "" {
			fmt.Println("Error: --cmd and --summary are required")
			logFlags.Usage()
			return
		}

		var tags []string
		if *tagsFlag != "" {
			for _, t := range strings.Split(*tagsFlag, ",") {
				tags = append(tags, strings.TrimSpace(t))
			}
		}

		res := handleCallTool(ledger, CallToolParams{
			Name: "log_command",
			Arguments: map[string]interface{}{
				"command":  *cmdFlag,
				"status":   *statusFlag,
				"summary":  *summaryFlag,
				"solution": *fixFlag,
				"tags":     convertStringSlice(tags),
			},
		})
		fmt.Println(res.Content[0].Text)

	case "export":
		target := defaultRunbookFile
		if len(args) > 1 {
			target = args[1]
		}
		res := handleCallTool(ledger, CallToolParams{
			Name:      "export_runbook",
			Arguments: map[string]interface{}{"file_path": target},
		})
		fmt.Println(res.Content[0].Text)

	default:
		printCLIHelp()
	}
}

func convertStringSlice(slice []string) []interface{} {
	var res []interface{}
	for _, s := range slice {
		res = append(res, s)
	}
	return res
}

func printCLIHelp() {
	fmt.Println("Command Ledger MCP & CLI Tool")
	fmt.Println("\nCommands:")
	fmt.Println("  cmdlog check <query>              Search past command history & known pitfalls")
	fmt.Println("  cmdlog gotchas                    List all failed/hung commands and their fixes")
	fmt.Println("  cmdlog log --cmd <c> --status <s> Log a command result (--status: works|failed|hung|caution)")
	fmt.Println("             --summary <sum> --fix <f>")
	fmt.Println("  cmdlog export [filepath]          Generate Markdown runbook (default: COMMAND_RUNBOOK.md)")
	fmt.Println("  cmdlog --mcp                      Run as standard MCP JSON-RPC server over stdio")
}

func main() {
	mcpMode := flag.Bool("mcp", false, "Run in MCP JSON-RPC stdio mode")
	storagePath := flag.String("storage", getLedgerPath(), "Path to command ledger storage JSON")
	flag.Parse()

	ledger, err := newLedger(*storagePath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Error initializing ledger: %v\n", err)
		os.Exit(1)
	}

	fi, _ := os.Stdin.Stat()
	isPiped := (fi.Mode() & os.ModeCharDevice) == 0

	if *mcpMode || isPiped {
		runMCPServer(ledger)
		return
	}

	remaining := flag.Args()
	runCLI(ledger, remaining)
}

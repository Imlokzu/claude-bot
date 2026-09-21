package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLedgerLifecycle(t *testing.T) {
	tmpDir := t.TempDir()
	ledgerPath := filepath.Join(tmpDir, "test_ledger.json")

	ledger, err := newLedger(ledgerPath)
	if err != nil {
		t.Fatalf("Failed to initialize ledger: %v", err)
	}

	// Should have default seed entries
	if len(ledger.Entries) == 0 {
		t.Errorf("Expected seed entries, got 0")
	}

	// Add a new command
	testCmd := CommandEntry{
		Command:  "echo 'hello world'",
		Status:   "works",
		Summary:  "Standard test echo command",
		Solution: "",
		Tags:     []string{"shell", "test"},
	}

	saved, created := ledger.AddOrUpdate(testCmd)
	if !created {
		t.Errorf("Expected command to be created as new")
	}
	if saved.Command != testCmd.Command {
		t.Errorf("Expected command %s, got %s", testCmd.Command, saved.Command)
	}

	// Search for it
	matches := ledger.Search("hello", "")
	if len(matches) != 1 {
		t.Fatalf("Expected 1 match, got %d", len(matches))
	}
	if matches[0].Command != testCmd.Command {
		t.Errorf("Expected %s, got %s", testCmd.Command, matches[0].Command)
	}

	// Check Gotchas
	gotchas := ledger.Gotchas(10)
	if len(gotchas) == 0 {
		t.Errorf("Expected at least 1 seed gotcha")
	}

	// Export Markdown
	runbookPath := filepath.Join(tmpDir, "RUNBOOK.md")
	if err := ledger.ExportMarkdown(runbookPath); err != nil {
		t.Fatalf("Failed to export markdown: %v", err)
	}

	data, err := os.ReadFile(runbookPath)
	if err != nil || len(data) == 0 {
		t.Fatalf("Expected non-empty markdown file, got error: %v", err)
	}
}

func TestToolHandlers(t *testing.T) {
	tmpDir := t.TempDir()
	ledgerPath := filepath.Join(tmpDir, "test_ledger.json")
	ledger, _ := newLedger(ledgerPath)

	// Call log_command tool
	logParams := CallToolParams{
		Name: "log_command",
		Arguments: map[string]interface{}{
			"command":  "openclaw gateway stop",
			"status":   "works",
			"summary":  "Stops the background LaunchAgent cleanly",
			"solution": "Use openclaw gateway restart instead if you just need reload",
			"tags":     []interface{}{"openclaw", "service"},
		},
	}
	res := handleCallTool(ledger, logParams)
	if res.IsError {
		t.Fatalf("Expected success, got error: %s", res.Content[0].Text)
	}

	// Call check_command tool
	checkParams := CallToolParams{
		Name:      "check_command",
		Arguments: map[string]interface{}{"query": "gateway stop"},
	}
	res = handleCallTool(ledger, checkParams)
	if res.IsError || len(res.Content) == 0 {
		t.Fatalf("Expected search results")
	}

	// Call list_gotchas
	gotchaParams := CallToolParams{
		Name:      "list_gotchas",
		Arguments: map[string]interface{}{"limit": 5.0},
	}
	res = handleCallTool(ledger, gotchaParams)
	if res.IsError {
		t.Fatalf("Expected gotchas list")
	}
}

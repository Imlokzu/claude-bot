package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"strings"
	"time"
)

const (
	defaultGatewayURL = "https://send.waveio.me"
	defaultAgentEmail = "lokzu@ag.waveio.me"
	mcpVersion        = "2024-11-05"
)

type Config struct {
	GatewayURL string
	AgentToken string
	AgentEmail string
}

func loadConfig() Config {
	gw := os.Getenv("AGENT_GATEWAY_URL")
	if gw == "" {
		gw = defaultGatewayURL
	}
	// No default token: one compiled into the binary is published with the
	// source. Without AGENT_TOKEN the gateway answers 401, which says why.
	tok := os.Getenv("AGENT_TOKEN")
	email := os.Getenv("AGENT_EMAIL")
	if email == "" {
		email = defaultAgentEmail
	}
	return Config{
		GatewayURL: strings.TrimRight(gw, "/"),
		AgentToken: tok,
		AgentEmail: email,
	}
}

// JSON-RPC 2.0 structures
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

// Tool definitions for MCP
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
			Name: "send_email",
			Description: "Send an email message from the agent's verified address (lokzu@ag.waveio.me) " +
				"to any external recipient through the secure waveio gateway without leaking provider credentials.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"to": map[string]interface{}{
						"type":        "string",
						"description": "Recipient email address, e.g. user@example.com",
					},
					"subject": map[string]interface{}{
						"type":        "string",
						"description": "Subject of the email",
					},
					"body": map[string]interface{}{
						"type":        "string",
						"description": "Body of the message (plain text or markdown format)",
					},
					"sender_name": map[string]interface{}{
						"type":        "string",
						"description": "Optional display name for the sender, e.g. 'Lokzu Agent'",
					},
				},
				"required": []string{"to", "subject", "body"},
			},
		},
		{
			Name: "check_inbox",
			Description: "Check incoming emails received in the agent's mailbox (lokzu@ag.waveio.me). " +
				"Returns message summaries, senders, subjects, and extracted verification codes.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"limit": map[string]interface{}{
						"type":        "integer",
						"description": "Maximum number of recent emails to retrieve (default: 10)",
					},
				},
			},
		},
		{
			Name: "get_verification_code",
			Description: "Retrieve the latest OTP or confirmation code received in the agent's mailbox. " +
				"Useful when signing up or logging into websites.",
			InputSchema: map[string]interface{}{
				"type": "object",
				"properties": map[string]interface{}{
					"service": map[string]interface{}{
						"type":        "string",
						"description": "Optional service name to filter by, e.g. 'github' or 'openai'",
					},
				},
			},
		},
		{
			Name:        "my_email",
			Description: "Get the current agent's designated email address and gateway configuration.",
			InputSchema: map[string]interface{}{
				"type":       "object",
				"properties": map[string]interface{}{},
			},
		},
	}
}

func handleSendEmail(cfg Config, args map[string]interface{}) CallToolResult {
	to, _ := args["to"].(string)
	subject, _ := args["subject"].(string)
	body, _ := args["body"].(string)
	senderName, _ := args["sender_name"].(string)
	if senderName == "" {
		senderName = "Lokzu (AI Agent)"
	}

	if to == "" || subject == "" || body == "" {
		return CallToolResult{
			Content: []TextContent{{Type: "text", Text: "Error: 'to', 'subject', and 'body' are required arguments"}},
			IsError: true,
		}
	}

	payload := map[string]interface{}{
		"to":          to,
		"subject":     subject,
		"body":        body,
		"sender_name": senderName,
		"from_agent":  cfg.AgentEmail,
	}

	jsonBytes, err := json.Marshal(payload)
	if err != nil {
		return CallToolResult{
			Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Failed to marshal request: %v", err)}},
			IsError: true,
		}
	}

	// Try send.waveio.me first, fallback to mail.waveio.me if needed
	gateways := []string{cfg.GatewayURL, "https://mail.waveio.me"}
	var lastErr error
	var respBytes []byte

	client := &http.Client{Timeout: 15 * time.Second}

	for _, gw := range gateways {
		reqURL := fmt.Sprintf("%s/api/send", gw)
		req, err := http.NewRequest("POST", reqURL, bytes.NewBuffer(jsonBytes))
		if err != nil {
			lastErr = err
			continue
		}

		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+cfg.AgentToken)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		respBytes, err = io.ReadAll(resp.Body)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode == http.StatusOK {
			return CallToolResult{
				Content: []TextContent{{
					Type: "text",
					Text: fmt.Sprintf("Email successfully sent via gateway!\nRecipient: %s\nSubject: %s\nGateway response: %s", to, subject, string(respBytes)),
				}},
			}
		}

		lastErr = fmt.Errorf("gateway returned status %d: %s", resp.StatusCode, string(respBytes))
	}

	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Failed to send email: %v", lastErr)}},
		IsError: true,
	}
}

func handleCheckInbox(cfg Config, args map[string]interface{}) CallToolResult {
	// Query inbox from gateway
	gateways := []string{cfg.GatewayURL, "https://mail.waveio.me"}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastErr error

	for _, gw := range gateways {
		reqURL := fmt.Sprintf("%s/api/inbox?to=%s", gw, cfg.AgentEmail)
		req, err := http.NewRequest("GET", reqURL, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Authorization", "Bearer "+cfg.AgentToken)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode == http.StatusOK {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: string(body)}},
			}
		}
		lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Failed to check inbox: %v", lastErr)}},
		IsError: true,
	}
}

func handleGetVerificationCode(cfg Config, args map[string]interface{}) CallToolResult {
	gateways := []string{cfg.GatewayURL, "https://mail.waveio.me"}
	client := &http.Client{Timeout: 10 * time.Second}
	var lastErr error

	for _, gw := range gateways {
		reqURL := fmt.Sprintf("%s/api/latest-otp?to=%s", gw, cfg.AgentEmail)
		req, err := http.NewRequest("GET", reqURL, nil)
		if err != nil {
			lastErr = err
			continue
		}
		req.Header.Set("Authorization", "Bearer "+cfg.AgentToken)

		resp, err := client.Do(req)
		if err != nil {
			lastErr = err
			continue
		}
		defer resp.Body.Close()

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			lastErr = err
			continue
		}

		if resp.StatusCode == http.StatusOK {
			return CallToolResult{
				Content: []TextContent{{Type: "text", Text: string(body)}},
			}
		}
		lastErr = fmt.Errorf("status %d: %s", resp.StatusCode, string(body))
	}

	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Failed to get verification code: %v", lastErr)}},
		IsError: true,
	}
}

func handleMyEmail(cfg Config) CallToolResult {
	info := map[string]string{
		"email":       cfg.AgentEmail,
		"domain":      "ag.waveio.me",
		"gateway_url": cfg.GatewayURL,
		"status":      "active",
		"description": "Inbound handled by Cloudflare Email Routing; Outbound dispatched securely via send.waveio.me",
	}
	b, _ := json.MarshalIndent(info, "", "  ")
	return CallToolResult{
		Content: []TextContent{{Type: "text", Text: string(b)}},
	}
}

func main() {
	cfg := loadConfig()
	scanner := bufio.NewScanner(os.Stdin)

	// MCP JSON-RPC Server over STDIN/STDOUT
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}

		var req JSONRPCRequest
		if err := json.Unmarshal([]byte(line), &req); err != nil {
			sendError(nil, -32700, "Parse error")
			continue
		}

		switch req.Method {
		case "initialize":
			sendResult(req.ID, map[string]interface{}{
				"protocolVersion": mcpVersion,
				"capabilities": map[string]interface{}{
					"tools": map[string]interface{}{},
				},
				"serverInfo": map[string]interface{}{
					"name":    "agent-mail-mcp",
					"version": "1.0.0",
				},
			})

		case "notifications/initialized":
			// Client acknowledged initialization

		case "ping":
			sendResult(req.ID, map[string]interface{}{})

		case "tools/list":
			sendResult(req.ID, map[string]interface{}{
				"tools": getTools(),
			})

		case "tools/call":
			var params CallToolParams
			if err := json.Unmarshal(req.Params, &params); err != nil {
				sendError(req.ID, -32602, "Invalid params")
				continue
			}

			var result CallToolResult
			switch params.Name {
			case "send_email":
				result = handleSendEmail(cfg, params.Arguments)
			case "check_inbox":
				result = handleCheckInbox(cfg, params.Arguments)
			case "get_verification_code":
				result = handleGetVerificationCode(cfg, params.Arguments)
			case "my_email":
				result = handleMyEmail(cfg)
			default:
				result = CallToolResult{
					Content: []TextContent{{Type: "text", Text: fmt.Sprintf("Unknown tool: %s", params.Name)}},
					IsError: true,
				}
			}

			sendResult(req.ID, result)

		default:
			if req.ID != nil {
				sendError(req.ID, -32601, fmt.Sprintf("Method not found: %s", req.Method))
			}
		}
	}
}

func sendResult(id interface{}, result interface{}) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Result:  result,
	}
	b, _ := json.Marshal(resp)
	fmt.Println(string(b))
}

func sendError(id interface{}, code int, message string) {
	resp := JSONRPCResponse{
		JSONRPC: "2.0",
		ID:      id,
		Error: &RPCError{
			Code:    code,
			Message: message,
		},
	}
	b, _ := json.Marshal(resp)
	fmt.Println(string(b))
}

// Command claude-bot-launcher starts only the Claude Bot services a user picks.
//
// It replaces launcher.py with a single standard-library binary. The launcher
// used to run inside a module's virtual environment, so a moved repository or a
// vanished Xcode Python took the launcher down together with the services it
// was supposed to diagnose. A static binary keeps working and can still report
// "missing environment" clearly.
//
// Ground rules carried over unchanged: install nothing, keep no resident
// daemon, reuse healthy services, and never stop a process this launch did not
// start itself.
package main

import (
	"bufio"
	_ "embed"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"
)

//go:embed locales.json
var localesJSON []byte

// The Windows picker ships inside the binary so it cannot drift away from it.
//
//go:embed picker.ps1
var pickerScript string

var locales = mustLoadLocales()

var lang = "uk"

// root is the repository root; every service folder and log path hangs off it.
var root string

var actions = []string{"web", "screen", "openclaw", "vision", "display", "pair"}

type service struct {
	folder     string
	port       int
	healthPath string
	args       []string
}

var services = map[string]service{
	"web":      {"Virtual Bot", 8100, "/dash/", []string{"-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8100", "--timeout-graceful-shutdown", "3"}},
	"vision":   {"Vision Agent", 8000, "/health", []string{"-m", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", "8000"}},
	"display":  {"claude-bot-display", 8001, "/health", []string{"-m", "backend.server", "--host", "127.0.0.1", "--port", "8001"}},
	"openclaw": {".", 18789, "/health", []string{"gateway", "run", "--bind", "loopback", "--port", "18789"}},
}

var actionURLs = map[string]string{
	"web":      "http://127.0.0.1:8100/dash/#/chat",
	"pair":     "http://127.0.0.1:8100/dash/#/chat",
	"screen":   "http://127.0.0.1:8100/screen",
	"openclaw": "http://127.0.0.1:18789/",
	"vision":   "http://127.0.0.1:8000/vision/stream.mjpg",
	"display":  "http://127.0.0.1:8001/docs",
}

// Seams replaced by tests. Production code only ever uses the defaults.
var (
	goos           = runtime.GOOS
	environ        = os.Environ
	lookPath       = exec.LookPath
	now            = time.Now
	sleep          = time.Sleep
	startupTimeout = 30 * time.Second
	healthy        = defaultHealthy
	portInUse      = defaultPortInUse
	proxyReachable = defaultProxyReachable
	commandFor     = defaultCommandFor
	spawn          = defaultSpawn
	stopLaunched   = stopTree
	startService   = defaultStartService
	openURL        = defaultOpenURL
	runOutput      = defaultRunOutput
)

func mustLoadLocales() map[string]map[string]string {
	var parsed map[string]map[string]string
	if err := json.Unmarshal(localesJSON, &parsed); err != nil {
		panic("launcher: bad embedded locales.json: " + err.Error())
	}
	return parsed
}

// t looks up a localized string and fills its {name} placeholders from
// alternating key/value arguments, matching str.format in the old launcher.
func t(key string, pairs ...any) string {
	text := locales[lang][key]
	for i := 0; i+1 < len(pairs); i += 2 {
		text = strings.ReplaceAll(text, "{"+fmt.Sprint(pairs[i])+"}", fmt.Sprint(pairs[i+1]))
	}
	return text
}

func isFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}

// findRoot locates the repository. The binary normally sits in launcher/build,
// but `go run` puts it in a temp dir, so the working directory is a fallback.
func findRoot(override string) (string, error) {
	if override != "" {
		return filepath.Abs(override)
	}
	var starts []string
	if exe, err := os.Executable(); err == nil {
		if resolved, err := filepath.EvalSymlinks(exe); err == nil {
			exe = resolved
		}
		starts = append(starts, filepath.Dir(exe))
	}
	if wd, err := os.Getwd(); err == nil {
		starts = append(starts, wd)
	}
	for _, dir := range starts {
		for {
			if isFile(filepath.Join(dir, "launcher", "go.mod")) {
				return dir, nil
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return "", errors.New(t("missing_repo"))
}

func logsDir() string {
	return filepath.Join(root, "Virtual Bot", "service_logs")
}

func pythonFor(directory string, windows bool) string {
	if windows {
		return filepath.Join(directory, ".venv", "Scripts", "python.exe")
	}
	return filepath.Join(directory, ".venv", "bin", "python")
}

func defaultCommandFor(name string) ([]string, string, error) {
	svc := services[name]
	directory := filepath.Join(root, svc.folder)
	var executable string
	if name == "openclaw" {
		found, err := lookPath("openclaw")
		if err != nil {
			return nil, "", errors.New(t("missing_openclaw"))
		}
		executable = found
	} else {
		executable = pythonFor(directory, goos == "windows")
		if !isFile(executable) {
			return nil, "", errors.New(t("missing_python", "path", executable))
		}
	}
	return append([]string{executable}, svc.args...), directory, nil
}

func defaultHealthy(name string) bool {
	svc := services[name]
	// Local probes must not go through an ambient HTTP proxy.
	client := &http.Client{Timeout: time.Second, Transport: &http.Transport{Proxy: nil}}
	response, err := client.Get(fmt.Sprintf("http://127.0.0.1:%d%s", svc.port, svc.healthPath))
	if err != nil {
		return false
	}
	defer response.Body.Close()
	return response.StatusCode == http.StatusOK
}

func defaultPortInUse(port int) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort("127.0.0.1", strconv.Itoa(port)), time.Second)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// defaultProxyReachable reports whether a loopback proxy inherited from the
// desktop is alive. Remote proxies are assumed fine: probing them would slow
// every launch and a dead one fails loudly in the service anyway.
func defaultProxyReachable(value string) bool {
	parsed, err := url.Parse(value)
	if err != nil {
		return false
	}
	host, port := parsed.Hostname(), parsed.Port()
	if (host != "127.0.0.1" && host != "localhost" && host != "::1") || port == "" {
		return true
	}
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(host, port), 300*time.Millisecond)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

// serviceEnvironment copies the GUI environment, dropping dead local proxies
// only. A reachable or remote proxy is still needed for model/API traffic, and
// checking every casing variant avoids leaving a stale lowercase copy behind.
func serviceEnvironment(name string) []string {
	var environment []string
	hasClerk := false
	for _, entry := range environ() {
		key, value, _ := strings.Cut(entry, "=")
		if strings.HasSuffix(strings.ToLower(key), "_proxy") && !proxyReachable(value) {
			continue
		}
		if key == "CLERK_DISABLED" {
			hasClerk = true
		}
		environment = append(environment, entry)
	}
	// The launcher serves the dashboard only on loopback. Requiring a second
	// cloud login there blocks local tools even though the user already
	// authenticated to OpenClaw. An explicit value still wins, so a developer
	// can test Clerk locally with CLERK_DISABLED=0.
	if name == "web" && !hasClerk {
		environment = append(environment, "CLERK_DISABLED=1")
	}
	return environment
}

// launched is a process started by this launch. Only these are ever stopped.
type launched struct {
	pid     int
	process *os.Process
	done    chan struct{} // closed once the process has been reaped
}

func (l *launched) exited() bool {
	select {
	case <-l.done:
		return true
	default:
		return false
	}
}

func (l *launched) wait(timeout time.Duration) bool {
	select {
	case <-l.done:
		return true
	case <-time.After(timeout):
		return false
	}
}

func defaultSpawn(command []string, dir string, env []string, log *os.File) (*launched, error) {
	cmd := exec.Command(command[0], command[1:]...)
	cmd.Dir = dir
	cmd.Env = env
	cmd.Stdout = log
	cmd.Stderr = log
	cmd.SysProcAttr = detachedAttrs()
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	proc := &launched{pid: cmd.Process.Pid, process: cmd.Process, done: make(chan struct{})}
	go func() {
		_ = cmd.Wait()
		close(proc.done)
	}()
	return proc, nil
}

func defaultStartService(name string) error {
	if err := os.MkdirAll(logsDir(), 0o755); err != nil {
		return err
	}
	release, err := acquireLock(filepath.Join(logsDir(), "launcher-"+name+".lock"))
	if err != nil {
		return err
	}
	defer release()

	if healthy(name) {
		return nil
	}
	svc := services[name]
	if portInUse(svc.port) {
		return errors.New(t("port_busy", "port", svc.port))
	}
	command, directory, err := commandFor(name)
	if err != nil {
		return err
	}
	logPath := filepath.Join(logsDir(), "launcher-"+name+".log")
	log, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	proc, err := spawn(command, directory, serviceEnvironment(name), log)
	// The child holds its own descriptor; ours is no longer needed.
	log.Close()
	if err != nil {
		return err
	}

	deadline := now().Add(startupTimeout)
	for now().Before(deadline) {
		// Health first: a wrapper such as npm's shim may exit after handing off.
		if healthy(name) {
			return nil
		}
		if proc.exited() {
			break
		}
		sleep(300 * time.Millisecond)
	}
	// Never leave an unknown pending launch behind or kill an existing service.
	if err := stopLaunched(proc); err != nil {
		return err
	}
	return errors.New(t("failed", "log", logPath))
}

func launch(action string) error {
	target, ok := actionURLs[action]
	if !ok {
		return fmt.Errorf("unknown action %q", action)
	}
	var names []string
	switch action {
	case "pair":
		names = []string{"openclaw", "web"}
	case "screen":
		names = []string{"web"}
	default:
		names = []string{action}
	}
	for _, name := range names {
		if err := startService(name); err != nil {
			return err
		}
	}
	return openURL(target)
}

// defaultOpenURL opens a browser without keeping a GUI helper's pipes alive.
func defaultOpenURL(target string) error {
	var cmd *exec.Cmd
	switch goos {
	case "darwin":
		cmd = exec.Command("open", target)
	case "windows":
		// rundll32 avoids cmd.exe, which would treat & in a URL as a separator.
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", target)
	default:
		cmd = exec.Command("xdg-open", target)
	}
	cmd.SysProcAttr = detachedAttrs()
	if err := cmd.Start(); err != nil {
		return err
	}
	return cmd.Process.Release()
}

// defaultRunOutput runs a picker and returns its exit code and output. A
// non-zero exit is not an error here: pickers use it to signal "cancel".
func defaultRunOutput(name string, args []string, stdin string) (int, string, string, error) {
	cmd := exec.Command(name, args...)
	cmd.Stdin = strings.NewReader(stdin)
	var stdout, stderr strings.Builder
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	err := cmd.Run()
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode(), stdout.String(), stderr.String(), nil
	}
	return 0, stdout.String(), stderr.String(), err
}

func appleScriptString(value string) string {
	return `"` + strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(value) + `"`
}

func validAction(value string) bool {
	for _, action := range actions {
		if action == value {
			return true
		}
	}
	return false
}

// choose asks which action to run; "" means the user cancelled.
func choose(in io.Reader, out io.Writer) (string, error) {
	labels := make([]string, len(actions))
	for i, action := range actions {
		labels[i] = t(action)
	}
	switch {
	case goos == "darwin":
		quoted := make([]string, len(labels))
		for i, label := range labels {
			quoted[i] = appleScriptString(label)
		}
		script := fmt.Sprintf("choose from list {%s} with title %s with prompt %s OK button name %s cancel button name %s",
			strings.Join(quoted, ", "), appleScriptString(t("title")), appleScriptString(t("choose")),
			appleScriptString(t("launch")), appleScriptString(t("cancel")))
		code, stdout, stderr, err := runOutput("osascript", []string{"-e", script}, "")
		if err != nil {
			return "", err
		}
		if code != 0 {
			return "", errors.New(strings.TrimSpace(stderr))
		}
		selected := strings.TrimSpace(stdout)
		for i, label := range labels {
			if label == selected {
				return actions[i], nil
			}
		}
		return "", nil // osascript prints "false" on cancel

	case goos == "windows":
		type item struct {
			ID    string `json:"id"`
			Label string `json:"label"`
		}
		items := make([]item, len(actions))
		for i, action := range actions {
			items[i] = item{action, labels[i]}
		}
		payload, _ := json.Marshal(map[string]any{"title": t("title"), "items": items})
		script, err := os.CreateTemp("", "claude-bot-picker-*.ps1")
		if err != nil {
			return "", err
		}
		defer os.Remove(script.Name())
		if _, err := script.WriteString(pickerScript); err != nil {
			script.Close()
			return "", err
		}
		script.Close()
		// -File keeps the machine's execution policy in charge; the launcher
		// never changes or bypasses it. The CLI flag is the documented fallback.
		code, stdout, stderr, err := runOutput("powershell.exe",
			[]string{"-NoProfile", "-STA", "-File", script.Name()}, string(payload))
		if err != nil {
			return "", err
		}
		if code != 0 {
			return "", errors.New(strings.TrimSpace(stderr))
		}
		if selected := strings.TrimSpace(stdout); validAction(selected) {
			return selected, nil
		}
		return "", nil
	}

	if _, err := lookPath("zenity"); err == nil {
		args := []string{"--list", "--title", t("title"), "--text", t("choose"),
			"--column", "id", "--column", t("launch"), "--hide-column", "1", "--print-column", "1"}
		for i, action := range actions {
			args = append(args, action, labels[i])
		}
		code, stdout, stderr, err := runOutput("zenity", args, "")
		if err != nil {
			return "", err
		}
		// Zenity exits 1 on cancel; anything else is a real picker failure.
		if code != 0 && code != 1 {
			return "", errors.New(strings.TrimSpace(stderr))
		}
		if selected := strings.TrimSpace(stdout); validAction(selected) {
			return selected, nil
		}
		return "", nil
	}

	fmt.Fprintln(out, t("title"))
	for i, label := range labels {
		fmt.Fprintf(out, "%d. %s\n", i+1, label)
	}
	fmt.Fprint(out, t("terminal"))
	line, err := bufio.NewReader(in).ReadString('\n')
	if err != nil && (err != io.EOF || line == "") {
		return "", err
	}
	index, convErr := strconv.Atoi(strings.TrimSpace(line))
	if convErr != nil || index < 1 || index > len(actions) {
		return "", nil
	}
	return actions[index-1], nil
}

func run(args []string, stdin io.Reader, stdout, stderr io.Writer) int {
	flags := flag.NewFlagSet("claude-bot-launcher", flag.ContinueOnError)
	flags.SetOutput(stderr)
	start := flags.String("start", "", "service to start: "+strings.Join(actions, ", "))
	language := flags.String("lang", "uk", "interface language: uk or en")
	repo := flags.String("repo", "", "repository root (default: found from the binary or working directory)")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if _, ok := locales[*language]; !ok {
		fmt.Fprintf(stderr, "invalid --lang %q\n", *language)
		return 2
	}
	if *start != "" && !validAction(*start) {
		fmt.Fprintf(stderr, "invalid --start %q (choose from %s)\n", *start, strings.Join(actions, ", "))
		return 2
	}
	lang = *language

	var err error
	if root, err = findRoot(*repo); err == nil {
		action := *start
		if action == "" {
			action, err = choose(stdin, stdout)
		}
		if err == nil && action != "" {
			if err = launch(action); err == nil {
				fmt.Fprintln(stdout, t("ready", "name", t(action)))
			}
		}
	}
	if err != nil {
		fmt.Fprintln(stderr, t("error", "message", err))
		return 1
	}
	return 0
}

func main() {
	os.Exit(run(os.Args[1:], os.Stdin, os.Stdout, os.Stderr))
}

package main

import (
	"errors"
	"fmt"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// When re-executed with this variable set, the test binary pretends to be a
// service: it serves /health on the given port until killed. This exercises
// real spawning, detaching and health polling without touching ports 8100 etc.
const fakeServiceEnv = "LAUNCHER_FAKE_SERVICE_PORT"

func TestMain(m *testing.M) {
	if port := os.Getenv(fakeServiceEnv); port != "" {
		if port == "exit" {
			fmt.Println("fake service failed on purpose")
			os.Exit(3)
		}
		http.HandleFunc("/health", func(w http.ResponseWriter, _ *http.Request) { w.WriteHeader(http.StatusOK) })
		fmt.Println(http.ListenAndServe("127.0.0.1:"+port, nil))
		os.Exit(1)
	}
	os.Exit(m.Run())
}

func swap[T any](t *testing.T, target *T, value T) {
	t.Helper()
	old := *target
	*target = value
	t.Cleanup(func() { *target = old })
}

func isolate(t *testing.T) {
	swap(t, &root, t.TempDir())
	swap(t, &lang, "uk")
}

func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}

func TestOnlySelectedServicesStart(t *testing.T) {
	cases := map[string][]string{
		"web": {"web"}, "screen": {"web"}, "openclaw": {"openclaw"},
		"vision": {"vision"}, "display": {"display"}, "pair": {"openclaw", "web"},
	}
	for action, want := range cases {
		t.Run(action, func(t *testing.T) {
			var started, opened []string
			swap(t, &startService, func(name string) error { started = append(started, name); return nil })
			swap(t, &openURL, func(u string) error { opened = append(opened, u); return nil })
			if err := launch(action); err != nil {
				t.Fatal(err)
			}
			if strings.Join(started, ",") != strings.Join(want, ",") {
				t.Fatalf("started %v, want %v", started, want)
			}
			if len(opened) != 1 || !strings.HasPrefix(opened[0], "http://127.0.0.1:") {
				t.Fatalf("opened %v", opened)
			}
		})
	}
}

func TestUnknownActionNeverStarts(t *testing.T) {
	swap(t, &startService, func(string) error { t.Fatal("started a service"); return nil })
	if err := launch("shell; bad command"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestFailedServiceDoesNotOpenBrowser(t *testing.T) {
	swap(t, &startService, func(string) error { return errors.New("boom") })
	swap(t, &openURL, func(string) error { t.Fatal("opened a browser"); return nil })
	if err := launch("web"); err == nil {
		t.Fatal("expected an error")
	}
}

func TestHealthyServiceDoesNotSpawnDuplicate(t *testing.T) {
	isolate(t)
	swap(t, &healthy, func(string) bool { return true })
	swap(t, &spawn, func([]string, string, []string, *os.File) (*launched, error) {
		t.Fatal("spawned a duplicate")
		return nil, nil
	})
	if err := defaultStartService("web"); err != nil {
		t.Fatal(err)
	}
}

func TestOccupiedPortIsNotKilledOrReplaced(t *testing.T) {
	isolate(t)
	swap(t, &healthy, func(string) bool { return false })
	swap(t, &portInUse, func(int) bool { return true })
	swap(t, &spawn, func([]string, string, []string, *os.File) (*launched, error) {
		t.Fatal("spawned over an occupied port")
		return nil, nil
	})
	err := defaultStartService("web")
	if err == nil || !strings.Contains(err.Error(), "8100") {
		t.Fatalf("got %v", err)
	}
}

func TestPythonPathsMatchEachOS(t *testing.T) {
	if got := pythonFor("m", true); got != filepath.Join("m", ".venv", "Scripts", "python.exe") {
		t.Fatal(got)
	}
	if got := pythonFor("m", false); got != filepath.Join("m", ".venv", "bin", "python") {
		t.Fatal(got)
	}
}

func TestMissingEnvironmentDoesNotInstallPackages(t *testing.T) {
	isolate(t)
	_, _, err := defaultCommandFor("web")
	if err == nil || !strings.Contains(err.Error(), ".venv") {
		t.Fatalf("got %v", err)
	}
}

func TestOpenClawUsesExistingConfigWithoutForce(t *testing.T) {
	isolate(t)
	swap(t, &lookPath, func(string) (string, error) { return "/tools/openclaw", nil })
	command, _, err := defaultCommandFor("openclaw")
	if err != nil {
		t.Fatal(err)
	}
	want := "/tools/openclaw gateway run --bind loopback --port 18789"
	if strings.Join(command, " ") != want {
		t.Fatalf("got %v", command)
	}
}

func TestMissingOpenClawIsReported(t *testing.T) {
	isolate(t)
	swap(t, &lookPath, func(string) (string, error) { return "", errors.New("not found") })
	if _, _, err := defaultCommandFor("openclaw"); err == nil || err.Error() != t_("missing_openclaw") {
		t.Fatalf("got %v", err)
	}
}

func t_(key string) string { return t(key) }

func TestLockIsExclusiveAndReleased(t *testing.T) {
	path := filepath.Join(t.TempDir(), "launcher-web.lock")
	release, err := acquireLock(path)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := acquireLock(path); err == nil || err.Error() != t_("busy") {
		t.Fatalf("second lock: %v", err)
	}
	release()
	again, err := acquireLock(path)
	if err != nil {
		t.Fatalf("lock not released: %v", err)
	}
	again()
}

func TestLocaleKeysMatch(t *testing.T) {
	for key := range locales["uk"] {
		if _, ok := locales["en"][key]; !ok {
			t.Errorf("en lacks %q", key)
		}
	}
	for key := range locales["en"] {
		if _, ok := locales["uk"][key]; !ok {
			t.Errorf("uk lacks %q", key)
		}
	}
	for _, action := range actions {
		if locales["en"][action] == "" {
			t.Errorf("no label for action %q", action)
		}
	}
}

func envMap(entries []string) map[string]string {
	result := map[string]string{}
	for _, entry := range entries {
		key, value, _ := strings.Cut(entry, "=")
		result[key] = value
	}
	return result
}

func TestServiceEnvironmentDropsDeadLoopbackProxy(t *testing.T) {
	swap(t, &proxyReachable, func(v string) bool { return !strings.Contains(v, "127.0.0.1") })
	swap(t, &environ, func() []string {
		return []string{"HTTP_PROXY=http://127.0.0.1:9", "http_proxy=http://127.0.0.1:9",
			"HTTPS_PROXY=http://proxy.example:8080", "APP_MODE=test"}
	})
	env := envMap(serviceEnvironment(""))
	if _, ok := env["HTTP_PROXY"]; ok {
		t.Fatal("kept HTTP_PROXY")
	}
	if _, ok := env["http_proxy"]; ok {
		t.Fatal("kept http_proxy")
	}
	if env["HTTPS_PROXY"] != "http://proxy.example:8080" || env["APP_MODE"] != "test" {
		t.Fatalf("got %v", env)
	}
}

func TestServiceEnvironmentKeepsReachableProxy(t *testing.T) {
	swap(t, &proxyReachable, func(string) bool { return true })
	swap(t, &environ, func() []string { return []string{"HTTP_PROXY=http://127.0.0.1:9"} })
	if envMap(serviceEnvironment(""))["HTTP_PROXY"] != "http://127.0.0.1:9" {
		t.Fatal("dropped a reachable proxy")
	}
}

func TestWebLauncherDefaultsToLocalAuth(t *testing.T) {
	swap(t, &environ, func() []string { return nil })
	if envMap(serviceEnvironment("web"))["CLERK_DISABLED"] != "1" {
		t.Fatal("web should default CLERK_DISABLED=1")
	}
	swap(t, &environ, func() []string { return []string{"CLERK_DISABLED=0"} })
	if got := serviceEnvironment("web"); len(got) != 1 || got[0] != "CLERK_DISABLED=0" {
		t.Fatalf("explicit value must win, got %v", got)
	}
	swap(t, &environ, func() []string { return nil })
	if _, ok := envMap(serviceEnvironment("vision"))["CLERK_DISABLED"]; ok {
		t.Fatal("only the dashboard gets the local-auth default")
	}
}

func TestProxyReachableProbesOnlyLoopback(t *testing.T) {
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	live := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	dead := live // closed now, so connecting fails
	listener, err = net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	live = listener.Addr().(*net.TCPAddr).Port

	if !defaultProxyReachable("http://127.0.0.1:" + strconv.Itoa(live)) {
		t.Error("live loopback proxy reported dead")
	}
	if defaultProxyReachable("http://127.0.0.1:" + strconv.Itoa(dead)) {
		t.Error("dead loopback proxy reported live")
	}
	if !defaultProxyReachable("http://proxy.example:8080") {
		t.Error("remote proxies must not be probed or dropped")
	}
}

func fakeLaunched(exited bool) *launched {
	proc := &launched{pid: 12345, done: make(chan struct{})}
	if exited {
		close(proc.done)
	}
	return proc
}

func TestStartupChecksHealthBeforeRejectingExitedWrapper(t *testing.T) {
	isolate(t)
	calls := 0
	swap(t, &healthy, func(string) bool { calls++; return calls > 1 })
	swap(t, &portInUse, func(int) bool { return false })
	swap(t, &commandFor, func(string) ([]string, string, error) { return []string{"owned"}, root, nil })
	swap(t, &spawn, func([]string, string, []string, *os.File) (*launched, error) { return fakeLaunched(true), nil })
	swap(t, &stopLaunched, func(*launched) error { t.Fatal("stopped a healthy launch"); return nil })
	if err := defaultStartService("web"); err != nil {
		t.Fatal(err)
	}
}

func TestStartupTimeoutStopsOwnedProcess(t *testing.T) {
	isolate(t)
	swap(t, &startupTimeout, 0)
	swap(t, &healthy, func(string) bool { return false })
	swap(t, &portInUse, func(int) bool { return false })
	swap(t, &commandFor, func(string) ([]string, string, error) { return []string{"owned"}, root, nil })
	proc := fakeLaunched(false)
	swap(t, &spawn, func([]string, string, []string, *os.File) (*launched, error) { return proc, nil })
	var stopped *launched
	swap(t, &stopLaunched, func(p *launched) error { stopped = p; return nil })
	err := defaultStartService("web")
	if err == nil || !strings.Contains(err.Error(), "launcher-web.log") {
		t.Fatalf("got %v", err)
	}
	if stopped != proc {
		t.Fatal("did not stop its own process")
	}
}

// useFakeService points "web" at a free port served by this test binary.
func useFakeService(t *testing.T, mode string) (int, **launched) {
	t.Helper()
	isolate(t)
	port := freePort(t)
	svc := services["web"]
	svc.port = port
	svc.healthPath = "/health"
	patched := map[string]service{}
	for k, v := range services {
		patched[k] = v
	}
	patched["web"] = svc
	swap(t, &services, patched)
	exe, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	if mode == "" {
		mode = strconv.Itoa(port)
	}
	swap(t, &environ, func() []string { return append(os.Environ(), fakeServiceEnv+"="+mode) })
	swap(t, &commandFor, func(string) ([]string, string, error) { return []string{exe}, root, nil })
	var proc *launched
	realSpawn := spawn
	swap(t, &spawn, func(c []string, d string, e []string, l *os.File) (*launched, error) {
		p, err := realSpawn(c, d, e, l)
		proc = p
		return p, err
	})
	t.Cleanup(func() {
		if proc != nil {
			_ = stopTree(proc)
		}
	})
	return port, &proc
}

func TestStartServiceSpawnsDetachedServiceAndLogs(t *testing.T) {
	_, proc := useFakeService(t, "")
	if err := defaultStartService("web"); err != nil {
		t.Fatal(err)
	}
	if *proc == nil || (*proc).exited() {
		t.Fatal("service is not running after a successful start")
	}
	if !healthy("web") {
		t.Fatal("service is not healthy")
	}
	// A second start reuses the healthy instance instead of spawning again.
	first := *proc
	if err := defaultStartService("web"); err != nil {
		t.Fatal(err)
	}
	if *proc != first {
		t.Fatal("spawned a duplicate")
	}
}

func TestStartServiceReportsCrashWithLogPath(t *testing.T) {
	useFakeService(t, "exit")
	swap(t, &startupTimeout, 10*time.Second)
	err := defaultStartService("web")
	if err == nil || !strings.Contains(err.Error(), "launcher-web.log") {
		t.Fatalf("got %v", err)
	}
	logged, readErr := os.ReadFile(filepath.Join(logsDir(), "launcher-web.log"))
	if readErr != nil || !strings.Contains(string(logged), "failed on purpose") {
		t.Fatalf("service output not logged: %q %v", logged, readErr)
	}
}

func TestFindRootWalksUpToTheRepository(t *testing.T) {
	repo := t.TempDir()
	nested := filepath.Join(repo, "launcher", "build")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(repo, "launcher", "go.mod"), nil, 0o644); err != nil {
		t.Fatal(err)
	}
	t.Chdir(nested)
	got, err := findRoot("")
	if err != nil {
		t.Fatal(err)
	}
	want, _ := filepath.EvalSymlinks(repo)
	if resolved, _ := filepath.EvalSymlinks(got); resolved != want {
		t.Fatalf("got %s, want %s", got, want)
	}
	if got, _ := findRoot(repo); got != repo {
		t.Fatalf("--repo must win, got %s", got)
	}
}

type pickerCall struct {
	code           int
	stdout, stderr string
}

func fakePicker(t *testing.T, osName string, result pickerCall) {
	swap(t, &goos, osName)
	swap(t, &lookPath, func(string) (string, error) { return "/usr/bin/zenity", nil })
	swap(t, &runOutput, func(string, []string, string) (int, string, string, error) {
		return result.code, result.stdout, result.stderr, nil
	})
}

func TestLinuxPickerSelectionAndCancel(t *testing.T) {
	isolate(t)
	fakePicker(t, "linux", pickerCall{0, "web\n", ""})
	if got, err := choose(nil, nil); err != nil || got != "web" {
		t.Fatalf("got %q %v", got, err)
	}
	fakePicker(t, "linux", pickerCall{1, "", ""})
	if got, err := choose(nil, nil); err != nil || got != "" {
		t.Fatalf("cancel: got %q %v", got, err)
	}
}

func TestLinuxPickerErrorsAreNotTreatedAsCancel(t *testing.T) {
	isolate(t)
	fakePicker(t, "linux", pickerCall{2, "", "picker failed"})
	if _, err := choose(nil, nil); err == nil || err.Error() != "picker failed" {
		t.Fatalf("got %v", err)
	}
}

func TestMacPickerMapsLabelsAndCancel(t *testing.T) {
	isolate(t)
	fakePicker(t, "darwin", pickerCall{0, t_("vision") + "\n", ""})
	if got, _ := choose(nil, nil); got != "vision" {
		t.Fatalf("got %q", got)
	}
	fakePicker(t, "darwin", pickerCall{0, "false\n", ""})
	if got, err := choose(nil, nil); err != nil || got != "" {
		t.Fatalf("cancel: got %q %v", got, err)
	}
}

func TestTerminalPickerFallback(t *testing.T) {
	isolate(t)
	swap(t, &goos, "linux")
	swap(t, &lookPath, func(string) (string, error) { return "", errors.New("no zenity") })
	var out strings.Builder
	if got, err := choose(strings.NewReader("2\n"), &out); err != nil || got != "screen" {
		t.Fatalf("got %q %v", got, err)
	}
	if !strings.Contains(out.String(), "6. ") {
		t.Fatalf("menu not printed: %q", out.String())
	}
	if got, err := choose(strings.NewReader("\n"), &out); err != nil || got != "" {
		t.Fatalf("empty input should cancel, got %q %v", got, err)
	}
}

func TestAppleScriptStringEscapes(t *testing.T) {
	if got := appleScriptString(`a "b" \c`); got != `"a \"b\" \\c"` {
		t.Fatal(got)
	}
}

func TestRunRejectsUnknownChoicesWithoutStarting(t *testing.T) {
	swap(t, &startService, func(string) error { t.Fatal("started"); return nil })
	var out, errs strings.Builder
	if code := run([]string{"--start", "bad"}, nil, &out, &errs); code != 2 {
		t.Fatalf("exit %d", code)
	}
	if code := run([]string{"--lang", "fr"}, nil, &out, &errs); code != 2 {
		t.Fatalf("exit %d", code)
	}
}

func TestRunReportsLocalizedResult(t *testing.T) {
	swap(t, &root, "")
	swap(t, &lang, "uk")
	swap(t, &startService, func(string) error { return nil })
	swap(t, &openURL, func(string) error { return nil })
	var out, errs strings.Builder
	if code := run([]string{"--start", "web", "--lang", "en", "--repo", t.TempDir()}, nil, &out, &errs); code != 0 {
		t.Fatalf("exit %d: %s", code, errs.String())
	}
	if strings.TrimSpace(out.String()) != "Ready: Dashboard" {
		t.Fatalf("got %q", out.String())
	}

	swap(t, &startService, func(string) error { return errors.New("boom") })
	out.Reset()
	if code := run([]string{"--start", "web", "--lang", "en", "--repo", t.TempDir()}, nil, &out, &errs); code != 1 {
		t.Fatalf("exit %d", code)
	}
	if !strings.Contains(errs.String(), "Error: boom") {
		t.Fatalf("got %q", errs.String())
	}
}

import AppKit

let arguments = CommandLine.arguments
func argument(_ name: String) -> String? {
    guard let index = arguments.firstIndex(of: name), index + 1 < arguments.count else { return nil }
    return arguments[index + 1]
}

let sourceRoot = URL(fileURLWithPath: #filePath)
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let bundleRoot = Bundle.main.bundleURL
    .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
let root = argument("--repo").map { URL(fileURLWithPath: $0) }
    ?? (FileManager.default.fileExists(atPath: bundleRoot.appendingPathComponent("launcher/launcher.py").path) ? bundleRoot : sourceRoot)
let language = argument("--lang") == "en" ? "en" : "uk"
let localeURL = Bundle.main.url(forResource: "locales", withExtension: "json")
    ?? root.appendingPathComponent("launcher/locales.json")
let locales = (try? JSONSerialization.jsonObject(with: Data(contentsOf: localeURL))) as? [String: [String: String]] ?? [:]
func t(_ key: String, _ values: [String: String] = [:]) -> String {
    values.reduce(locales[language]?[key] ?? key) { $0.replacingOccurrences(of: "{\($1.key)}", with: $1.value) }
}

let actions = ["web", "openclaw", "screen", "vision", "display", "pair"]
let symbols = ["globe", "bolt", "desktopcomputer", "eye", "display", "play.fill"]

final class LauncherDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate {
    var window: NSWindow!
    var buttons: [NSButton] = []
    var busy = false
    var currentProcess: Process?
    let status = NSTextField(wrappingLabelWithString: "")
    let progress = NSProgressIndicator()

    func label(_ key: String, size: CGFloat, weight: NSFont.Weight = .regular) -> NSTextField {
        let field = NSTextField(wrappingLabelWithString: t(key))
        field.font = .systemFont(ofSize: size, weight: weight)
        field.textColor = .labelColor
        return field
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 520, height: 442),
                          styleMask: [.titled, .closable, .miniaturizable], backing: .buffered, defer: false)
        window.title = t("title")
        window.delegate = self
        window.isReleasedWhenClosed = false
        window.appearance = NSAppearance(named: .aqua)
        window.backgroundColor = NSColor(calibratedRed: 0.97, green: 0.965, blue: 0.95, alpha: 1)
        let content = window.contentView!
        content.wantsLayer = true
        content.layer?.backgroundColor = window.backgroundColor.cgColor

        let heading = label("gui.heading", size: 25, weight: .semibold)
        heading.frame = NSRect(x: 24, y: 382, width: 472, height: 34)
        content.addSubview(heading)
        let subtitle = label("gui.subtitle", size: 12)
        subtitle.textColor = .secondaryLabelColor
        subtitle.frame = NSRect(x: 24, y: 348, width: 472, height: 32)
        content.addSubview(subtitle)

        for (index, action) in actions.enumerated() {
            let button = NSButton(title: t(action), target: self, action: #selector(start(_:)))
            button.tag = index
            button.identifier = NSUserInterfaceItemIdentifier(action)
            button.setAccessibilityLabel(t(action))
            button.font = .systemFont(ofSize: 14, weight: .medium)
            button.image = NSImage(systemSymbolName: symbols[index], accessibilityDescription: nil)
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
            button.isBordered = false
            button.wantsLayer = true
            button.layer?.cornerRadius = 8
            button.layer?.borderWidth = 1
            button.layer?.borderColor = NSColor(calibratedWhite: 0.89, alpha: 1).cgColor
            button.layer?.backgroundColor = (action == "pair" ? NSColor(calibratedWhite: 0.18, alpha: 1) : .white).cgColor
            button.contentTintColor = action == "pair" ? .white : NSColor(calibratedWhite: 0.18, alpha: 1)
            button.attributedTitle = NSAttributedString(string: t(action), attributes: [
                .font: NSFont.systemFont(ofSize: 14, weight: .medium),
                .foregroundColor: action == "pair" ? NSColor.white : NSColor(calibratedWhite: 0.18, alpha: 1),
            ])
            button.frame = NSRect(x: 24 + (index % 2) * 242, y: 260 - (index / 2) * 80, width: 230, height: 68)
            content.addSubview(button)
            buttons.append(button)
        }

        progress.style = .spinning
        progress.controlSize = .small
        progress.isDisplayedWhenStopped = false
        progress.frame = NSRect(x: 24, y: 63, width: 16, height: 16)
        content.addSubview(progress)
        status.stringValue = t("gui.idle")
        status.font = .systemFont(ofSize: 12)
        status.textColor = .secondaryLabelColor
        status.isSelectable = true
        status.frame = NSRect(x: 48, y: 39, width: 378, height: 42)
        content.addSubview(status)

        let logs = NSButton(title: t("gui.logs"), target: self, action: #selector(openLogs))
        logs.bezelStyle = .rounded
        logs.frame = NSRect(x: 438, y: 54, width: 58, height: 28)
        content.addSubview(logs)
        let hint = label("gui.serviceHint", size: 10)
        hint.textColor = .tertiaryLabelColor
        hint.frame = NSRect(x: 24, y: 15, width: 472, height: 18)
        content.addSubview(hint)

        let menu = NSMenu()
        let application = NSMenuItem()
        menu.addItem(application)
        let applicationMenu = NSMenu()
        applicationMenu.addItem(withTitle: t("gui.quit"), action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        application.submenu = applicationMenu
        NSApp.mainMenu = menu
        window.center()
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)

        if arguments.contains("--smoke-test") {
            // Render only this app's window; no screen recording permission or service start.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) {
                self.runSmokeTest()
            }
        }
    }

    @objc func start(_ sender: NSButton) {
        guard !busy, actions.indices.contains(sender.tag) else { return }
        let action = actions[sender.tag]
        let script = root.appendingPathComponent("launcher/launcher.py")
        guard FileManager.default.fileExists(atPath: script.path) else {
            showFailure(t("gui.missing"))
            return
        }
        busy = true
        buttons.forEach { $0.isEnabled = false }
        status.stringValue = t("gui.starting", ["name": t(action)])
        progress.startAnimation(nil)

        let process = Process()
        currentProcess = process
        let python = root.appendingPathComponent("Virtual Bot/.venv/bin/python")
        process.executableURL = FileManager.default.isExecutableFile(atPath: python.path) ? python : URL(fileURLWithPath: "/usr/bin/python3")
        process.arguments = [script.path, "--start", action, "--lang", language]
        process.currentDirectoryURL = root
        var environment = ProcessInfo.processInfo.environment
        environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:" + (environment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin")
        environment["PYTHONUNBUFFERED"] = "1"
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        let output = Pipe()
        process.standardOutput = output
        process.standardError = output

        // Reading the pipe on a worker drains it while the helper runs, so UI never blocks.
        DispatchQueue.global(qos: .userInitiated).async {
            do {
                try process.run()
                let data = output.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                let message = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                DispatchQueue.main.async {
                    self.busy = false
                    self.currentProcess = nil
                    self.progress.stopAnimation(nil)
                    self.buttons.forEach { $0.isEnabled = true }
                    if process.terminationStatus == 0 {
                        self.status.stringValue = t("ready", ["name": t(action)])
                    } else {
                        self.showFailure(message.isEmpty ? t("failed", ["log": self.logDirectory.path]) : message)
                    }
                    if arguments.contains("--smoke-test") {
                        self.finishSmokeTest(success: process.terminationStatus == 0)
                    }
                }
            } catch {
                DispatchQueue.main.async {
                    self.busy = false
                    self.currentProcess = nil
                    self.progress.stopAnimation(nil)
                    self.buttons.forEach { $0.isEnabled = true }
                    self.showFailure(error.localizedDescription)
                    if arguments.contains("--smoke-test") { self.finishSmokeTest(success: false) }
                }
            }
        }
    }

    var logDirectory: URL { root.appendingPathComponent("Virtual Bot/service_logs") }

    @objc func openLogs() {
        try? FileManager.default.createDirectory(at: logDirectory, withIntermediateDirectories: true)
        NSWorkspace.shared.open(logDirectory)
    }

    func showFailure(_ message: String) {
        status.stringValue = message
        status.toolTip = message
        if arguments.contains("--smoke-test") { return }
        let alert = NSAlert()
        alert.messageText = t("title")
        alert.informativeText = message
        alert.alertStyle = .warning
        alert.beginSheetModal(for: window)
    }

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if busy { status.stringValue = t("gui.keepOpen") }
        return !busy
    }

    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        busy ? .terminateCancel : .terminateNow
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        window.makeKeyAndOrderFront(nil)
        return true
    }

    func runSmokeTest() {
        precondition(buttons.count == 6 && buttons.allSatisfy { $0.isEnabled })
        precondition(buttons.map { actions[$0.tag] } == actions)
        precondition(buttons.allSatisfy { !$0.title.isEmpty && $0.title != actions[$0.tag] || actions[$0.tag] == "openclaw" })
        if let action = argument("--test-action") {
            guard let index = actions.firstIndex(of: action) else { preconditionFailure("Unknown test action") }
            buttons[index].performClick(nil)
            precondition(busy && buttons.allSatisfy { !$0.isEnabled })
            precondition(!windowShouldClose(window))
            return
        }
        finishSmokeTest(success: true)
    }

    func finishSmokeTest(success: Bool) {
        precondition(!busy && buttons.allSatisfy { $0.isEnabled })
        precondition(success != arguments.contains("--expect-failure"))
        if let path = argument("--screenshot") {
            guard let view = window.contentView,
                  let bitmap = view.bitmapImageRepForCachingDisplay(in: view.bounds) else {
                fputs("FAIL: could not capture the native window\n", stderr)
                exit(EXIT_FAILURE)
            }
            view.cacheDisplay(in: view.bounds, to: bitmap)
            guard let png = bitmap.representation(using: .png, properties: [:]) else {
                fputs("FAIL: could not encode the native window screenshot\n", stderr)
                exit(EXIT_FAILURE)
            }
            do {
                try png.write(to: URL(fileURLWithPath: path))
            } catch {
                fputs("FAIL: screenshot write failed: \(error.localizedDescription)\n", stderr)
                exit(EXIT_FAILURE)
            }
        }
        print("PASS: native window, six localized actions, helper outcome=\(success), controls restored")
        NSApp.terminate(nil)
    }
}

let app = NSApplication.shared
app.setActivationPolicy(.regular)
let delegate = LauncherDelegate()
app.delegate = delegate
app.run()

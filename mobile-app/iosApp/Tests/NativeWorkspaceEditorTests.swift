#if BLINK_IOS_UI_FIXTURES
import XCTest
import UIKit
import WebKit
import ClaudeBot

@MainActor
final class NativeWorkspaceEditorTests: XCTestCase {
    private var window: UIWindow?

    override func tearDown() async throws {
        window?.rootViewController = nil
        window?.isHidden = true
        window = nil
        try await super.tearDown()
    }

    func testTiptapInputIsDeliveredBeforeNativeFlushAcknowledgement() async throws {
        let web = try await mount(mode: "markdown")
        try await waitForJavaScript("Boolean(document.querySelector('[data-testid=rich-editor] [contenteditable=true]'))", in: web)
        _ = try await evaluate("""
        (() => {
          const editor = document.querySelector('[data-testid=rich-editor] [contenteditable=true]');
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor); range.collapse(false);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('insertText', false, ' ios-tiptap-input');
          return editor.innerText;
        })()
        """, in: web)
        try await waitForChange(containing: "ios-tiptap-input")

        let flushed = try await flush()
        XCTAssertTrue(flushed)
        let lastChange = try XCTUnwrap(IosEditorFixtureKt.iosEditorFixtureLastChange())
        XCTAssertTrue(lastChange.contains("ios-tiptap-input"))
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureErrors(), "")
        try await capture("Tiptap edited note", in: web)
    }

    func testHTMLCodeMirrorInputIsDeliveredBeforeNativeFlushAcknowledgement() async throws {
        let web = try await mount(mode: "html")
        try await waitForJavaScript("Boolean(document.querySelector('[data-testid=source-editor] .cm-content[contenteditable=true]'))", in: web)
        _ = try await evaluate("""
        (() => {
          const editor = document.querySelector('[data-testid=source-editor] .cm-content[contenteditable=true]');
          editor.focus();
          const range = document.createRange();
          range.selectNodeContents(editor); range.collapse(false);
          const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
          document.execCommand('insertText', false, 'ios-codemirror-input');
          return editor.innerText;
        })()
        """, in: web)
        try await waitForChange(containing: "ios-codemirror-input")

        let flushed = try await flush()
        XCTAssertTrue(flushed)
        let lastChange = try XCTUnwrap(IosEditorFixtureKt.iosEditorFixtureLastChange())
        XCTAssertTrue(lastChange.contains("ios-codemirror-input"))
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureErrors(), "")
        try await capture("CodeMirror edited HTML", in: web)
    }

    func testExcalidrawCanvasPointerEditProducesAFlushedScene() async throws {
        let web = try await mount(mode: "drawing")
        try await waitForJavaScript("Boolean(document.querySelector('[data-testid=toolbar-rectangle]') && document.querySelector('canvas.interactive'))", in: web)
        _ = try await evaluate("document.querySelector('[data-testid=toolbar-rectangle]').click(); true", in: web)
        try await waitForJavaScript("document.querySelector('[data-testid=toolbar-rectangle]').checked === true", in: web)
        _ = try await evaluate("""
        (() => {
          const canvas = document.querySelector('canvas.interactive');
          const setCapture = canvas.setPointerCapture.bind(canvas);
          const releaseCapture = canvas.releasePointerCapture.bind(canvas);
          // Synthetic IDs have no WebKit input device. Only this fixture ID
          // emulates capture; real pointer IDs still call the native methods.
          canvas.setPointerCapture = id => { if (id !== 19) setCapture(id); };
          canvas.releasePointerCapture = id => { if (id !== 19) releaseCapture(id); };
          const bounds = canvas.getBoundingClientRect();
          const startX = bounds.left + bounds.width * .45, startY = bounds.top + bounds.height * .48;
          window.fixtureDrag = {canvas, startX, startY, setCapture, releaseCapture};
          canvas.dispatchEvent(new PointerEvent('pointerdown', {
            bubbles:true, cancelable:true, pointerId:19, pointerType:'mouse', isPrimary:true,
            button:0, buttons:1, clientX:startX, clientY:startY,
          }));
          return true;
        })()
        """, in: web)
        for (event, buttons) in [("pointermove", 1), ("pointerup", 0)] {
            try await Task.sleep(nanoseconds: 100_000_000)
            _ = try await evaluate("""
            (() => {
              const drag = window.fixtureDrag;
              drag.canvas.dispatchEvent(new PointerEvent('\(event)', {
                bubbles:true, cancelable:true, pointerId:19, pointerType:'mouse', isPrimary:true,
                button:0, buttons:\(buttons), clientX:drag.startX + 54, clientY:drag.startY + 38,
              }));
              return true;
            })()
            """, in: web)
        }
        _ = try await evaluate("""
        const drag = window.fixtureDrag;
        drag.canvas.setPointerCapture = drag.setCapture;
        drag.canvas.releasePointerCapture = drag.releaseCapture;
        delete window.fixtureDrag;
        true;
        """, in: web)
        try await waitForChange(containing: "rectangle")

        let flushed = try await flush()
        XCTAssertTrue(flushed)
        let scene = try XCTUnwrap(IosEditorFixtureKt.iosEditorFixtureLastChange())
        let decoded = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(scene.utf8)) as? [String: Any])
        XCTAssertEqual(decoded["type"] as? String, "excalidraw")
        let elements = try XCTUnwrap(decoded["elements"] as? [[String: Any]])
        let rectangle = try XCTUnwrap(elements.first { $0["type"] as? String == "rectangle" })
        XCTAssertGreaterThan(try XCTUnwrap(rectangle["width"] as? Double), 0)
        XCTAssertGreaterThan(try XCTUnwrap(rectangle["height"] as? Double), 0)
        XCTAssertEqual(rectangle["isDeleted"] as? Bool, false)
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureErrors(), "")
        try await capture("Excalidraw edited canvas", in: web)
    }

    func testPreviewUsesOpaqueOriginBlocksBridgeAndConstrainsResourcesAndNavigation() async throws {
        let web = try await mount(mode: "preview")
        try await waitForJavaScript("Boolean(window.fixturePreviewProbe)", in: web)

        let rawProbe = try await evaluate("JSON.stringify(window.fixturePreviewProbe)", in: web)
        let probeJSON = try XCTUnwrap(rawProbe as? String)
        let probeData = try XCTUnwrap(probeJSON.data(using: .utf8))
        let probe = try XCTUnwrap(JSONSerialization.jsonObject(with: probeData) as? [String: Any])
        XCTAssertEqual(probe["origin"] as? String, "null")
        XCTAssertEqual(probe["bridge"] as? Bool, false)
        XCTAssertEqual(probe["storage"] as? String, "SecurityError")
        XCTAssertEqual(probe["cookie"] as? String, "")
        let attempts = try XCTUnwrap(probe["attempts"] as? [String: String])
        for api in ["websocket", "peerConnection", "worker", "eventSource"] {
            XCTAssertEqual(attempts[api], "SecurityError", "Unexpected \(api) constructor result")
        }

        try await waitForJavaScript("window.fixtureModule === 'local-module-ok'", in: web)
        try await waitForJavaScript("window.fixtureFallbackStatus !== undefined", in: web)
        let fallbackStatus = try await evaluate("window.fixtureFallbackStatus", in: web) as? Int
        XCTAssertEqual(fallbackStatus, 415)

        // Exercise hostile srcdoc directly. WebKit may block it through CSP or
        // load it and apply the all-frame bootstrap; both outcomes are checked.
        let childProbeRaw = try await evaluate("window.fixtureChildProbe ? JSON.stringify(window.fixtureChildProbe) : null", in: web)
        if let childProbeJSON = childProbeRaw as? String,
           let childProbeData = childProbeJSON.data(using: .utf8),
           let childProbe = try JSONSerialization.jsonObject(with: childProbeData) as? [String: String] {
            XCTAssertEqual(childProbe["websocket"], "SecurityError")
            XCTAssertEqual(childProbe["peerConnection"], "SecurityError")
        } else {
            XCTAssertTrue(childProbeRaw == nil || childProbeRaw is NSNull,
                          "The preview should not permit executable child-frame content")
        }

        let originalURL = try XCTUnwrap(web.url?.absoluteString)
        _ = try await evaluate("document.getElementById('external').click()", in: web)
        try await Task.sleep(nanoseconds: 300_000_000)
        XCTAssertEqual(web.url?.absoluteString, originalURL)
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureErrors(), "preview_failed")
        try await capture("Isolated HTML preview", in: web)
    }

    func testOnlyTheTrustedEditorMainFrameCanSendBridgeMessages() async throws {
        let web = try await mount(mode: "markdown")
        try await waitForJavaScript("Boolean(window.BlinkWorkspace && document.querySelector('[data-testid=rich-editor]'))", in: web)
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureChangeCount(), 0)
        let mainBridgeAvailable = try await evaluate("Boolean(window.webkit?.messageHandlers?.BlinkNative)", in: web) as? Bool
        XCTAssertEqual(mainBridgeAvailable, true)

        _ = try await evaluate("window.webkit.messageHandlers.BlinkNative.postMessage(JSON.stringify({type:'change',id:'ios-ui-markdown-1',sequence:1,content:'main bridge positive control'}))", in: web)
        try await waitForChange(containing: "main bridge positive control")
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureChangeCount(), 1)

        _ = try await evaluate("""
        (() => {
          const frame = document.createElement('iframe');
          document.body.append(frame);
          const send = () => {
            try {
              window.fixtureChildBridgeAvailable = Boolean(frame.contentWindow.webkit?.messageHandlers?.BlinkNative);
              frame.contentWindow.webkit.messageHandlers.BlinkNative.postMessage(JSON.stringify({
                type:'change', id:'ios-ui-markdown-1', sequence:2, content:'forged child frame'
              }));
            } catch (_) { window.fixtureChildBridgeAvailable = false; }
          };
          frame.addEventListener('load', send, {once:true});
          send();
          return true;
        })()
        """, in: web)
        try await Task.sleep(nanoseconds: 300_000_000)
        let childBridgeAvailable = try await evaluate("window.fixtureChildBridgeAvailable", in: web) as? Bool
        XCTAssertNotNil(childBridgeAvailable, "The child-frame bridge probe did not run")
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureChangeCount(), 1,
                       "A valid child-frame message must be rejected while the main-frame control is accepted")
        let acceptedChange = try XCTUnwrap(IosEditorFixtureKt.iosEditorFixtureLastChange())
        XCTAssertTrue(acceptedChange.contains("main bridge positive control"))
        XCTAssertEqual(IosEditorFixtureKt.iosEditorFixtureErrors(), "")
    }

    private func mount(mode: String) async throws -> WKWebView {
        let scene = try XCTUnwrap(UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first)
        let hostWindow = UIWindow(windowScene: scene)
        hostWindow.frame = scene.coordinateSpace.bounds
        hostWindow.rootViewController = IosEditorFixtureKt.iosEditorFixtureViewController()
        hostWindow.makeKeyAndVisible()
        window = hostWindow
        IosEditorFixtureKt.iosEditorFixtureSelect(mode: mode)

        let expectedHost = mode == "preview" ? "claudebot-preview://" : "blink-workspace://"
        let deadline = Date().addingTimeInterval(15)
        while Date() < deadline {
            let errors = IosEditorFixtureKt.iosEditorFixtureErrors()
            if mode != "preview", !errors.isEmpty {
                throw NSError(domain: "NativeWorkspaceEditorTests", code: 5,
                              userInfo: [NSLocalizedDescriptionKey: "The native editor failed to load: \(errors)"])
            }
            if let web = findWebView(in: hostWindow.rootViewController?.view), web.bounds.width > 0, web.bounds.height > 0 {
                // A blank WebView may never call its evaluation completion on
                // the simulator. Wait for the owned navigation before polling JS.
                if web.url?.absoluteString.hasPrefix(expectedHost) == true {
                    let ready = (try? await evaluate("document.readyState === 'complete'", in: web) as? Bool) ?? false
                    if ready { return web }
                }
            }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "NativeWorkspaceEditorTests", code: 1,
                      userInfo: [NSLocalizedDescriptionKey: "The Compose fixture did not load its native document before timeout"])
    }

    private func findWebView(in view: UIView?) -> WKWebView? {
        guard let view else { return nil }
        if let web = view as? WKWebView { return web }
        for child in view.subviews {
            if let web = findWebView(in: child) { return web }
        }
        return nil
    }

    private func capture(_ name: String, in web: WKWebView) async throws {
        let image: UIImage = try await withCheckedThrowingContinuation { continuation in
            let options = WKSnapshotConfiguration()
            options.afterScreenUpdates = true
            web.takeSnapshot(with: options) { image, error in
                if let error { continuation.resume(throwing: error) }
                else if let image { continuation.resume(returning: image) }
                else { continuation.resume(throwing: NSError(domain: "NativeWorkspaceEditorTests", code: 4)) }
            }
        }
        let attachment = XCTAttachment(image: image)
        attachment.name = name
        attachment.lifetime = .keepAlways
        add(attachment)
    }

    private func evaluate(_ source: String, in web: WKWebView) async throws -> Any? {
        try await withCheckedThrowingContinuation { continuation in
            var completed = false
            let timeout = DispatchWorkItem {
                guard !completed else { return }
                completed = true
                continuation.resume(throwing: NSError(domain: "NativeWorkspaceEditorTests", code: 6,
                    userInfo: [NSLocalizedDescriptionKey: "WebKit did not complete JavaScript evaluation before timeout"]))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 5, execute: timeout)
            web.evaluateJavaScript(source) { value, error in
                guard !completed else { return }
                completed = true
                timeout.cancel()
                if let error { continuation.resume(throwing: error) }
                else { continuation.resume(returning: value) }
            }
        }
    }

    private func waitForJavaScript(_ source: String, in web: WKWebView) async throws {
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            if (try? await evaluate(source, in: web) as? Bool) == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "NativeWorkspaceEditorTests", code: 2,
                      userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for JavaScript condition: \(source)"])
    }

    private func waitForChange(containing text: String) async throws {
        let deadline = Date().addingTimeInterval(8)
        while Date() < deadline {
            if IosEditorFixtureKt.iosEditorFixtureLastChange()?.contains(text) == true { return }
            try await Task.sleep(nanoseconds: 100_000_000)
        }
        throw NSError(domain: "NativeWorkspaceEditorTests", code: 3,
                      userInfo: [NSLocalizedDescriptionKey: "Timed out waiting for native editor change containing \(text)"])
    }

    private func flush() async throws -> Bool {
        let completed = expectation(description: "The native editor flush callback arrives")
        var result: Bool?
        IosEditorFixtureKt.iosEditorFixtureFlush { value in
            result = value.boolValue
            completed.fulfill()
        }
        await fulfillment(of: [completed], timeout: 4)
        return try XCTUnwrap(result, "The native editor flush callback did not return a result")
    }
}
#endif

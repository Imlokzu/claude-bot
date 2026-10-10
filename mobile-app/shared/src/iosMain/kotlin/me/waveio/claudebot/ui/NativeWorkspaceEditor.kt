@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package me.waveio.claudebot.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.viewinterop.UIKitView
import kotlinx.cinterop.ObjCSignatureOverride
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.readValue
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import me.waveio.claudebot.data.WebPreviewResource
import me.waveio.claudebot.data.WorkspaceEditorAction
import me.waveio.claudebot.data.WorkspaceEditorBridge
import me.waveio.claudebot.data.WorkspaceEditorDocument
import me.waveio.claudebot.data.WorkspaceEditorManifest
import me.waveio.claudebot.data.WorkspaceEditorResourceTimeoutMillis
import me.waveio.claudebot.data.WorkspaceEditorResponseHeaders
import me.waveio.claudebot.data.WorkspaceEditorSession
import me.waveio.claudebot.data.guardedWorkspaceEditorResource
import me.waveio.claudebot.data.loadWorkspaceEditorAsset
import me.waveio.claudebot.data.loadWorkspaceEditorManifest
import me.waveio.claudebot.data.validWorkspaceEditorDocument
import me.waveio.claudebot.data.validWorkspaceEditorResourcePath
import me.waveio.claudebot.data.workspaceEditorResourcePath
import platform.CoreGraphics.CGRectZero
import platform.Foundation.NSData
import platform.Foundation.NSError
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSNotificationCenter
import platform.Foundation.NSNumber
import platform.Foundation.NSOperationQueue
import platform.Foundation.NSURL
import platform.Foundation.NSURLComponents
import platform.Foundation.NSURLRequest
import platform.Foundation.NSUUID
import platform.Foundation.HTTPMethod
import platform.Foundation.valueForHTTPHeaderField
import platform.Foundation.create
import platform.UIKit.UIApplicationDidEnterBackgroundNotification
import platform.WebKit.*
import platform.WebKit.WKNavigationTypeReload
import platform.darwin.NSObject
import platform.darwin.NSObjectProtocol
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

@Composable
actual fun NativeWorkspaceEditor(
    document: WorkspaceEditorDocument,
    session: WorkspaceEditorSession,
    onChange: (String) -> Unit,
    onAction: (WorkspaceEditorAction) -> Unit,
    onError: (String) -> Unit,
    loadResource: suspend (String) -> WebPreviewResource?,
    modifier: Modifier,
) {
    key(document.id, session) {
        val host = remember { IosWorkspaceEditorHost(document, session, onChange, onAction, onError, loadResource) }
        SideEffect { host.update(document, onChange, onAction, onError, loadResource) }
        DisposableEffect(host) { onDispose { host.close() } }
        UIKitView(
            factory = { host.createView() },
            modifier = modifier.testTag("native-workspace-editor"),
            onRelease = { host.close() },
        )
    }
}

private const val WorkspaceScheme = "blink-workspace"
private const val WorkspaceEntryPath = "/index.html"
private const val WorkspaceBridgeName = "BlinkNative"
private const val WorkspaceNetworkRules = """[
    {"trigger":{"url-filter":".*"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^blink-workspace:"},"action":{"type":"ignore-previous-rules"}},
    {"trigger":{"url-filter":"^data:"},"action":{"type":"ignore-previous-rules"}},
    {"trigger":{"url-filter":"^blob:"},"action":{"type":"ignore-previous-rules"}},
    {"trigger":{"url-filter":".*"},"action":{"type":"block-cookies"}}
]"""

/** Only the bundled main document receives the bridge; workspace HTML is never served. */
private class IosWorkspaceEditorHost(
    document: WorkspaceEditorDocument,
    private val session: WorkspaceEditorSession,
    onChange: (String) -> Unit,
    onAction: (WorkspaceEditorAction) -> Unit,
    private var onError: (String) -> Unit,
    private var loader: suspend (String) -> WebPreviewResource?,
) : NSObject(), WKURLSchemeHandlerProtocol, WKNavigationDelegateProtocol,
    WKUIDelegateProtocol, WKScriptMessageHandlerProtocol {
    private val host = "editor-${NSUUID().UUIDString.lowercase()}"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tasks = mutableMapOf<WKURLSchemeTaskProtocol, Job>()
    private val errors = mutableSetOf<String>()
    private var alive = true
    private var view: WKWebView? = null
    private var manifest: WorkspaceEditorManifest? = null
    private var pendingDocumentUrl: String? = null
    private var documentNavigationStarted = false
    private var backgroundObserver: NSObjectProtocol? = null
    private val initialDocumentValid = validWorkspaceEditorDocument(document)
    private val bridge = WorkspaceEditorBridge(
        document = document,
        scope = scope,
        evaluate = { script, done ->
            val web = view
            if (!alive || web == null) done(false) else {
                web.evaluateJavaScript(script) { result, error ->
                    if (alive) done(error == null && (result as? NSNumber)?.boolValue == true)
                }
            }
        },
        onChange = onChange,
        onAction = onAction,
        onError = { fail(it) },
    )

    fun update(
        document: WorkspaceEditorDocument,
        onChange: (String) -> Unit,
        onAction: (WorkspaceEditorAction) -> Unit,
        onError: (String) -> Unit,
        loader: suspend (String) -> WebPreviewResource?,
    ) {
        if (!alive) return
        this.onError = onError
        this.loader = loader
        bridge.onChange = onChange
        bridge.onAction = onAction
        bridge.update(document)
    }

    private fun path(url: NSURL?): String? {
        val parts = url?.absoluteString?.let { NSURLComponents(string = it) } ?: return null
        if (parts.scheme != WorkspaceScheme || parts.host != host || parts.port != null ||
            parts.user != null || parts.password != null || parts.query != null) return null
        return workspaceEditorResourcePath(parts.percentEncodedPath.orEmpty())
    }

    private fun fail(code: String) {
        if (alive && errors.add(code)) onError(code)
    }

    fun createView(): WKWebView {
        view?.let { return it }
        session.attach(this, bridge::flush, bridge::resolveAction)
        val config = WKWebViewConfiguration().apply {
            websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore()
            preferences.javaScriptCanOpenWindowsAutomatically = false
            defaultWebpagePreferences.allowsContentJavaScript = true
            allowsAirPlayForMediaPlayback = false
            allowsPictureInPictureMediaPlayback = false
            setURLSchemeHandler(this@IosWorkspaceEditorHost, forURLScheme = WorkspaceScheme)
            userContentController.addScriptMessageHandler(this@IosWorkspaceEditorHost, name = WorkspaceBridgeName)
            userContentController.addUserScript(WKUserScript(
                source = PreviewBootstrap,
                injectionTime = WKUserScriptInjectionTime.WKUserScriptInjectionTimeAtDocumentStart,
                forMainFrameOnly = false,
            ))
        }
        val web = WKWebView(frame = CGRectZero.readValue(), configuration = config)
        view = web
        web.navigationDelegate = this
        web.UIDelegate = this
        web.allowsBackForwardNavigationGestures = false
        backgroundObserver = NSNotificationCenter.defaultCenter.addObserverForName(
            UIApplicationDidEnterBackgroundNotification,
            `object` = null,
            queue = NSOperationQueue.mainQueue,
        ) { if (alive) bridge.flush { } }
        scope.launch {
            try {
                if (!initialDocumentValid) { fail("invalid_document"); return@launch }
                // No HTML loads until WebKit itself blocks every external scheme.
                withTimeout(WorkspaceEditorResourceTimeoutMillis) {
                    manifest = withContext(Dispatchers.Default) { loadWorkspaceEditorManifest() }
                    val rules = suspendCancellableCoroutine<WKContentRuleList> { continuation ->
                        val ruleListStore = WKContentRuleListStore.defaultStore()
                        if (ruleListStore == null) {
                            continuation.resumeWithException(IllegalStateException("editor_failed"))
                            return@suspendCancellableCoroutine
                        }
                        ruleListStore.compileContentRuleListForIdentifier(
                            "blink-workspace-network-v1", encodedContentRuleList = WorkspaceNetworkRules,
                        ) { result, error ->
                            if (continuation.isActive) {
                                if (result != null && error == null) continuation.resume(result)
                                else continuation.resumeWithException(IllegalStateException("editor_failed"))
                            }
                        }
                    }
                    if (!alive) return@withTimeout
                    web.configuration.userContentController.addContentRuleList(rules)
                    val url = NSURLComponents().apply {
                        scheme = WorkspaceScheme
                        host = this@IosWorkspaceEditorHost.host
                        path = WorkspaceEntryPath
                    }.URL
                    if (url == null) fail("editor_failed") else {
                        pendingDocumentUrl = url.absoluteString
                        web.loadRequest(NSURLRequest(uRL = url))
                    }
                }
            } catch (_: CancellationException) {
                if (alive) fail("editor_failed")
            } catch (_: Exception) {
                fail("editor_failed")
            }
        }
        return web
    }

    override fun userContentController(userContentController: WKUserContentController, didReceiveScriptMessage: WKScriptMessage) {
        val message = didReceiveScriptMessage
        val frame = message.frameInfo
        val origin = frame.securityOrigin
        if (!alive || message.webView !== view || message.name != WorkspaceBridgeName || !frame.mainFrame ||
            origin.protocol != WorkspaceScheme || origin.host != host || origin.port != 0L ||
            frame.request.HTTPMethod != "GET" || path(frame.request.URL) != WorkspaceEntryPath) return
        (message.body as? String)?.let(bridge::receive)
    }

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, startURLSchemeTask: WKURLSchemeTaskProtocol) {
        if (!alive) return
        val task = startURLSchemeTask
        val request = task.request
        val url = request.URL
        val resourcePath = path(url)
        val isDocument = pendingDocumentUrl != null && url?.absoluteString == pendingDocumentUrl
        if (isDocument) pendingDocumentUrl = null
        val bundled = resourcePath?.let { manifest?.files?.containsKey(it.removePrefix("/")) } == true
        val workspaceResource = resourcePath?.takeIf { it.startsWith("/workspace/") }
            ?.removePrefix("/workspace/")?.let(::validWorkspaceEditorResourcePath) == true
        fun reportFailure() {
            // Browser probes outside the manifest are denied without declaring
            // an otherwise healthy bundled editor broken.
            if (isDocument || bundled) fail("editor_failed")
            else if (workspaceResource) fail("resource_unavailable")
        }
        lateinit var job: Job
        job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val assetManifest = manifest
                val load = loader
                val resource = if (resourcePath == null || request.HTTPMethod != "GET" || assetManifest == null) null else {
                    withContext(Dispatchers.Default) {
                        withTimeout(WorkspaceEditorResourceTimeoutMillis) {
                            if (resourcePath.startsWith("/workspace/")) {
                                val workspacePath = resourcePath.removePrefix("/workspace/")
                                if (validWorkspaceEditorResourcePath(workspacePath)) load(workspacePath)?.let { guardedWorkspaceEditorResource(workspacePath, it) } else null
                            } else loadWorkspaceEditorAsset(assetManifest, resourcePath)
                        }
                    }
                }
                if (!active(task, job)) return@launch
                val allowed = resource?.takeUnless {
                    if (isDocument) resourcePath != WorkspaceEntryPath || it.mimeType != "text/html" || it.status !in 200..299
                    else it.mimeType == "text/html"
                }
                val result = allowed ?: WebPreviewResource(ByteArray(0), "text/plain", if (request.HTTPMethod == "GET") 404 else 405)
                val response = url?.let {
                    NSHTTPURLResponse(
                        uRL = it, statusCode = result.status.toLong(), HTTPVersion = "HTTP/1.1",
                        headerFields = WorkspaceEditorResponseHeaders + ("Content-Type" to result.mimeType),
                    )
                }
                if (response == null) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWorkspaceEditor", code = 1, userInfo = null))
                } else {
                    task.didReceiveResponse(response)
                    if (!active(task, job)) return@launch
                    if (result.bytes.isNotEmpty()) result.bytes.usePinned {
                        task.didReceiveData(NSData.create(bytes = it.addressOf(0), length = result.bytes.size.toULong()))
                    }
                    if (!active(task, job)) return@launch
                    task.didFinish()
                }
                if (allowed == null) reportFailure()
            } catch (_: CancellationException) {
                // WebKit has already stopped canceled tasks; never send them another callback.
                if (active(task, job)) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWorkspaceEditor", code = 2, userInfo = null))
                    reportFailure()
                }
            } catch (_: Exception) {
                if (active(task, job)) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWorkspaceEditor", code = 3, userInfo = null))
                    reportFailure()
                }
            } finally {
                if (tasks[task] === job) tasks.remove(task)
            }
        }
        tasks[task] = job
        job.start()
    }

    private fun active(task: WKURLSchemeTaskProtocol, job: Job) = alive && tasks[task] === job

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, stopURLSchemeTask: WKURLSchemeTaskProtocol) {
        tasks.remove(stopURLSchemeTask)?.cancel()
    }

    override fun webView(webView: WKWebView, decidePolicyForNavigationAction: WKNavigationAction,
                         decisionHandler: (WKNavigationActionPolicy) -> Unit) {
        val action = decidePolicyForNavigationAction
        val requested = action.request.URL?.absoluteString.orEmpty()
        val displayed = webView.URL?.absoluteString
        val fragmentOnly = action.navigationType != WKNavigationTypeReload && '#' in requested &&
            requested.substringBefore('#') == displayed?.substringBefore('#')
        val initial = !documentNavigationStarted && requested == pendingDocumentUrl
        val allowed = alive && action.targetFrame?.mainFrame == true && action.request.HTTPMethod == "GET" &&
            path(action.request.URL) == WorkspaceEntryPath && (initial || fragmentOnly)
        if (allowed && initial) documentNavigationStarted = true
        decisionHandler(if (allowed) WKNavigationActionPolicy.WKNavigationActionPolicyAllow else WKNavigationActionPolicy.WKNavigationActionPolicyCancel)
    }

    override fun webView(webView: WKWebView, decidePolicyForNavigationResponse: WKNavigationResponse,
                         decisionHandler: (WKNavigationResponsePolicy) -> Unit) {
        val response = decidePolicyForNavigationResponse
        val allowed = alive && response.forMainFrame && response.canShowMIMEType &&
            path(response.response.URL) == WorkspaceEntryPath && response.response.MIMEType == "text/html"
        decisionHandler(if (allowed) WKNavigationResponsePolicy.WKNavigationResponsePolicyAllow else WKNavigationResponsePolicy.WKNavigationResponsePolicyCancel)
    }

    override fun webView(webView: WKWebView, createWebViewWithConfiguration: WKWebViewConfiguration,
                         forNavigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures): WKWebView? = null

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, didFailProvisionalNavigation: WKNavigation?, withError: NSError) { fail("editor_failed") }

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, didFailNavigation: WKNavigation?, withError: NSError) { fail("editor_failed") }
    override fun webViewWebContentProcessDidTerminate(webView: WKWebView) { fail("editor_failed") }

    fun close() {
        if (!alive) return
        alive = false
        session.detach(this)
        bridge.close()
        bridge.onChange = { }
        bridge.onAction = { }
        bridge.onError = { }
        loader = { null }
        onError = { }
        backgroundObserver?.let { NSNotificationCenter.defaultCenter.removeObserver(it) }
        backgroundObserver = null
        tasks.values.toList().forEach { it.cancel() }
        tasks.clear()
        scope.cancel()
        view?.let {
            it.stopLoading()
            it.navigationDelegate = null
            it.UIDelegate = null
            it.configuration.userContentController.removeScriptMessageHandlerForName(WorkspaceBridgeName)
            it.configuration.userContentController.removeAllUserScripts()
            it.configuration.userContentController.removeAllContentRuleLists()
        }
        view = null
        manifest = null
        pendingDocumentUrl = null
    }
}

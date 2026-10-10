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
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CoroutineStart
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import me.waveio.claudebot.data.WebPreviewResource
import platform.CoreGraphics.CGRectZero
import kotlinx.cinterop.readValue
import platform.Foundation.NSData
import platform.Foundation.NSError
import platform.Foundation.NSHTTPURLResponse
import platform.Foundation.NSURL
import platform.Foundation.NSURLComponents
import platform.Foundation.NSURLRequest
import platform.Foundation.NSUUID
import platform.Foundation.HTTPMethod
import platform.Foundation.valueForHTTPHeaderField
import platform.Foundation.create
import platform.WebKit.*
import platform.WebKit.WKNavigationTypeReload
import platform.darwin.NSObject

@Composable
actual fun NativeWebAppPreview(
    entry: String,
    revision: Long,
    loadResource: suspend (String) -> WebPreviewResource?,
    onError: () -> Unit,
    modifier: Modifier,
) {
    key(entry, revision) {
        val session = remember { IosPreviewSession(entry, loadResource, onError) }
        SideEffect { session.loader = loadResource; session.onError = onError }
        DisposableEffect(session) { onDispose { session.close() } }
        UIKitView(
            factory = { session.createView() },
            modifier = modifier.testTag("native-web-app-preview"),
            onRelease = { session.close() },
        )
    }
}

private const val PreviewScheme = "claudebot-preview"
private const val PreviewNetworkRules = """[
    {"trigger":{"url-filter":"^http:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^https:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^ws:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^wss:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^ftp:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^file:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":"^content:"},"action":{"type":"block"}},
    {"trigger":{"url-filter":".*"},"action":{"type":"block-cookies"}}
]"""

/** WebKit callbacks, task registration and response delivery stay on the main dispatcher. */
private class IosPreviewSession(
    entry: String,
    var loader: suspend (String) -> WebPreviewResource?,
    var onError: () -> Unit,
) : NSObject(), WKURLSchemeHandlerProtocol, WKNavigationDelegateProtocol, WKUIDelegateProtocol {
    private val entryPath = previewEntryPath(entry)
    private val host = "preview-${NSUUID().UUIDString.lowercase()}"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val tasks = mutableMapOf<WKURLSchemeTaskProtocol, Job>()
    private var alive = true
    private var errorReported = false
    private var view: WKWebView? = null
    private var pendingDocumentUrl: String? = null

    private fun path(url: NSURL?): String? {
        val parts = url?.absoluteString?.let { NSURLComponents(string = it) } ?: return null
        if (parts.scheme != PreviewScheme || parts.host != host || parts.port != null || parts.user != null || parts.password != null) return null
        return previewResourcePath(parts.percentEncodedPath.orEmpty())
    }

    private fun fail() {
        if (alive && !errorReported) { errorReported = true; onError() }
    }

    fun createView(): WKWebView {
        val config = WKWebViewConfiguration().apply {
            websiteDataStore = WKWebsiteDataStore.nonPersistentDataStore()
            preferences.javaScriptCanOpenWindowsAutomatically = false
            defaultWebpagePreferences.allowsContentJavaScript = true
            setURLSchemeHandler(this@IosPreviewSession, forURLScheme = PreviewScheme)
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
        // Fail closed: custom-scheme handling cannot intercept WebKit's built-in
        // network schemes, so install engine-level blocking before any HTML loads.
        val ruleListStore = WKContentRuleListStore.defaultStore() ?: run {
            fail()
            return web
        }
        ruleListStore.compileContentRuleListForIdentifier(
            "claudebot-preview-network-v1",
            encodedContentRuleList = PreviewNetworkRules,
        ) { rules, error ->
            scope.launch {
                if (!alive) return@launch
                val entry = entryPath
                if (rules == null || error != null || entry == null) { fail(); return@launch }
                web.configuration.userContentController.addContentRuleList(rules)
                val url = NSURLComponents().apply { scheme = PreviewScheme; host = this@IosPreviewSession.host; path = entry }.URL
                if (url == null) fail() else {
                    pendingDocumentUrl = url.absoluteString?.substringBefore('#')
                    web.loadRequest(NSURLRequest(uRL = url))
                }
            }
        }
        return web
    }

    @ObjCSignatureOverride
    override fun webView(webView: WKWebView, startURLSchemeTask: WKURLSchemeTaskProtocol) {
        val task = startURLSchemeTask
        if (!alive) return
        val request = task.request
        val url = request.URL
        val resourcePath = path(url)
        // Custom-scheme subrequests may omit mainDocumentURL. Track the allowed
        // top-level navigation explicitly so modules are never treated as HTML.
        val isDocument = url != null && url.absoluteString?.substringBefore('#') == pendingDocumentUrl
        // Consume the navigation once: fetch(location.href) is a subresource,
        // even though its URL matches the currently displayed HTML document.
        if (isDocument) pendingDocumentUrl = null
        val destination = request.valueForHTTPHeaderField("Sec-Fetch-Dest")?.trim()?.lowercase()
        val critical = isDocument || resourcePath?.let { previewCriticalAsset(it, destination = destination) } == true
        lateinit var job: Job
        job = scope.launch(start = CoroutineStart.LAZY) {
            try {
                val resource = if (resourcePath == null || request.HTTPMethod != "GET") null else {
                    val load = loader
                    withContext(Dispatchers.Default) {
                        withTimeout(PreviewResourceTimeoutMillis) {
                            var loaded = load(resourcePath)
                            if ((loaded == null || loaded.status == 404) && isDocument &&
                                resourcePath != entryPath && previewSpaRoute(resourcePath) && entryPath != null) {
                                loaded = load(entryPath)
                            }
                            loaded?.let(::guardedPreviewResource)
                        }
                    }
                }
                if (!active(task, job)) return@launch
                val htmlSubresource = !isDocument && resource?.mimeType == "text/html"
                val allowed = resource?.takeUnless {
                    htmlSubresource || isDocument && (it.status !in 200..299 || it.mimeType != "text/html") ||
                        resourcePath != null && !previewAssetMimeMatches(resourcePath, it.mimeType, destination)
                }
                val result = allowed ?: WebPreviewResource(ByteArray(0), "text/plain", if (htmlSubresource) 415 else 404)
                val response = url?.let { NSHTTPURLResponse(
                    uRL = it, statusCode = result.status.toLong(), HTTPVersion = "HTTP/1.1",
                    headerFields = PreviewResponseHeaders + ("Content-Type" to "${result.mimeType}; charset=utf-8"),
                ) }
                if (response == null) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWebAppPreview", code = 1, userInfo = null))
                } else {
                    task.didReceiveResponse(response)
                    if (!active(task, job)) return@launch
                    if (result.bytes.isNotEmpty()) result.bytes.usePinned {
                        task.didReceiveData(NSData.create(bytes = it.addressOf(0), length = result.bytes.size.toULong()))
                    }
                    if (!active(task, job)) return@launch
                    task.didFinish()
                }
                if (htmlSubresource || (allowed == null || allowed.status !in 200..299) &&
                    (critical || resourcePath?.let { previewCriticalAsset(it, resource?.mimeType, destination) } == true)) fail()
            } catch (_: CancellationException) {
                // WebKit owns canceled tasks: calling didFinish/didFail after its
                // stop callback raises an Objective-C exception.
                if (active(task, job)) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWebAppPreview", code = 2, userInfo = null))
                    if (critical) fail()
                }
            } catch (_: Exception) {
                if (active(task, job)) {
                    task.didFailWithError(NSError.errorWithDomain("NativeWebAppPreview", code = 3, userInfo = null))
                    if (critical) fail()
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
        val allowed = alive && action.targetFrame?.mainFrame == true &&
            action.request.HTTPMethod == "GET" && path(action.request.URL) != null
        if (allowed) {
            val requested = action.request.URL?.absoluteString.orEmpty()
            val displayed = webView.URL?.absoluteString
            val fragmentOnly = action.navigationType != WKNavigationTypeReload &&
                requested.substringBefore('#') == displayed?.substringBefore('#') &&
                (requested != displayed || '#' in requested)
            if (!fragmentOnly) pendingDocumentUrl = requested.substringBefore('#')
        }
        decisionHandler(if (allowed) WKNavigationActionPolicy.WKNavigationActionPolicyAllow else WKNavigationActionPolicy.WKNavigationActionPolicyCancel)
    }

    override fun webView(webView: WKWebView, decidePolicyForNavigationResponse: WKNavigationResponse,
                         decisionHandler: (WKNavigationResponsePolicy) -> Unit) {
        val response = decidePolicyForNavigationResponse
        val allowed = alive && response.forMainFrame && response.canShowMIMEType && path(response.response.URL) != null
        decisionHandler(if (allowed) WKNavigationResponsePolicy.WKNavigationResponsePolicyAllow else WKNavigationResponsePolicy.WKNavigationResponsePolicyCancel)
    }

    override fun webView(webView: WKWebView, createWebViewWithConfiguration: WKWebViewConfiguration,
                         forNavigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures): WKWebView? = null

    override fun webView(webView: WKWebView, didFailProvisionalNavigation: WKNavigation?, withError: NSError) { fail() }
    override fun webViewWebContentProcessDidTerminate(webView: WKWebView) { fail() }

    fun close() {
        if (!alive) return
        alive = false
        tasks.values.toList().forEach { it.cancel() }
        tasks.clear()
        scope.cancel()
        view?.let {
            it.stopLoading()
            it.navigationDelegate = null
            it.UIDelegate = null
            it.configuration.userContentController.removeAllUserScripts()
            it.configuration.userContentController.removeAllContentRuleLists()
        }
        view = null
    }
}

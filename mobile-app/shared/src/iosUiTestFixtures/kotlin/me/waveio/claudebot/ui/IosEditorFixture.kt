@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package me.waveio.claudebot.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.window.ComposeUIViewController
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import me.waveio.claudebot.data.WebPreviewResource
import me.waveio.claudebot.data.WorkspaceEditorDocument
import me.waveio.claudebot.data.WorkspaceEditorSession
import platform.UIKit.UIViewController

private object IosEditorFixtureState {
    val mode = mutableStateOf("markdown")
    val revision = mutableLongStateOf(0L)
    val changes = mutableStateListOf<String>()
    val errors = mutableStateListOf<String>()
    val session = mutableStateOf(WorkspaceEditorSession())
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    fun reset() {
        mode.value = "markdown"
        revision.longValue = 0L
        changes.clear()
        errors.clear()
        session.value = WorkspaceEditorSession()
    }

    fun select(value: String) {
        if (value !in setOf("markdown", "html", "drawing", "preview")) return
        mode.value = value
        revision.longValue++
        session.value = WorkspaceEditorSession()
    }
}

/** Test-only host for the actual Compose iOS editor and preview implementations. */
fun iosEditorFixtureViewController(): UIViewController {
    IosEditorFixtureState.reset()
    return ComposeUIViewController { IosEditorFixtureContent() }
}

fun iosEditorFixtureSelect(mode: String) {
    IosEditorFixtureState.scope.launch { IosEditorFixtureState.select(mode) }
}

fun iosEditorFixtureFlush(completion: (Boolean) -> Unit) {
    IosEditorFixtureState.scope.launch {
        IosEditorFixtureState.session.value.flush(completion)
    }
}

fun iosEditorFixtureChangeCount(): Int = IosEditorFixtureState.changes.size

fun iosEditorFixtureLastChange(): String? = IosEditorFixtureState.changes.lastOrNull()

fun iosEditorFixtureErrors(): String = IosEditorFixtureState.errors.joinToString(",")

@Composable
private fun IosEditorFixtureContent() {
    val mode = IosEditorFixtureState.mode.value
    val revision = IosEditorFixtureState.revision.longValue
    Column(Modifier.fillMaxSize()) {
        when (mode) {
            "preview" -> NativeWebAppPreview(
                entry = "index.html",
                revision = revision,
                loadResource = ::fixturePreviewResource,
                onError = { IosEditorFixtureState.errors += "preview_failed" },
                modifier = Modifier.fillMaxWidth().weight(1f),
            )
            else -> {
                val document = fixtureDocument(mode, revision)
                NativeWorkspaceEditor(
                    document = document,
                    session = IosEditorFixtureState.session.value,
                    onChange = { IosEditorFixtureState.changes += it },
                    onAction = {},
                    onError = { IosEditorFixtureState.errors += it },
                    loadResource = ::fixtureEditorResource,
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
            }
        }
    }
}

private fun fixtureDocument(mode: String, revision: Long) = when (mode) {
    "html" -> WorkspaceEditorDocument(
        id = "ios-ui-html-$revision",
        path = "fixtures/page.html",
        kind = "html",
        content = "<main id=\"fixture\">ready</main>\n",
    )
    "drawing" -> WorkspaceEditorDocument(
        id = "ios-ui-drawing-$revision",
        path = "fixtures/scene.excalidraw",
        kind = "drawing",
        content = """{"type":"excalidraw","version":2,"source":"blink","elements":[],"appState":{},"files":{}}""",
    )
    else -> WorkspaceEditorDocument(
        id = "ios-ui-markdown-$revision",
        path = "fixtures/note.md",
        kind = "markdown",
        content = "# Native Tiptap fixture\n\nEdit this note.",
    )
}

private suspend fun fixtureEditorResource(path: String): WebPreviewResource? = when (path) {
    "fixtures/shape.svg" -> WebPreviewResource(
        "<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'></svg>".encodeToByteArray(),
        "image/svg+xml",
    )
    else -> null
}

private suspend fun fixturePreviewResource(path: String): WebPreviewResource? = when (path) {
    "/index.html" -> WebPreviewResource(PREVIEW_HTML.encodeToByteArray(), "text/html")
    "/fixture.js" -> WebPreviewResource(
        "export const fixtureModule = 'local-module-ok';".encodeToByteArray(),
        "text/javascript",
    )
    "/fallback" -> WebPreviewResource("<p>HTML fallback</p>".encodeToByteArray(), "text/html")
    else -> null
}

private val PREVIEW_HTML = """
    <!doctype html>
    <html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head>
    <body>
      <a id="external" href="https://outside.invalid/native-preview-test">External link</a>
      <pre id="probe"></pre>
      <script>
        (() => {
          const attempts = {};
          for (const [name, build] of Object.entries({
            websocket: () => new WebSocket('wss://outside.invalid/'),
            peerConnection: () => new RTCPeerConnection(),
            worker: () => new Worker('data:text/javascript,void 0'),
            eventSource: () => new EventSource('https://outside.invalid/events'),
          })) {
            try { build(); attempts[name] = 'created'; }
            catch (error) { attempts[name] = error.name; }
          }
          let storage;
          try { localStorage.setItem('fixture', 'value'); storage = 'available'; }
          catch (error) { storage = error.name; }
          document.cookie = 'fixture=secret';
          window.fixturePreviewProbe = {
            origin: location.origin,
            bridge: Boolean(window.webkit?.messageHandlers?.BlinkNative),
            storage,
            cookie: document.cookie,
            attempts,
          };
          import('/fixture.js').then(module => {
            window.fixtureModule = module.fixtureModule;
          }).catch(error => { window.fixtureModuleError = String(error); });
          fetch('/fallback').then(response => {
            window.fixtureFallbackStatus = response.status;
            return response.text();
          }).then(text => { window.fixtureFallbackText = text; })
            .catch(error => { window.fixtureFallbackError = String(error); });
          const frame = document.createElement('iframe');
          frame.setAttribute('sandbox', 'allow-scripts');
          frame.srcdoc = `<script>parent.postMessage({kind:'child-probe', websocket:(()=>{try{new WebSocket('wss://outside.invalid')}catch(e){return e.name}})(), peerConnection:(()=>{try{new RTCPeerConnection()}catch(e){return e.name}})()}, '*')<\/script>`;
          window.addEventListener('message', event => {
            if (event.data?.kind === 'child-probe') window.fixtureChildProbe = event.data;
          });
          document.body.append(frame);
        })();
      </script>
    </body></html>
""".trimIndent()

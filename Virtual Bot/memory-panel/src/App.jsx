import React, { useState, useEffect, useCallback, useRef } from 'react'
import FileList from './components/FileList'
import Editor from './components/Editor'
import MemoryMap from './components/MemoryMap'
import { getActiveSessionId, memoryRequestPath } from './session'

const API_BASE = '/api'

async function api(path, options = {}) {
  const res = await fetch(`${API_BASE}${path}`, options)
  if (!res.ok) {
    const data = await res.json().catch(() => ({}))
    let msg = data.error || data.detail || data.message || `HTTP ${res.status}`
    if (Array.isArray(msg)) msg = msg.map((it) => (it && it.msg) || JSON.stringify(it)).join('; ')
    throw new Error(msg)
  }
  return res.json().catch(() => null)
}

function App() {
  const [files, setFiles] = useState([])
  const [currentPath, setCurrentPath] = useState(null)
  const [content, setContent] = useState('')
  const [isDirty, setIsDirty] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState(null)
  const [activeTab, setActiveTab] = useState('files')
  const [newPath, setNewPath] = useState('')
  const documentRef = useRef({ path: null, content: '', savedContent: '', revision: 0 })
  const openRequestRef = useRef({ id: 0, controller: null })
  const saveInFlightRef = useRef(false)

  const refreshFiles = useCallback(async () => {
    try {
      const data = await api(memoryRequestPath('/memory/list'))
      setFiles(data.files || [])
      setError(null)
    } catch (err) {
      setError('Не вдалося завантажити список нотаток: ' + err.message)
    }
  }, [])

  useEffect(() => {
    refreshFiles()
  }, [refreshFiles])

  useEffect(() => () => openRequestRef.current.controller?.abort(), [])

  const openFile = useCallback(async (path) => {
    if (isDirty && !confirm('Є незбережені зміни. Відкрити інший файл без збереження?')) {
      return
    }

    openRequestRef.current.controller?.abort()
    const controller = new AbortController()
    const requestId = openRequestRef.current.id + 1
    const startRevision = documentRef.current.revision
    openRequestRef.current = { id: requestId, controller }
    setIsLoading(true)
    try {
      const data = await api(memoryRequestPath('/memory/file', { path }), {
        signal: controller.signal
      })
      if (openRequestRef.current.id !== requestId) return
      if (
        documentRef.current.revision !== startRevision &&
        !confirm('Нотатку змінено під час завантаження. Відкрити інший файл і відкинути ці зміни?')
      ) {
        return
      }
      const text = typeof data === 'string' ? data : data.content ?? ''
      documentRef.current = {
        path,
        content: text,
        savedContent: text,
        revision: documentRef.current.revision + 1
      }
      setCurrentPath(path)
      setContent(text)
      setIsDirty(false)
      setError(null)
    } catch (err) {
      if (controller.signal.aborted || openRequestRef.current.id !== requestId) return
      setError('Не вдалося відкрити файл: ' + err.message)
    } finally {
      if (openRequestRef.current.id === requestId) {
        openRequestRef.current.controller = null
        setIsLoading(false)
      }
    }
  }, [isDirty])

  const saveFile = useCallback(async () => {
    if (saveInFlightRef.current) return
    const document = documentRef.current
    if (!document.path) return
    const savedPath = document.path
    const savedText = document.content
    const savedRevision = document.revision
    saveInFlightRef.current = true
    setIsSaving(true)
    try {
      await api('/memory/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: savedPath,
          content: savedText,
          session_id: getActiveSessionId()
        })
      })
      const current = documentRef.current
      if (current === document) {
        current.savedContent = savedText
        setIsDirty(current.content !== savedText || current.revision !== savedRevision)
      }
      refreshFiles()
      if (current === document) {
        setError(null)
      }
    } catch (err) {
      if (documentRef.current === document) {
        setError('Не вдалося зберегти: ' + err.message)
      }
    } finally {
      saveInFlightRef.current = false
      setIsSaving(false)
    }
  }, [refreshFiles])

  const handleContentChange = useCallback((value) => {
    const document = documentRef.current
    if (value === document.content) return
    document.content = value
    document.revision += 1
    setContent(value)
    setIsDirty(value !== document.savedContent)
  }, [])

  const createFile = useCallback(async () => {
    let path = newPath.trim()
    if (!path) return
    if (!/\.md$/i.test(path)) path += '.md'
    if (path.startsWith('/') || path.startsWith('~') || path.split('/').some((p) => p === '..' || p === '.' || p.startsWith('.'))) {
      setError('Шлях має бути відносним, без «..» і прихованих папок')
      return
    }
    if (isDirty && !confirm('Є незбережені зміни. Створити нову нотатку без збереження?')) {
      return
    }
    const defaultContent = `# ${path.split('/').pop().replace(/\.md$/i, '')}\n\n`
    openRequestRef.current.controller?.abort()
    openRequestRef.current = { id: openRequestRef.current.id + 1, controller: null }
    documentRef.current = {
      path,
      content: defaultContent,
      savedContent: '',
      revision: documentRef.current.revision + 1
    }
    setIsLoading(false)
    setCurrentPath(path)
    setContent(defaultContent)
    setIsDirty(true)
    setNewPath('')
  }, [newPath, isDirty])

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 's' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        saveFile()
      }
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [saveFile])

  return (
    <div className="memory-app">
      <div className="memory-sidebar">
        <div className="memory-tabs" role="tablist" aria-label="Розділи пам'яті">
          <button
            type="button"
            role="tab"
            id="memory-tab-files"
            aria-controls="memory-panel-files"
            aria-selected={activeTab === 'files'}
            className={activeTab === 'files' ? 'active' : ''}
            onClick={() => setActiveTab('files')}
          >
            Нотатки
          </button>
          <button
            type="button"
            role="tab"
            id="memory-tab-map"
            aria-controls="memory-panel-map"
            aria-selected={activeTab === 'map'}
            className={activeTab === 'map' ? 'active' : ''}
            onClick={() => setActiveTab('map')}
          >
            Карта пам'яті
          </button>
        </div>

        {activeTab === 'files' && (
          <div
            className="memory-tab-panel"
            role="tabpanel"
            id="memory-panel-files"
            aria-labelledby="memory-tab-files"
          >
            <div className="memory-new">
              <label htmlFor="memory-new-path">Шлях нової нотатки</label>
              <input
                id="memory-new-path"
                type="text"
                value={newPath}
                onChange={(e) => setNewPath(e.target.value)}
                placeholder="topics/nova-notatka.md"
                onKeyDown={(e) => e.key === 'Enter' && createFile()}
              />
              <button type="button" onClick={createFile} aria-label="Створити нотатку">＋</button>
            </div>
            <FileList files={files} currentPath={currentPath} onSelect={openFile} />
          </div>
        )}

        {activeTab === 'map' && (
          <div
            className="memory-tab-panel"
            role="tabpanel"
            id="memory-panel-map"
            aria-labelledby="memory-tab-map"
          >
            <MemoryMap onSelect={openFile} />
          </div>
        )}
      </div>

      <div className="memory-main" aria-busy={isLoading}>
        {currentPath ? (
          <Editor
            key={currentPath}
            path={currentPath}
            content={content}
            isDirty={isDirty}
            isSaving={isSaving}
            onChange={handleContentChange}
            onSave={saveFile}
            onSelect={openFile}
          />
        ) : (
          <div className="memory-empty">
            <div className="memory-empty-title">Пам'ять</div>
            <p>Оберіть нотатку зліва або створіть нову.</p>
            <p className="memory-empty-hint">Карта пам'яті показує категорії від dream_cycle: люди, життя, теми, улюбленці.</p>
          </div>
        )}
      </div>

      {error && (
        <button
          type="button"
          className="memory-error"
          aria-live="assertive"
          aria-label={`Закрити повідомлення про помилку: ${error}`}
          onClick={() => setError(null)}
        >
          {error}
        </button>
      )}
    </div>
  )
}

export default App

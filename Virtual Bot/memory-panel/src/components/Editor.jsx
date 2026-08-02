import React, { useEffect, useRef, useState } from 'react'
import { Milkdown, useEditor, MilkdownProvider } from '@milkdown/react'
import { Crepe } from '@milkdown/crepe'
import '../crepe-theme/common/style.css'
import '../crepe-theme/nord/style.css'

const DURABLE_CATEGORIES = new Set(['people', 'life', 'topics', 'pets'])
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i
const EXTERNAL_SCHEME_RE = /\b(?:https?|ftp):\/\//gi
const BARE_WWW_RE = /\bwww\./gi

function findClosingDelimiter(value, start, opening, closing) {
  let depth = 1
  let escaped = false
  for (let index = start; index < value.length; index += 1) {
    const character = value[index]
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === opening) depth += 1
    if (character === closing) depth -= 1
    if (depth === 0) return index
  }
  return -1
}

function neutralizeMarkdownLinks(content, currentPath) {
  let result = ''
  let index = 0
  while (index < content.length) {
    const isImage = content[index] === '!' && content[index + 1] === '['
    const isLink = content[index] === '['
    if (!isImage && !isLink) {
      result += content[index]
      index += 1
      continue
    }

    const labelStart = index + (isImage ? 2 : 1)
    const labelEnd = findClosingDelimiter(content, labelStart, '[', ']')
    if (labelEnd === -1) {
      result += content[index]
      index += 1
      continue
    }

    const destinationStart = labelEnd + 1
    const opener = content[destinationStart]
    if (opener !== '(' && opener !== '[') {
      if (isImage) {
        result += content.slice(labelStart, labelEnd)
        index = labelEnd + 1
      } else {
        result += content[index]
        index += 1
      }
      continue
    }
    const closer = opener === '(' ? ')' : ']'
    const destinationEnd = findClosingDelimiter(content, destinationStart + 1, opener, closer)
    if (destinationEnd === -1) {
      result += content[index]
      index += 1
      continue
    }

    const label = content.slice(labelStart, labelEnd)
    const destination = content.slice(destinationStart + 1, destinationEnd).trim()
    if (isImage || opener === '[' || !resolveMemoryLink(currentPath, destination)) {
      result += neutralizeMarkdownLinks(label, currentPath)
    } else {
      // Sanitize nested markup before preserving an allowed memory link.
      result += `[${neutralizeMarkdownLinks(label, currentPath)}](${destination})`
    }
    index = destinationEnd + 1
  }
  return result
}

function sanitizePreviewContent(content, currentPath) {
  return neutralizeMarkdownLinks(
    content.replaceAll('<', '&lt;').replaceAll('>', '&gt;'),
    currentPath
  )
    .replace(EXTERNAL_SCHEME_RE, (scheme) => scheme.replace(':', '&#58;'))
    .replace(BARE_WWW_RE, (prefix) => `${prefix.slice(0, -1)}&#46;`)
}

function resolveMemoryLink(currentPath, href) {
  let decodedHref
  try {
    decodedHref = decodeURIComponent(href)
  } catch {
    return null
  }

  if (
    !decodedHref ||
    SCHEME_RE.test(decodedHref) ||
    decodedHref.startsWith('//') ||
    decodedHref.startsWith('/') ||
    decodedHref.includes('\\') ||
    decodedHref.includes('\0') ||
    decodedHref.includes('?') ||
    decodedHref.includes('#') ||
    !decodedHref.toLowerCase().endsWith('.md')
  ) {
    return null
  }

  const components = []
  const pathComponents = [
    ...currentPath.split('/').slice(0, -1),
    ...decodedHref.split('/')
  ]
  for (const component of pathComponents) {
    if (!component || component === '.') continue
    if (component === '..') {
      if (components.length === 0) return null
      components.pop()
      continue
    }
    components.push(component)
  }

  const result = components.join('/')
  const filename = components.at(-1)?.toLowerCase()
  if (
    components.length < 2 ||
    !DURABLE_CATEGORIES.has(components[0]) ||
    components.some((component) => component.toLowerCase() === 'logs') ||
    filename === '_index.md' ||
    result === currentPath
  ) {
    return null
  }

  return result
}

// Source editing keeps all untrusted Markdown out of Milkdown's editable DOM
// while preserving the exact note text for saving.
function SafeTextEditor({ content, onChange }) {
  return (
    <textarea
      className="editor-source"
      aria-label="Вміст нотатки"
      value={content}
      onChange={(event) => onChange(event.target.value)}
      spellCheck="false"
    />
  )
}

function PreviewNavigation({ currentPath, onSelect, children }) {
  const previewRef = useRef(null)

  useEffect(() => {
    const node = previewRef.current
    if (!node) return undefined
    const memoryTargets = new WeakMap()

    const sanitizePreview = () => {
      node.querySelectorAll('a').forEach((anchor) => {
        const href = anchor.getAttribute('href')
        const targetPath = memoryTargets.get(anchor) || (
          href === null ? null : resolveMemoryLink(currentPath, href)
        )
        anchor.removeAttribute('target')
        anchor.removeAttribute('download')
        anchor.removeAttribute('ping')
        if (targetPath) {
          memoryTargets.set(anchor, targetPath)
          anchor.dataset.memoryPath = targetPath
          anchor.setAttribute('href', `#memory/${encodeURIComponent(targetPath)}`)
          return
        }
        delete anchor.dataset.memoryPath
        anchor.removeAttribute('href')
        anchor.setAttribute('aria-disabled', 'true')
        anchor.setAttribute('tabindex', '-1')
      })

      node.querySelectorAll('img, video, audio, source, iframe, embed, object').forEach((media) => {
        media.removeAttribute('src')
        media.removeAttribute('srcset')
        media.removeAttribute('data')
        media.removeAttribute('poster')
        if (media.matches('video, audio')) {
          media.removeAttribute('autoplay')
          media.pause?.()
        }
      })
    }

    sanitizePreview()
    const observer = new MutationObserver(sanitizePreview)
    observer.observe(node, { childList: true, subtree: true })

    const blockAnchorAction = (event) => {
      const anchor = event.target.closest?.('a')
      if (!anchor || !node.contains(anchor)) return

      event.preventDefault()
      event.stopPropagation()
      const isPrimaryClick = event.type === 'click' && event.button === 0
      const isKeyboardActivation = event.type === 'keydown'
      if (!isPrimaryClick && !isKeyboardActivation) return
      const targetPath = anchor.dataset.memoryPath
      if (targetPath) onSelect(targetPath)
    }

    const blockAnchorKey = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      blockAnchorAction(event)
    }

    node.addEventListener('click', blockAnchorAction)
    node.addEventListener('auxclick', blockAnchorAction)
    node.addEventListener('contextmenu', blockAnchorAction)
    node.addEventListener('keydown', blockAnchorKey)
    return () => {
      observer.disconnect()
      node.removeEventListener('click', blockAnchorAction)
      node.removeEventListener('auxclick', blockAnchorAction)
      node.removeEventListener('contextmenu', blockAnchorAction)
      node.removeEventListener('keydown', blockAnchorKey)
    }
  }, [currentPath, onSelect])

  return <div ref={previewRef} className="editor-preview">{children}</div>
}

function Editor({ path, content, isDirty, isSaving, onChange, onSave, onSelect }) {
  const [mode, setMode] = useState('edit')

  return (
    <div className="editor">
      <div className="editor-header">
        <div className="editor-path" title={path}>
          {path}
          {isDirty && <span className="editor-dirty">●</span>}
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className={mode === 'preview' ? 'active' : ''}
            onClick={() => setMode('preview')}
          >
            Превью
          </button>
          <button
            type="button"
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => setMode('edit')}
          >
            Редагувати
          </button>
          <button
            type="button"
            className="editor-save"
            onClick={onSave}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? 'Збереження…' : 'Зберегти'}
          </button>
        </div>
      </div>

      <div className="editor-body">
        {mode === 'edit' ? (
          <SafeTextEditor content={content} onChange={onChange} />
        ) : (
          <MilkdownProvider>
            <PreviewNavigation currentPath={path} onSelect={onSelect}>
              <MilkdownPreview content={content} currentPath={path} />
            </PreviewNavigation>
          </MilkdownProvider>
        )}
      </div>
    </div>
  )
}

function MilkdownPreview({ content, currentPath }) {
  useEditor((root) => {
    return new Crepe({
      root,
      defaultValue: sanitizePreviewContent(content, currentPath),
      features: {
        [Crepe.Feature.BlockEdit]: false,
        [Crepe.Feature.BlockHandle]: false,
        [Crepe.Feature.Cursor]: false,
        [Crepe.Feature.History]: false,
        [Crepe.Feature.LinkTooltip]: false,
        [Crepe.Feature.ListItem]: true,
        [Crepe.Feature.Menubar]: false,
        [Crepe.Feature.Placeholder]: false,
        [Crepe.Feature.Table]: true,
        [Crepe.Feature.Toolbar]: false,
      },
      editable: () => false
    })
  }, [])

  return <Milkdown />
}

export default Editor

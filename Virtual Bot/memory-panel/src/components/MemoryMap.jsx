import React, { useEffect, useState } from 'react'

const CATEGORIES = [
  { key: 'people', label: 'Люди' },
  { key: 'life', label: 'Життя' },
  { key: 'topics', label: 'Теми' },
  { key: 'pets', label: 'Улюбленці' }
]

const INDEX_RE = /^-\s*\[([^\]]+)\]\(([^)]+)\)\s*-?\s*(.*)$/m
const SCHEME_RE = /^[a-z][a-z\d+.-]*:/i

function decodeIndexFilename(value) {
  let filename
  try {
    filename = decodeURIComponent(value.trim())
  } catch {
    return null
  }

  if (
    !filename ||
    filename === '.' ||
    filename === '..' ||
    filename.includes('/') ||
    filename.includes('\\') ||
    filename.includes('\0') ||
    filename.includes('?') ||
    filename.includes('#') ||
    SCHEME_RE.test(filename) ||
    !filename.toLowerCase().endsWith('.md') ||
    filename.toLowerCase() === '_index.md'
  ) {
    return null
  }

  return filename
}

function parseIndex(text) {
  if (!text) return []
  return text.split('\n').map((line, i) => {
    const match = line.match(INDEX_RE)
    if (!match) return null
    const [, title, encodedFilename, description] = match
    const filename = decodeIndexFilename(encodedFilename)
    if (!filename) return null
    return { title, filename, description, key: `${i}-${filename}` }
  }).filter(Boolean)
}

function MemoryMap({ onSelect }) {
  const [indexes, setIndexes] = useState({})
  const [errors, setErrors] = useState({})
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    async function load() {
      const results = await Promise.all(CATEGORIES.map(async (cat) => {
        try {
          const res = await fetch(`/api/memory/file?path=${cat.key}/_index.md`, {
            signal: controller.signal
          })
          if (!res.ok) {
            if (res.status === 404) {
              return { key: cat.key, items: [], error: null }
            }
            throw new Error(`HTTP ${res.status}`)
          }
          const data = await res.json()
          const text = typeof data === 'string' ? data : data.content || ''
          return { key: cat.key, items: parseIndex(text), error: null }
        } catch (err) {
          if (err.name === 'AbortError') {
            return { key: cat.key, items: [], error: null }
          }
          return { key: cat.key, items: [], error: err.message }
        }
      }))

      if (controller.signal.aborted) return

      setIndexes(Object.fromEntries(results.map(({ key, items }) => [key, items])))
      setErrors(Object.fromEntries(results.reduce((entries, { key, error }) => {
        if (error) entries.push([key, error])
        return entries
      }, [])))
      setLoading(false)
    }
    load()

    return () => controller.abort()
  }, [])

  if (loading) return <div className="memory-map-loading">Завантаження карти…</div>

  return (
    <div className="memory-map">
      {CATEGORIES.map((cat) => (
        <div key={cat.key} className="memory-map-col">
          <h4>{cat.label}</h4>
          {errors[cat.key] && (
            <div className="memory-map-error">{errors[cat.key]}</div>
          )}
          <ul>
            {indexes[cat.key].length === 0 ? (
              <li className="empty">— порожньо —</li>
            ) : (
              indexes[cat.key].map((item) => (
                <li key={item.key}>
                  <button
                    type="button"
                    className="memory-map-item"
                    onClick={() => onSelect(`${cat.key}/${item.filename}`)}
                    title={item.description || item.title}
                  >
                    <span className="map-title">{item.title}</span>
                    {item.description && (
                      <span className="map-desc">{item.description}</span>
                    )}
                  </button>
                </li>
              ))
            )}
          </ul>
        </div>
      ))}
    </div>
  )
}

export default MemoryMap

import React from 'react'

function FileList({ files, currentPath, onSelect }) {
  if (!files || files.length === 0) {
    return <div className="file-list-empty">Нотаток поки немає</div>
  }

  return (
    <ul className="file-list">
      {files.map((file) => {
        const path = file.path || file
        const title = file.title || path.split('/').pop()
        const isActive = path === currentPath
        return (
          <li key={path}>
            <button
              type="button"
              className={isActive ? 'active' : ''}
              onClick={() => onSelect(path)}
              title={path}
            >
              <span className="file-title">{title}</span>
              <span className="file-path">{path}</span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export default FileList

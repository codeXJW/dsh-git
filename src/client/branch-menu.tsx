/**
 * @daxu8972/dsh-git — 分支弹层（IDEA 分支部件式）。
 * 搜索过滤 / 新建分支 / 本地分支点击切换（悬停 ✕ 删除）/ 远程分支点击建立跟踪分支。
 */
import { useState } from 'react'
import type { BranchInfo } from './types.js'
import { BusyButton } from './ui.js'

export function BranchMenu({ info, busy, onClose, onSwitch, onCreate, onDelete }: {
  info: BranchInfo
  /** 当前正在执行的分支操作标识（switch/create/delete:<name>），用于行内 loading/禁用。 */
  busy: string | null
  onClose: () => void
  onSwitch: (branch: string) => void
  onCreate: (name: string) => void
  onDelete: (branch: string) => void
}): React.ReactNode {
  const [filter, setFilter] = useState('')
  const [newName, setNewName] = useState('')
  const f = filter.trim().toLowerCase()
  const locals = info.branches.filter((b) => !f || b.toLowerCase().includes(f))
  const remotes = info.remotes.filter((b) => !f || b.toLowerCase().includes(f))

  return (
    <div className="branch-menu" onClick={(e) => e.stopPropagation()}>
      <div className="menu-search">
        <input
          type="text"
          placeholder="搜索或输入新分支名，回车创建…"
          value={filter}
          autoFocus
          onChange={(e) => setFilter(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && filter.trim() && !info.branches.includes(filter.trim())) {
              onCreate(filter.trim())
            } else if (e.key === 'Escape') {
              onClose()
            }
          }}
        />
        <BusyButton
          className="primary"
          loading={busy === 'create'}
          disabled={!filter.trim() || info.branches.includes(filter.trim())}
          title={filter.trim() && !info.branches.includes(filter.trim()) ? `从 ${info.current || '当前 HEAD'} 新建分支` : '输入一个不存在的分支名'}
          onClick={() => { if (filter.trim()) onCreate(filter.trim()) }}
        >新建</BusyButton>
      </div>

      <div className="menu-title">本地分支</div>
      {locals.length === 0 && <div className="menu-empty">（无匹配分支）</div>}
      {locals.map((b) => (
        <div
          key={b}
          className={'branch-row' + (b === info.current ? ' current' : '')}
          title={b === info.current ? '当前分支' : `切换到 ${b}`}
          onClick={() => { if (b !== info.current) onSwitch(b) }}
        >
          <span className="tick">{b === info.current ? '✓' : ''}</span>
          <span className="bn">{b}</span>
          {b !== info.current && (
            <button
              className="del"
              title={`删除分支 ${b}（未合并会失败，可稍后强删）`}
              onClick={(e) => { e.stopPropagation(); onDelete(b) }}
              disabled={busy === `delete:${b}`}
            >✕</button>
          )}
        </div>
      ))}

      {remotes.length > 0 && (
        <>
          <div className="menu-title">远程分支（点击检出为本地跟踪分支）</div>
          {remotes.map((b) => {
            const localName = b.includes('/') ? b.slice(b.indexOf('/') + 1) : b
            const existsLocally = info.branches.includes(localName)
            return (
              <div
                key={b}
                className="branch-row"
                title={existsLocally ? `本地已有 ${localName}` : `检出 ${b} 为本地分支 ${localName}`}
                onClick={() => { if (!existsLocally) onSwitch(localName) }}
                style={existsLocally ? { opacity: 0.55 } : undefined}
              >
                <span className="tick" />
                <span className="bn">{b}</span>
              </div>
            )
          })}
        </>
      )}
    </div>
  )
}

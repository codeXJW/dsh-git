/**
 * @daxu8972/dsh-git — client 通用小件：API 封装、diff 渲染、按钮、折叠分组、文件行。
 */
import type { GitFile } from './types.js'

export const API = '/@daxu8972/dsh-git/api'

export async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(API + path, init)
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) throw new Error(j?.error || j?.stderr || `HTTP ${res.status}`)
  return j
}

/** 取路径最后一段做展示。 */
export function short(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

export function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

/** diff 文本 → 带行级着色的 HTML（+绿 −红 @@hunk 蓝 元信息灰）。 */
export function diffHtml(d: string): string {
  return String(d || '').split('\n').map((line) => {
    if (line.startsWith('@@')) return `<span class="dhunk">${esc(line)}</span>`
    if (line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++ ') || line.startsWith('--- ') || line.startsWith('new file') || line.startsWith('deleted file')) {
      return `<span class="dmeta">${esc(line)}</span>`
    }
    if (line.startsWith('+')) return `<span class="dplus">${esc(line)}</span>`
    if (line.startsWith('-')) return `<span class="dminus">${esc(line)}</span>`
    return esc(line)
  }).join('\n')
}

/** 状态字母 →（字母，着色类）。A/U 新增绿、M/T 修改琥珀、D 删除红、R/C 重命名紫。 */
export function statusMeta(f: GitFile, listKind: 'staged' | 'unstaged' | 'untracked'): { letter: string; cls: string } {
  const letter = listKind === 'staged' ? (f.index || 'M') : listKind === 'untracked' ? 'U' : (f.worktree || 'M')
  const cls = 'AM'.includes(letter) || letter === 'U'
    ? 'st-a'
    : letter === 'D' ? 'st-d'
      : 'RC'.includes(letter) ? 'st-r' : 'st-m'
  return { letter, cls }
}

/** 时间格式化：`2026-08-28 10:00:00 +0800` → `08-28 10:00`。 */
export function shortDate(iso: string): string {
  const m = /(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(iso || '')
  return m ? `${m[2]}-${m[3]} ${m[4]}:${m[5]}` : iso
}

/** 内嵌 loading 的按钮。 */
export function BusyButton({ loading, disabled, onClick, children, className, title }: {
  loading?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
  title?: string
}): React.ReactNode {
  return (
    <button
      className={[className, loading ? 'loading' : ''].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      onClick={onClick}
      title={title}
    >
      {loading && <span className="spinner" />}
      {children}
    </button>
  )
}

/** 无边框小图标按钮（工具栏用）。 */
export function IconBtn({ icon, title, onClick, disabled, loading, badge }: {
  icon: React.ReactNode
  title: string
  onClick: () => void
  disabled?: boolean
  loading?: boolean
  badge?: React.ReactNode
}): React.ReactNode {
  return (
    <button className="iconbtn" onClick={onClick} disabled={disabled} title={title}>
      {loading ? <span className="spinner" /> : icon}
      {badge}
    </button>
  )
}

/** 可折叠分组（VSCode 源代码管理式）：点标题收展，标题右侧操作区。 */
export function Section({ title, count, closed, onCaret, actions, children }: {
  title: string
  count: number
  closed: boolean
  onCaret: () => void
  actions?: React.ReactNode
  children: React.ReactNode
}): React.ReactNode {
  return (
    <section className={'section' + (closed ? ' closed' : '')}>
      <header onClick={onCaret}>
        <span className="caret">▼</span>
        <span>{title}</span>
        <span className="cnt">({count})</span>
        <span className="hd-ops" onClick={(e) => e.stopPropagation()}>{actions}</span>
      </header>
      <div className="body">{children}</div>
    </section>
  )
}

/** 单个文件行：复选框 + 状态字母 + 路径 + 悬停操作。 */
export function FileRow({ f, listKind, checked, selected, onPick, onToggle, ops }: {
  f: GitFile
  listKind: 'staged' | 'unstaged' | 'untracked'
  checked: boolean
  selected: boolean
  onPick: () => void
  onToggle: () => void
  ops: Array<{ icon: string; title: string; onClick: () => void; danger?: boolean }>
}): React.ReactNode {
  const st = statusMeta(f, listKind)
  return (
    <div className={'file' + (selected ? ' selected' : '')} onClick={onPick} title={f.path}>
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        onClick={(e) => e.stopPropagation()}
      />
      <span className={'st ' + st.cls}>{st.letter}</span>
      <span className="name">{f.path}</span>
      <span className="ops">
        {ops.map((op) => (
          <button
            key={op.icon + op.title}
            className={op.danger ? 'danger' : ''}
            title={op.title}
            onClick={(e) => { e.stopPropagation(); op.onClick() }}
          >{op.icon}</button>
        ))}
      </span>
    </div>
  )
}

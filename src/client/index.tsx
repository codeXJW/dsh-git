/**
 * @dsh-external/dsh-git — client Git 面板（React 组件）。
 *
 * 挂到 `conversation.view` 槽（会话标签页环，Chat 之外多一个 Git 页）。
 * 槽组件契约 = React 组件（(props) => ReactNode），因此这里是标准的
 * React 函数组件 + hooks，数据来自 host 的 `@dsh-external/dsh-git/api` 端点。
 */
import { useEffect, useRef, useState } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
  effect(fn: () => (() => void) | void, label?: string): void
}

export const inject = ['slots']

const API = '/@dsh-external/dsh-git/api'

interface GitFile { index: string; worktree: string; path: string }
interface RepoStatus {
  branch: string
  ahead: number
  behind: number
  hasRemote: boolean
  hasCommits: boolean
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  total: number
}

/* ── CSS（局部，用 DSH 设计 token） ─────────────────────────── */
const CSS = `
.dsh-git{font:13px/1.6 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328);padding:6px;max-width:1100px;margin:0 auto;width:100%;box-sizing:border-box}
.dsh-git h2{font-size:15px;margin:0 0 8px;font-weight:600}
.dsh-git .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.dsh-git button{font:inherit;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;cursor:pointer}
.dsh-git button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git button.primary{background:var(--dsw-alias-brand-primary,#2b5fdc);color:#fff;border-color:transparent}
.dsh-git button:disabled{opacity:.5;cursor:default}
.dsh-git select,.dsh-git input[type=text]{font:inherit;padding:4px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;box-sizing:border-box}
.dsh-git select{width:auto;flex:1}
.dsh-git .bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dsh-git .meta{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px}
.dsh-git .err{color:#cf222e;background:rgba(207,34,46,.08);padding:6px 9px;border-radius:7px;margin:6px 0}
.dsh-git .ok{color:#1a7f37;background:rgba(26,127,55,.08);padding:6px 9px;border-radius:7px;margin:6px 0;white-space:pre-wrap}
.dsh-git section{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;margin:8px 0;overflow:hidden}
.dsh-git section>h3{margin:0;padding:6px 10px;font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .file{display:flex;gap:8px;align-items:center;padding:5px 10px;cursor:pointer}
.dsh-git .file:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .file.selected{background:var(--dsw-alias-bg-layer-3,#eaeef2)}
.dsh-git .file .tag{width:14px;font-size:12px;flex:none;color:var(--dsw-alias-label-tertiary,#6e7781)}
.dsh-git .file .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git .file .icon{width:12px;text-align:center;margin-right:6px}
.dsh-git .empty{padding:8px 10px;color:var(--dsw-alias-label-tertiary,#6e7781)}
.dsh-git pre{margin:0;padding:8px 10px;overflow:auto;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-1,#f6f8fa);white-space:pre-wrap;word-break:break-all;max-height:40vh}
.dsh-git .dplus{color:#1a7f37}.dsh-git .dminus{color:#cf222e}
.dsh-git .pill{display:inline-block;font-size:11px;border-radius:9px;padding:0 8px;background:var(--dsw-alias-bg-layer-3,#eaeef2)}
.dsh-git .spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:6px;animation:dshGitSpin .7s linear infinite}
@keyframes dshGitSpin{to{transform:rotate(360deg)}}
.dsh-git button.loading{opacity:.65;cursor:progress}
.dsh-git .dsh-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:8px;font:13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);animation:dshToastIn .2s ease}
.dsh-git .dsh-toast.ok{background:#1a7f37;color:#fff}
.dsh-git .dsh-toast.err{background:#cf222e;color:#fff}
@keyframes dshToastIn{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
.dsh-git .split{display:grid;grid-template-columns:minmax(0,340px) minmax(0,1fr);gap:10px;align-items:start;margin:8px 0}
.dsh-git .split .files{height:calc(100vh - 320px);display:flex;flex-direction:column;gap:8px}
.dsh-git .split .files section{margin:0;flex:1;min-height:0;display:flex;flex-direction:column}
.dsh-git .split .files section>h3{flex:none}
.dsh-git .split .files .file-list{flex:1;min-height:0;overflow-y:auto}
.dsh-git .split .detail{position:sticky;top:0}
.dsh-git .split .detail section{margin:0}
.dsh-git .split .detail pre{max-height:calc(100vh - 340px)}
@media (max-width:700px){.dsh-git .split{grid-template-columns:1fr}}
`

/* ── 工具 ────────────────────────────────────────────────────── */
function short(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}
function gitIcon(ix: string): string {
  if (ix === '?') return '▸'
  if (ix === 'A') return '+'
  if (ix === 'D') return '−'
  if (ix === 'R') return '→'
  return '~'
}
function diffHtml(d: string): string {
  const lines = String(d || '').split('\n')
  return lines.map((line) => {
    const cls = line.startsWith('+') ? 'dplus' : line.startsWith('-') ? 'dminus' : ''
    return cls ? `<span class="${cls}">${esc(line)}</span>` : esc(line)
  }).join('\n')
}
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(API + path, init)
  const j = await res.json().catch(() => ({}))
  if (!res.ok || j?.ok === false) throw new Error(j?.error || `HTTP ${res.status}`)
  return j
}

function FileList({ title, files, selected, checked, onPick, onToggleAll, onToggle, onStage, onStageAll, onUnstage, onUnstageAll, onRestore, onRestoreAll }: {
  title: string
  files: GitFile[]
  selected: string | null
  checked: ReadonlySet<string>
  onPick: (p: string) => void
  onToggleAll: (toggleOn: boolean) => void
  onToggle: (p: string) => void
  onStage?: (p: string) => void
  onStageAll?: () => void
  onUnstage?: (p: string) => void
  onUnstageAll?: () => void
  onRestore?: (p: string) => void
  onRestoreAll?: () => void
}) {
  if (!files.length) return null
  const allChecked = files.length > 0 && files.every((f) => checked.has(f.path))
  const btnStyle = (color: string): React.CSSProperties => ({
    flex: 'none', fontSize: 12, padding: '0 6px', borderRadius: 5, lineHeight: '18px',
    color, border: `1px solid ${color}22`, background: 'transparent', cursor: 'pointer', opacity: 0.7,
  })
  return (
    <section>
      <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <input
          type="checkbox"
          checked={allChecked}
          onChange={(e) => onToggleAll(e.target.checked)}
          title={allChecked ? '取消全选' : '全选'}
          style={{ margin: 0, width: 14, height: 14, cursor: 'pointer' }}
        />
        <span>{title + ' (' + files.length + ')'}</span>
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {onStageAll && (
            <button
              onClick={(e) => { e.stopPropagation(); onStageAll() }}
              title="暂存全部文件"
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 5, color: '#1a7f37', border: '1px solid rgba(26,127,55,.2)', background: 'rgba(26,127,55,.04)', cursor: 'pointer' }}
            >暂存全部</button>
          )}
          {onUnstageAll && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnstageAll() }}
              title="取消暂存全部"
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 5, color: '#cf222e', border: '1px solid rgba(207,34,46,.2)', background: 'rgba(207,34,46,.04)', cursor: 'pointer' }}
            >取消暂存</button>
          )}
          {onRestoreAll && (
            <button
              onClick={(e) => { e.stopPropagation(); onRestoreAll() }}
              title="回滚所有未暂存改动"
              style={{ fontSize: 11, padding: '1px 8px', borderRadius: 5, color: '#cf222e', border: '1px solid rgba(207,34,46,.2)', background: 'rgba(207,34,46,.04)', cursor: 'pointer' }}
            >全部回滚</button>
          )}
        </span>
      </h3>
      <div className="file-list">
      {files.map((f) => (
        <div
          key={f.path}
          className={'file' + (f.path === selected ? ' selected' : '')}
          onClick={() => onPick(f.path)}
          title={f.path}
        >
          <input
            type="checkbox"
            checked={checked.has(f.path)}
            onChange={(e) => onToggle(f.path)}
            onClick={(e) => e.stopPropagation()}
            style={{ width: 14, height: 14, cursor: 'pointer', flex: 'none' }}
          />
          <span className="icon">{gitIcon(f.index)}</span>
          <span className="name">{f.path}</span>
          {onStage && (
            <button
              onClick={(e) => { e.stopPropagation(); onStage(f.path) }}
              title={'暂存 ' + f.path}
              style={btnStyle('#1a7f37')}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7' }}
            >+</button>
          )}
          {onUnstage && (
            <button
              onClick={(e) => { e.stopPropagation(); onUnstage(f.path) }}
              title={'取消暂存 ' + f.path}
              style={btnStyle('#cf222e')}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7' }}
            >−</button>
          )}
          {onRestore && (
            <button
              onClick={(e) => { e.stopPropagation(); onRestore(f.path) }}
              title={'回滚 ' + f.path}
              style={btnStyle('#cf222e')}
              onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1' }}
              onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0.7' }}
            >↩</button>
          )}
        </div>
      ))}
      </div>
    </section>
  )
}

/* ── 按钮（内嵌 loading） ─────────────────────────────────── */
function BusyButton({ loading, disabled, onClick, children, className }: {
  loading: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
  className?: string
}): React.ReactNode {
  return (
    <button
      className={[className, loading ? 'loading' : ''].filter(Boolean).join(' ')}
      disabled={disabled || loading}
      onClick={onClick}
    >
      {loading && <span className="spinner" />}
      {children}
    </button>
  )
}

/* ── 面板主组件 ─────────────────────────────────────────────── */
export function GitPanel(props: { sessionId?: string }): React.ReactNode {
  const sessionId = props.sessionId ?? ''
  const [repos, setRepos] = useState<string[]>([])
  const [repo, setRepo] = useState<string>('')
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [diff, setDiff] = useState('')
  const [selFile, setSelFile] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [showLog, setShowLog] = useState(false)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const [msg, setMsg] = useState('')
  const [busyCmd, setBusyCmd] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const repoRef = useRef('')
  const sessionRef = useRef(sessionId)
  const [branches, setBranches] = useState<string[]>([])
  const [currentBranch, setCurrentBranch] = useState('')
  const [showNewBranch, setShowNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')

  const showToast = (kind: 'ok' | 'err', text: string): void => {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }


  useEffect(() => { sessionRef.current = sessionId }, [sessionId])
  useEffect(() => { repoRef.current = repo }, [repo])

  const loadRepos = async (): Promise<void> => {
    try {
      const q = sessionRef.current ? `?session=${encodeURIComponent(sessionRef.current)}` : ''
      const j = await api(`/repos${q}`)
      const list = j.repos ?? []
      setRepos(list)
      if (list.length) { setRepo(list[0]); repoRef.current = list[0] }
    } catch (e) { setError(String((e as Error).message || e)) }
  }

  useEffect(() => { void loadRepos() }, [sessionId])

  const refresh = async (): Promise<void> => {
    const r = repoRef.current
    if (!r) { setStatus(null); return }
    setError(null); setBusyCmd('refresh')
    try {
      // status 和 branches 独立请求：一个失败不影响另一个
      const statusP = api(`/status?path=${encodeURIComponent(r)}&session=${encodeURIComponent(sessionRef.current)}`).catch(() => null)
      const branchesP = api(`/branches?path=${encodeURIComponent(r)}&session=${encodeURIComponent(sessionRef.current)}`).catch(() => null)
      const [statusJ, branchesJ] = await Promise.all([statusP, branchesP])
      if (statusJ) {
        setStatus(statusJ.status)
      } else {
        setStatus(null)
        setError('读取仓库状态失败')
      }
      if (branchesJ) {
        setBranches(branchesJ.branches ?? [])
        setCurrentBranch(branchesJ.current ?? '')
      }
    } catch (e) { setStatus(null); setError(String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
  }

  useEffect(() => { if (repo) void refresh() }, [repo])

  const pick = async (p: string, staged = false): Promise<void> => {
    setSelFile(p); setBusyCmd('diff')
    try {
      const j = await api(`/diff?path=${encodeURIComponent(repoRef.current)}&file=${encodeURIComponent(p)}&session=${encodeURIComponent(sessionRef.current)}${staged ? '&staged=1' : ''}`)
      setDiff(j.diff || '（无差异）')
    } catch (e) { setDiff(`读取失败：${String((e as Error).message || e)}`) }
    finally { setBusyCmd(null) }
  }

  const SUCCESS_MSG: Record<string, string> = {
    commit: '已提交',
    push: '已推送',
    pull: '已拉取',
    fetch: '已 Fetch',
    add: '已暂存',
  }

  const runOp = async (cmd: string, args: string[]): Promise<void> => {
    if (!repoRef.current) return
    setBusyCmd(cmd); setError(null)
    try {
      const j = await api(`/${cmd}?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subargs: args }),
      })
      if (cmd === 'commit' || cmd === 'push' || cmd === 'add') {
        // 提取 commit hash / push 结果作为细节，否则用友好文案
        const detail = (j.stdout || '').split('\n').find((l: string) => l.includes(']')) ?? ''
        const head = detail.split(']')[0].replace('[', '') ?? ''
        showToast('ok', `${SUCCESS_MSG[cmd] ?? cmd}${head ? ' ' + head : ''}`)
      } else {
        showToast('ok', SUCCESS_MSG[cmd] ?? `${cmd} 完成`)
      }
      setMsg('')
      if (cmd === 'commit') { setDiff(''); setSelFile(null); setChecked(new Set()) }
    } catch (e) { showToast('err', String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
    await refresh()
  }

  const toggleLog = async (): Promise<void> => {
    if (!showLog) {
      setBusyCmd('log')
      try {
        const j = await api(`/log?path=${encodeURIComponent(repoRef.current)}&n=30&session=${encodeURIComponent(sessionRef.current)}`)
        setLog(j.lines || '')
      } catch (e) { setLog(`读取失败：${String((e as Error).message || e)}`) }
      setBusyCmd(null)
    }
    setShowLog(!showLog)
  }

  const stageAll = async (): Promise<void> => {
    await runOp('add', ['-A'])
  }

  const doStage = async (file: string): Promise<void> => {
    if (!repoRef.current || !file) return
    setBusyCmd('stage')
    try {
      await api(`/stage?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ file }),
      })
      setDiff(''); setSelFile(null); setChecked(new Set())
    } catch (e) { showToast('err', String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
    await refresh()
  }

  const doUnstage = async (file?: string): Promise<void> => {
    if (!repoRef.current) return
    setBusyCmd('unstage')
    try {
      const body: Record<string, string> = {}
      if (file) body.file = file
      await api(`/unstage?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      setDiff(''); setSelFile(null); setChecked(new Set())
    } catch (e) { showToast('err', String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
    await refresh()
  }

  const doRestore = async (file?: string): Promise<void> => {
    if (!repoRef.current) return
    const label = file ? `回滚 ${file}` : '回滚全部未暂存改动'
    if (!window.confirm(`确定${label}？此操作不可撤销。`)) return
    setBusyCmd('restore'); setError(null)
    try {
      const body: Record<string, string> = {}
      if (file) body.file = file
      await api(`/restore?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      })
      showToast('ok', `${label}成功`)
      setDiff(''); setSelFile(null); setChecked(new Set())
    } catch (e) { showToast('err', String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
    await refresh()
  }

  const doSwitch = async (branch: string, create = false, force = false): Promise<void> => {
    if (!repoRef.current || !branch) return
    setBusyCmd('switch'); setError(null)
    try {
      const j = await api(`/switch?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ branch, create, force }),
      })
      showToast('ok', `已切换到 ${j.current ?? branch}`)
      setBranches(j.branches ?? [])
      setCurrentBranch(j.current ?? branch)
      setShowNewBranch(false)
      setNewBranchName('')
      setDiff(''); setSelFile(null); setChecked(new Set())
    } catch (e) {
      const msg = String((e as Error).message || e)
      // 工作区不干净时提示 force
      if (msg.includes('未提交') || msg.includes('uncommitted')) {
        setError(msg + '（勾选"强制"可丢弃未暂存改动）')
      } else {
        showToast('err', msg)
      }
    } finally { setBusyCmd(null) }
    await refresh()
  }

  const toggleFile = (p: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }

  const toggleAllRaw = (files: GitFile[], on: boolean): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const f of files) { if (on) next.add(f.path); else next.delete(f.path) }
      return next
    })
  }

  const commit = async (): Promise<void> => {
    const m = msg.trim()
    if (!m) { setError('请填写提交信息'); return }
    if (checked.size > 0) {
      await runOp('add', Array.from(checked))
    }
    await runOp('commit', ['-m', m])
  }

  const commitAndPush = async (): Promise<void> => {
    const m = msg.trim()
    if (!m) { setError('请填写提交信息'); return }
    setBusyCmd('push'); setError(null)
    try {
      // 1. 暂存勾选的文件
      if (checked.size > 0) {
        await api(`/add?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ subargs: Array.from(checked) }),
        })
      }
      // 2. 提交
      const cj = await api(`/commit?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subargs: ['-m', m] }),
      })
      // 3. 推送（提交成功才推）
      const pj = await api(`/push?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subargs: [] }),
      })
      showToast('ok', '已提交并推送')
      setMsg(''); setDiff(''); setSelFile(null); setChecked(new Set())
    } catch (e) { showToast('err', String((e as Error).message || e)) }
    finally { setBusyCmd(null) }
    await refresh()
  }

  const logRows = log.split('\n').filter(Boolean).map((l) => {
    const [h, an, ad, ...rest] = l.split('\t')
    return (
      <div className="file" key={h}>
        <span className="icon" style={{ color: 'var(--dsw-alias-brand-primary,#2b5fdc)', fontFamily: 'ui-monospace,monospace' }}>{h}</span>
        <span className="name">{rest.join('\t')}</span>
        <span className="meta">{an} · {ad}</span>
      </div>
    )
  })

  return (
    <>
      <style>{CSS}</style>
      <div className="dsh-git">
        <h2>🕊 Git</h2>
        {error && <div className="err">{error}</div>}
        <div className="dsh-git-root" style={{ position: 'relative' }}>
          {toast && (
            <div className={'dsh-toast ' + (toast.kind === 'ok' ? 'ok' : 'err')}>
              {toast.kind === 'ok' ? '✓ ' : '✕ '}{toast.text}
            </div>
          )}
        </div>
        <div className="row">
          <select value={repo} onChange={(e) => { setRepo(e.target.value); setDiff(''); setLog(''); setSelFile(null) }}>
            {repos.map((p) => <option key={p} value={p}>{short(p)}</option>)}
          </select>
          <BusyButton loading={busyCmd === 'refresh'} onClick={() => void refresh()}>刷新</BusyButton>
        </div>

        {status ? (
          <>
            <div className="bar">
              <select
                value={currentBranch}
                onChange={(e) => { void doSwitch(e.target.value) }}
                disabled={busyCmd === 'switch'}
                style={{ maxWidth: 180, fontWeight: 600, padding: '4px 10px' }}
              >
                {branches.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
              <BusyButton loading={busyCmd === 'switch'} onClick={() => setShowNewBranch(!showNewBranch)}>{showNewBranch ? '取消' : '新建分支'}</BusyButton>
              <BusyButton className="primary" loading={busyCmd === 'commit'} disabled={!status.staged.length && !status.unstaged.length} onClick={() => void commit()}>提交</BusyButton>
              <BusyButton className="primary" loading={busyCmd === 'push'} disabled={!status.staged.length && !status.unstaged.length || !status.hasRemote} onClick={() => void commitAndPush()}>提交并推送</BusyButton>
              <BusyButton loading={busyCmd === 'pull'} disabled={!status.hasRemote} onClick={() => void runOp('pull', [])}>拉取</BusyButton>
              <BusyButton loading={busyCmd === 'push'} disabled={!status.hasCommits} onClick={() => void runOp('push', [])}>推送</BusyButton>
              <BusyButton loading={busyCmd === 'log'} onClick={() => void toggleLog()}>{showLog ? '收起' : '历史'}</BusyButton>
              {status.ahead ? <span className="pill">↑{status.ahead}</span> : null}
              {status.behind ? <span className="pill">↓{status.behind}</span> : null}
              {status.total === 0 && <span className="meta" style={{ marginLeft: 4 }}>✓ 干净</span>}
            </div>
            <div className="row" style={{ margin: '6px 0' }}>
              <input
                type="text"
                placeholder="提交信息…"
                value={msg}
                onChange={(e) => setMsg(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void commit() } }}
                style={{ font: 'inherit', padding: '4px 8px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2,#d8dee4)', background: 'var(--dsw-alias-bg-layer-2,#fff)', color: 'inherit', flex: 1 }}
              />
            </div>
            {showNewBranch && (
              <div className="row" style={{ marginTop: 4 }}>
                <input
                  type="text"
                  placeholder="新分支名…"
                  value={newBranchName}
                  onChange={(e) => setNewBranchName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && newBranchName.trim()) void doSwitch(newBranchName.trim(), true) }}
                  style={{ font: 'inherit', padding: '4px 8px', borderRadius: 7, border: '1px solid var(--dsw-alias-border-l2,#d8dee4)', background: 'var(--dsw-alias-bg-layer-2,#fff)', color: 'inherit', flex: 1, maxWidth: 260 }}
                />
                <BusyButton
                  className="primary"
                  loading={busyCmd === 'switch'}
                  disabled={!newBranchName.trim()}
                  onClick={() => void doSwitch(newBranchName.trim(), true)}
                >创建并切换</BusyButton>
              </div>
            )}
            <div className="split">
              <div className="files">
                <FileList title="已暂存" files={status.staged} selected={selFile} checked={checked} onPick={(p) => void pick(p, true)} onToggleAll={(on) => toggleAllRaw(status.staged, on)} onToggle={(p) => toggleFile(p)} onUnstage={(p) => void doUnstage(p)} onUnstageAll={() => void doUnstage()} />
                <FileList title="未暂存" files={status.unstaged} selected={selFile} checked={checked} onPick={(p) => void pick(p)} onToggleAll={(on) => toggleAllRaw(status.unstaged, on)} onToggle={(p) => toggleFile(p)} onStage={(p) => void doStage(p)} onStageAll={() => void stageAll()} onRestore={(p) => void doRestore(p)} onRestoreAll={() => void doRestore()} />
                {!status.staged.length && !status.unstaged.length && <div className="empty">没有改动</div>}
              </div>
              <div className="detail">
                {diff ? (
                  <section>
                    <h3>变更内容：{selFile}</h3>
                    <pre dangerouslySetInnerHTML={{ __html: diffHtml(diff) }} />
                  </section>
                ) : (
                  <section><h3>变更内容</h3><div className="empty">← 点击左侧文件查看 diff</div></section>
                )}
              </div>
            </div>

            {showLog && (
              <section>
                <h3>最近提交</h3>
                {logRows.length ? logRows : <div className="empty">无提交</div>}
              </section>
            )}
          </>
        ) : (
          <div className="err">还没有可用的 git 仓库。在 DSH 里打开一个仓库目录作为工作区，下方会列出工作区内的 git 仓库供选择。</div>
        )}
      </div>
    </>
  )
}

/* ── 插件装配 ──────────────────────────────────────────────── */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({ name: 'conversation.view', id: '@dsh-external/dsh-git-panel', label: () => 'Git' }, GitPanel),
  ), 'dsh-git: conversation view panel')
}

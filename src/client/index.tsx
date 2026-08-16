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
  staged: GitFile[]
  unstaged: GitFile[]
  untracked: GitFile[]
  total: number
}

/* ── CSS（局部，用 DSH 设计 token） ─────────────────────────── */
const CSS = `
.dsh-git{font:13px/1.6 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328);padding:6px;max-width:980px}
.dsh-git h2{font-size:15px;margin:0 0 8px;font-weight:600}
.dsh-git .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.dsh-git button{font:inherit;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;cursor:pointer}
.dsh-git button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git button.primary{background:var(--dsw-alias-brand-primary,#2b5fdc);color:#fff;border-color:transparent}
.dsh-git button:disabled{opacity:.5;cursor:default}
.dsh-git select,.dsh-git textarea{font:inherit;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;box-sizing:border-box}
.dsh-git textarea{width:100%;min-height:62px;resize:vertical}
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

function FileList({ title, files, selected, onPick }: {
  title: string
  files: GitFile[]
  selected: string | null
  onPick: (p: string) => void
}) {
  if (!files.length) return null
  return (
    <section>
      <h3>{title + ' (' + files.length + ')'}</h3>
      {files.map((f) => (
        <div
          key={f.path}
          className={'file' + (f.path === selected ? ' selected' : '')}
          onClick={() => onPick(f.path)}
          title={f.path}
        >
          <span className="icon">{gitIcon(f.index)}</span>
          <span className="name">{f.path}</span>
        </div>
      ))}
    </section>
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
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastOp, setLastOp] = useState<string | null>(null)
  const repoRef = useRef('')
  const sessionRef = useRef(sessionId)

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
    setError(null); setBusy('加载状态')
    try {
      const j = await api(`/status?path=${encodeURIComponent(r)}&session=${encodeURIComponent(sessionRef.current)}`)
      setStatus(j.status)
    } catch (e) { setStatus(null); setError(String((e as Error).message || e)) }
    setBusy(null)
  }

  useEffect(() => { if (repo) void refresh() }, [repo])

  const pick = async (p: string): Promise<void> => {
    setSelFile(p); setBusy('读取 diff')
    try {
      const j = await api(`/diff?path=${encodeURIComponent(repoRef.current)}&file=${encodeURIComponent(p)}&session=${encodeURIComponent(sessionRef.current)}`)
      setDiff(j.diff || '（无差异）')
    } catch (e) { setDiff(`读取失败：${String((e as Error).message || e)}`) }
    setBusy(null)
  }

  const runOp = async (cmd: string, args: string[]): Promise<void> => {
    if (!repoRef.current) return
    setBusy(cmd); setError(null); setLastOp(null)
    try {
      const j = await api(`/${cmd}?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subargs: args }),
      })
      setLastOp((j.stdout || j.stderr || `${cmd} 完成`).slice(0, 400))
      setMsg('')
      if (cmd === 'commit') { setDiff(''); setSelFile(null) }
    } catch (e) { setError(String((e as Error).message || e)) }
    setBusy(null)
    await refresh()
  }

  const toggleLog = async (): Promise<void> => {
    if (!showLog) {
      setBusy('读取历史')
      try {
        const j = await api(`/log?path=${encodeURIComponent(repoRef.current)}&n=30&session=${encodeURIComponent(sessionRef.current)}`)
        setLog(j.lines || '')
      } catch (e) { setLog(`读取失败：${String((e as Error).message || e)}`) }
      setBusy(null)
    }
    setShowLog(!showLog)
  }

  const stageAll = async (): Promise<void> => {
    await runOp('add', ['-A'])
  }

  const commit = async (): Promise<void> => {
    const m = msg.trim()
    if (!m) { setError('请填写提交信息'); return }
    await runOp('commit', ['-m', m])
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
        {lastOp && <div className="ok">{lastOp}</div>}
        <div className="row">
          <select value={repo} onChange={(e) => { setRepo(e.target.value); setDiff(''); setLog(''); setSelFile(null) }}>
            {repos.map((p) => <option key={p} value={p}>{short(p)}</option>)}
          </select>
          <button onClick={() => void refresh()}>刷新</button>
          {busy && <span className="meta">{busy}…</span>}
        </div>

        {status ? (
          <>
            <div className="bar">
              <span className="pill"><b>{status.branch}</b></span>
              {status.ahead ? <span className="pill">↑{status.ahead}</span> : null}
              {status.behind ? <span className="pill">↓{status.behind}</span> : null}
              {status.total === 0 && <span className="meta">✓ 工作区干净</span>}
            </div>
            <FileList title="已暂存" files={status.staged} selected={selFile} onPick={(p) => void pick(p)} />
            <FileList title="未暂存" files={status.unstaged} selected={selFile} onPick={(p) => void pick(p)} />

            {diff && (
              <section>
                <h3>变更内容：{selFile}</h3>
                <pre dangerouslySetInnerHTML={{ __html: diffHtml(diff) }} />
              </section>
            )}

            <section>
              <h3>操作</h3>
              <div style={{ padding: 8 }}>
                <textarea placeholder="提交信息…" value={msg} onChange={(e) => setMsg(e.target.value)} />
                <div className="row">
                  <button className="primary" onClick={() => void commit()}>提交</button>
                  <button onClick={() => void stageAll()}>暂存全部</button>
                  <button onClick={() => void runOp('pull', [])} disabled={!status.hasRemote}>拉取</button>
                  <button onClick={() => void runOp('push', [])} disabled={!status.hasRemote}>推送</button>
                  <button onClick={() => void runOp('fetch', [])}>Fetch</button>
                  <button onClick={() => void toggleLog()}>{showLog ? '收起历史' : '历史'}</button>
                </div>
              </div>
            </section>

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

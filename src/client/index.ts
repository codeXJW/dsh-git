/**
 * @dsh-external/dsh-git — client Git 面板。
 *
 * 挂进 `conversation.view` 槽（标签页环，Chat 之外多一个 Git 页）。
 * 面板是无 React 依赖的 DOM 组件：模块级轻量 state + 事件委托 + 全量重绘。
 * 避免与 DSH 槽系统的 React props 细节绑定，跨版本更稳。
 * 数据一律来自 host 的 `@dsh-external/dsh-git/api` JSON 端点。
 */
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'

type ClientContext = {
  slots: SlotsService
  effect(fn: () => (() => void) | void, label?: string): void
}

export const inject = ['slots']

const API = '/@dsh-external/dsh-git/api'

/* ── 极简类型（与 host 返回对齐） ─────────────────────────────── */
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

interface State {
  repos: string[]
  repo: string | null
  status: RepoStatus | null
  diff: string
  log: string
  message: string
  busy: string | null
  error: string | null
  selectedFile: string | null
  showLog: boolean
  lastOp: string | null
}

const state: State = {
  repos: [],
  repo: null,
  status: null,
  diff: '',
  log: '',
  message: '',
  busy: null,
  error: null,
  selectedFile: null,
  showLog: false,
  lastOp: null,
}

let rootEl: HTMLElement | null = null

/* ── host 通信 ───────────────────────────────────────────────── */
async function api(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(API + path, init)
  const j = await res.json().catch(() => ({}))
  if (!res.ok || (j && j.ok === false)) {
    throw new Error((j && j.error) || `HTTP ${res.status}`)
  }
  return j
}

/* ── 工具 ────────────────────────────────────────────────────── */
function esc(s: unknown): string {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}

function icon(ix: string): string {
  if (ix === '?') return '▸'
  if (ix === 'A') return '+'
  if (ix === 'D') return '−'
  if (ix === 'R') return '→'
  return '~'
}

function diffHtml(d: string): string {
  return esc(d).split('\n').map((line) => {
    const cls = line.startsWith('+') ? 'diff-plus' : line.startsWith('-') ? 'diff-minus' : ''
    return cls ? `<span class="${cls}">${line}</span>` : line
  }).join('\n')
}

function fileSection(title: string, files: GitFile[]): string {
  if (!files.length) return ''
  const items = files.map((f) => `
    <div class="file" data-file="${esc(f.path)}" title="${esc(f.path)}">
      <span class="tag">${esc(icon(f.index))}</span>
      <span class="name">${esc(f.path)}</span>
    </div>`).join('')
  return `<section><h3>${esc(title)}（${files.length}）</h3>${items}</section>`
}

/* ── 绘制 ────────────────────────────────────────────────────── */
const CSS = `<style>
.dsh-git{font:13px/1.55 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328);padding:6px;max-width:960px}
.dsh-git h2{font-size:15px;margin:0 0 8px;font-weight:600}
.dsh-git .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:6px 0}
.dsh-git button{font:inherit;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;cursor:pointer}
.dsh-git button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git button.primary{background:var(--dsw-alias-brand-primary,#2b5fdc);color:#fff;border-color:transparent}
.dsh-git button:disabled{opacity:.5;cursor:default}
.dsh-git select,.dsh-git textarea{font:inherit;padding:5px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;box-sizing:border-box;width:100%}
.dsh-git select{width:auto;flex:1}
.dsh-git textarea{min-height:64px;resize:vertical}
.dsh-git .bar{display:flex;gap:6px;align-items:center;flex-wrap:wrap}
.dsh-git .meta{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px}
.dsh-git .err{color:#cf222e;background:rgba(207,34,46,.08);padding:6px 9px;border-radius:7px;margin:6px 0}
.dsh-git .ok{color:#1a7f37;background:rgba(26,127,55,.08);padding:6px 9px;border-radius:7px;margin:6px 0;white-space:pre-wrap}
.dsh-git section{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;margin:8px 0;overflow:hidden}
.dsh-git section>h3{margin:0;padding:6px 10px;font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .file{display:flex;gap:8px;align-items:center;padding:5px 10px;cursor:pointer}
.dsh-git .file:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .file .tag{width:14px;font-size:12px;flex:none;color:var(--dsw-alias-label-tertiary,#6e7781)}
.dsh-git .file .name{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git .empty{padding:8px 10px;color:var(--dsw-alias-label-tertiary,#6e7781)}
.dsh-git pre{margin:0;padding:8px 10px;overflow:auto;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--dsw-alias-bg-layer-1,#f6f8fa);white-space:pre-wrap;word-break:break-all}
.dsh-git .diff-plus{color:#1a7f37}.dsh-git .diff-minus{color:#cf222e}
.dsh-git .pill{display:inline-block;font-size:11px;border-radius:9px;padding:0 8px;background:var(--dsw-alias-bg-layer-3,#eaeef2)}
</style>`

function draw(): void {
  if (!rootEl) return
  const s = state
  const status = s.status
  rootEl.innerHTML = CSS + `
  <h2>🕊 Git</h2>
  ${s.error ? `<div class="err">${esc(s.error)}</div>` : ''}
  ${s.lastOp ? `<div class="ok">${esc(s.lastOp)}</div>` : ''}
  <div class="row">
    <select id="repo" data-action="repodiv"></select>
    <button data-action="refresh">刷新</button>
    ${s.busy ? `<span class="meta">${esc(s.busy)}…</span>` : ''}
  </div>
  ${status ? `
  <div class="bar">
    <span class="pill"><b>${esc(status.branch)}</b></span>
    ${status.ahead ? `<span class="pill">↑${status.ahead}</span>` : ''}
    ${status.behind ? `<span class="pill">↓${status.behind}</span>` : ''}
  </div>
  <section><h3>暂存区与工作区</h3>
    ${fileSection('已暂存', status.staged)}
    ${fileSection('改动', status.unstaged)}
    ${fileSection('未跟踪', status.untracked)}
  </section>
  ${s.diff ? `<section><h3>变更内容：${esc(s.selectedFile)}</h3><pre>${diffHtml(s.diff)}</pre></section>` : ''}
  <section><h3>操作</h3><div style="padding:8px 10px;" class="row">
    <button data-action="stageall">暂存全部</button>
    <button data-action="commit" class="primary">提交</button>
    <button data-action="pull">拉取</button>
    <button data-action="push">推送</button>
    <button data-action="fetch">Fetch</button>
    <button data-action="log">${s.showLog ? '收起历史' : '历史'}</button>
  </div>
  <div style="padding:0 10px 10px"><textarea id="msg" placeholder="提交信息…">${esc(s.message)}</textarea></div></section>
  ${s.showLog ? renderLog() : ''}
  ` : `<div class="err">还没有可用的 git 仓库。在 DSH 里打开一个仓库目录作为工作区。</div>`}
  `
  // 填充仓库下拉
  const sel = rootEl.querySelector('select#repo') as HTMLSelectElement | null
  if (sel) {
    sel.innerHTML = s.status ? s.repos.map((p) => `<option value="${esc(p)}"${p === s.repo ? ' selected' : ''}>${esc(short(p))}</option>`).join('') : ''
    if (!s.status && s.repos.length) {
      // 尚未加载，先给下拉
      sel.innerHTML = s.repos.map((p) => `<option value="${esc(p)}"${p === s.repo ? ' selected' : ''}>${esc(short(p))}</option>`).join('')
    }
  }
}

function renderLog(): string {
  const lines = state.log.split('\n').filter(Boolean)
  if (!lines.length) return `<section><h3>最近提交</h3><div class="empty">无提交</div></section>`
  const html = lines.map((l) => {
    const [h, an, ad, ...rest] = l.split('\t')
    return `<div class="file"><span style="font-family:ui-monospace,monospace;color:var(--dsw-alias-brand-primary,#2b5fdc)">${esc(h)}</span><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(rest.join('\t'))}</span><span class="meta">${esc(an)} · ${esc(ad)}</span></div>`
  }).join('')
  return `<section><h3>最近提交</h3>${html}</section>`
}

function short(p: string): string {
  const parts = p.replace(/\\/g, '/').split('/')
  return parts[parts.length - 1] || p
}

/* ── 事件委托 ────────────────────────────────────────────────── */
function onAction(action: string, value?: string): void {
  switch (action) {
    case 'refresh': void refresh(); break
    case 'repodiv': // select 已单独绑定
      break
    case 'stageall': void stageAll(); break
    case 'commit': void doCommit(); break
    case 'pull': void runOp('pull', []); break
    case 'push': void runOp('push', []); break
    case 'fetch': void runOp('fetch', []); break
    case 'log': state.showLog = !state.showLog; if (state.showLog) void loadLog(); else draw(); break
    default: break
  }
}

function bind(root: HTMLElement): void {
  root.addEventListener('click', (e) => {
    const t = e.target as HTMLElement
    if (t.id === 'msg') return
    const fileEl = t.closest('[data-file]')
    if (fileEl) {
      const p = fileEl.getAttribute('data-file')
      if (p) { state.selectedFile = p; void loadDiff(p) }
      return
    }
    const act = t.closest('[data-action]')
    if (act) onAction(act.getAttribute('data-action') || '')
  })
  root.addEventListener('input', (e) => {
    const t = e.target as HTMLElement
    if (t.id === 'msg') state.message = (t as HTMLTextAreaElement).value
  })
  root.addEventListener('change', (e) => {
    const t = e.target as HTMLElement
    if (t.id === 'repo') {
      state.repo = (t as HTMLSelectElement).value || null
      state.diff = ''
      state.log = ''
      state.selectedFile = null
      if (!state.showLog) void refresh()
      else { void refresh(); void loadLog() }
    }
  })
  if (state.repo) void refresh()
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({
      name: 'conversation.view',
      id: '@dsh-external/dsh-git-panel',
      label: () => 'Git',
      component: () => ({
        render(): HTMLElement {
          rootEl = document.createElement('div')
          rootEl.className = 'dsh-git'
          draw()
          bind(rootEl)
          void initRepoSelect()
          return rootEl
        },
      }),
    }),
  ), 'dsh-git: panel')
}

/* ── 数据加载 ────────────────────────────────────────────────── */
async function initRepoSelect(): Promise<void> {
  try {
    const j = await api('/repos')
    state.repos = j.repos ?? []
    if (!state.repo && state.repos.length) state.repo = state.repos[0]
    else if (state.repo && !state.repos.includes(state.repo)) state.repo = null
    draw()
    await refresh()
  } catch (e) {
    state.error = String((e as Error).message || e)
    draw()
  }
}

async function refresh(): Promise<void> {
  if (!state.repo) { state.status = null; draw(); return }
  state.error = null
  state.busy = '加载状态'
  draw()
  try {
    const j = await api(`/status?path=${encodeURIComponent(state.repo)}`)
    state.status = j.status
  } catch (e) {
    state.status = null
    state.error = String((e as Error).message || e)
  }
  state.busy = null
  draw()
}

async function loadDiff(p: string): Promise<void> {
  if (!state.repo) return
  state.busy = '读取 diff'
  draw()
  try {
    const j = await api(`/diff?path=${encodeURIComponent(state.repo)}&file=${encodeURIComponent(p)}`)
    state.diff = j.diff || '（无差异）'
  } catch (e) {
    state.diff = `读取失败：${String((e as Error).message || e)}`
  }
  state.busy = null
  draw()
}

async function loadLog(): Promise<void> {
  if (!state.repo) return
  state.busy = '读取历史'
  draw()
  try {
    const j = await api(`/log?path=${encodeURIComponent(state.repo)}&n=30`)
    state.log = j.lines || ''
  } catch (e) {
    state.log = `读取失败：${String((e as Error).message || e)}`
  }
  state.busy = null
  draw()
}

async function stageAll(): Promise<void> {
  if (!state.repo) return
  state.busy = '暂存'
  draw()
  try {
    await api(`/add?path=${encodeURIComponent(state.repo)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subargs: ['-A'] }) })
    state.lastOp = '已暂存全部文件'
  } catch (e) {
    state.error = String((e as Error).message || e)
  }
  state.busy = null
  state.diff = ''
  await refresh()
}

async function doCommit(): Promise<void> {
  const msg = state.message.trim()
  if (!msg) { state.error = '请填写提交信息'; draw(); return }
  await runOp('commit', ['-m', msg])
}

async function runOp(cmd: string, args: string[]): Promise<void> {
  if (!state.repo) return
  state.busy = cmd
  state.error = null
  state.lastOp = null
  draw()
  try {
    const j = await api(`/${cmd}?path=${encodeURIComponent(state.repo)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subargs: args }) })
    state.lastOp = (j.stdout || j.stderr || `${cmd} 完成`).slice(0, 400)
    state.message = ''
    if (cmd === 'commit') { state.diff = ''; state.selectedFile = null }
  } catch (e) {
    state.error = String((e as Error).message || e)
  }
  state.busy = null
  await refresh()
}

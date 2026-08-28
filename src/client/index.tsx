/**
 * @daxu8972/dsh-git — client Git 面板（React 组件，VSCode/IDEA 式交互）。
 *
 * 布局：
 *   ┌ 工具栏：仓库选择 · 分支弹层（IDEA 分支部件式）· 拉取/推送/同步/Fetch/刷新
 *   ├ 左栏：提交信息框（VSCode 提交框式）+ 可折叠变更分组（暂存/未暂存/未跟踪/储藏）
 *   └ 右栏：差异 | 历史 双标签页（历史可展开单次提交的文件清单，点文件看该提交 diff）
 *
 * 挂到 `conversation.view` 槽（会话标签页环，Chat 之外多一个 Git 页）。
 */
import { useEffect, useRef, useState } from 'react'
import type { SlotsService } from '@deepseek-ai/dsh-client-ui-slots'
import { BranchMenu } from './branch-menu.js'
import { HistoryPane } from './history.js'
import { CSS } from './styles.js'
import { api, BusyButton, diffHtml, FileRow, IconBtn, Section, short } from './ui.js'
import type { BranchInfo, CommitDetailPayload, CommitEntry, DiffView, GraphRowData, RepoStatus, StashEntry } from './types.js'

type ClientContext = {
  slots: SlotsService
  effect(fn: () => (() => void) | void, label?: string): void
}

export const inject = ['slots']

type GroupKey = 'staged' | 'unstaged' | 'untracked' | 'stash'

/* ── 面板主组件 ─────────────────────────────────────────────── */
export function GitPanel(props: { sessionId?: string }): React.ReactNode {
  const sessionId = props.sessionId ?? ''
  const [repos, setRepos] = useState<string[]>([])
  const [repo, setRepo] = useState('')
  const [status, setStatus] = useState<RepoStatus | null>(null)
  const [branchInfo, setBranchInfo] = useState<BranchInfo>({ current: '', branches: [], remotes: [] })
  const [stashes, setStashes] = useState<StashEntry[]>([])
  const [msg, setMsg] = useState('')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [tab, setTab] = useState<'diff' | 'history'>('diff')
  const [view, setView] = useState<DiffView | null>(null)
  const [commits, setCommits] = useState<CommitEntry[]>([])
  const [graph, setGraph] = useState<GraphRowData[]>([])
  const [logLoading, setLogLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [detail, setDetail] = useState<CommitDetailPayload | null>(null)
  const [detailBusy, setDetailBusy] = useState(false)
  const [closed, setClosed] = useState<Record<GroupKey, boolean>>({ staged: false, unstaged: false, untracked: false, stash: false })
  const [menuOpen, setMenuOpen] = useState(false)
  const [stashBoxOpen, setStashBoxOpen] = useState(false)
  const [stashMsg, setStashMsg] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [toast, setToast] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout>>(null)
  const repoRef = useRef('')
  const sessionRef = useRef(sessionId)

  const showToast = (kind: 'ok' | 'err', text: string): void => {
    setToast({ kind, text })
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }

  useEffect(() => { sessionRef.current = sessionId }, [sessionId])
  useEffect(() => { repoRef.current = repo }, [repo])

  const qs = (): string =>
    `?path=${encodeURIComponent(repoRef.current)}&session=${encodeURIComponent(sessionRef.current)}`

  const resetRepoState = (): void => {
    setStatus(null); setBranchInfo({ current: '', branches: [], remotes: [] }); setStashes([])
    setChecked(new Set()); setView(null); setCommits([]); setGraph([]); setExpanded(null); setDetail(null)
    setMenuOpen(false); setStashBoxOpen(false); setStashMsg(''); setError(null)
  }

  const loadRepos = async (): Promise<void> => {
    try {
      const q = sessionRef.current ? `?session=${encodeURIComponent(sessionRef.current)}` : ''
      const j = await api(`/repos${q}`)
      const list: string[] = j.repos ?? []
      setRepos(list)
      resetRepoState()
      if (list.length) { setRepo(list[0]); repoRef.current = list[0] }
    } catch (e) { setError(String((e as Error).message || e)) }
  }

  const refresh = async (): Promise<void> => {
    const r = repoRef.current
    if (!r) { setStatus(null); return }
    setError(null); setBusy('refresh')
    try {
      const [statusJ, branchJ, stashJ] = await Promise.all([
        api(`/status${qs()}`).catch(() => null),
        api(`/branches${qs()}`).catch(() => null),
        api(`/stashes${qs()}`).catch(() => null),
      ])
      if (statusJ) {
        setStatus(statusJ.status)
      } else {
        setStatus(null); setError('读取仓库状态失败')
      }
      if (branchJ) setBranchInfo({ current: branchJ.current ?? '', branches: branchJ.branches ?? [], remotes: branchJ.remotes ?? [] })
      if (stashJ) setStashes(stashJ.stashes ?? [])
    } catch (e) { setError(String((e as Error).message || e)) } finally { setBusy(null) }
  }

  useEffect(() => { void loadRepos() }, [sessionId])
  useEffect(() => { if (repo) void refresh() }, [repo])

  const loadCommits = async (): Promise<void> => {
    const r = repoRef.current
    if (!r) return
    setLogLoading(true)
    try {
      const j = await api(`/log${qs()}&n=100`)
      setCommits(j.commits ?? [])
      setGraph(Array.isArray(j.graph) ? j.graph : [])
    } catch (e) { showToast('err', `读取历史失败：${String((e as Error).message || e)}`) } finally { setLogLoading(false) }
  }

  useEffect(() => {
    if (tab === 'history' && repo && commits.length === 0 && !logLoading) void loadCommits()
  }, [tab, repo])

  /* ── 查看文件：工作区差异 / 已暂存差异 / 未跟踪预览 ─────── */
  const openFile = async (file: string, kind: DiffView['kind']): Promise<void> => {
    setTab('diff')
    setView({ file, kind, content: '', loading: true })
    try {
      if (kind === 'file') {
        const j = await api(`/view${qs()}&file=${encodeURIComponent(file)}`)
        setView((v) => v && v.file === file && v.kind === 'file'
          ? { ...v, content: j.content ?? '', binary: Boolean(j.binary), truncated: Boolean(j.truncated), loading: false }
          : v)
      } else {
        const j = await api(`/diff${qs()}&file=${encodeURIComponent(file)}${kind === 'cached' ? '&staged=1' : ''}`)
        setView((v) => v && v.file === file && v.kind === kind
          ? { ...v, content: j.diff || '（无差异）', loading: false }
          : v)
      }
    } catch (e) {
      const text = `读取失败：${String((e as Error).message || e)}`
      setView((v) => v && v.file === file ? { ...v, content: text, loading: false } : v)
    }
  }

  /* ── 暂存 / 取消暂存 ────────────────────────────────────── */
  const post = async (cmd: string, body: Record<string, unknown>): Promise<any> =>
    api(`/${cmd}${qs()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

  const doStage = async (file: string): Promise<void> => {
    setBusy('stage')
    try { await post('stage', { file }) } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  const doUnstage = async (file?: string): Promise<void> => {
    setBusy('unstage')
    try { await post('unstage', file ? { file } : {}) } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  /** 批量暂存一组文件（组头「全部暂存」）。 */
  const doStageMany = async (files: string[]): Promise<void> => {
    if (!files.length) return
    setBusy('stage')
    try { await post('add', { subargs: files }) } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  /* ── 回滚 / 丢弃（不可逆，均需确认） ───────────────────── */
  const doDiscard = async (file: string): Promise<void> => {
    const isUntracked = status?.untracked.some((f) => f.path === file) ?? false
    const tip = isUntracked
      ? `删除未跟踪文件「${file}」？文件会被直接删除，此操作不可撤销。`
      : `回滚「${file}」的未暂存改动？未保存的修改会丢失，此操作不可撤销。`
    if (!window.confirm(tip)) return
    setBusy('discard')
    try {
      await post('discard', { file })
      showToast('ok', isUntracked ? `已删除 ${file}` : `已回滚 ${file}`)
      if (view?.file === file) setView(null)
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  const doRestoreAll = async (): Promise<void> => {
    if (!window.confirm('回滚所有未暂存的已跟踪文件改动？此操作不可撤销（不影响暂存区与未跟踪文件）。')) return
    setBusy('restore')
    try {
      await post('restore', {})
      showToast('ok', '已回滚所有未暂存改动')
      setView(null)
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  /* ── 拉取 / 推送 / 同步 / Fetch ─────────────────────────── */
  const runOp = async (cmd: string, okText: string): Promise<void> => {
    setBusy(cmd)
    try {
      const j = await post(cmd, { subargs: [] })
      const detail = (j.stdout || '').split('\n').find((l: string) => l.includes(']')) ?? ''
      showToast('ok', okText + (detail ? ' ' + detail.split(']')[0].replace('[', '') : ''))
    } catch (e) {
      showToast('err', `${okText.replace(/^已/, '')}失败：${String((e as Error).message || e)}`)
    } finally { setBusy(null) }
    await refresh()
  }

  const doSync = async (): Promise<void> => {
    setBusy('sync')
    try {
      await post('pull', { subargs: [] })
      const j = await post('push', { subargs: [] })
      const detail = (j.stdout || '').split('\n').find((l: string) => l.includes(']')) ?? ''
      showToast('ok', '已同步（拉取 + 推送）' + (detail ? ' ' + detail.split(']')[0].replace('[', '') : ''))
    } catch (e) { showToast('err', `同步失败：${String((e as Error).message || e)}`) } finally { setBusy(null) }
    await refresh()
  }

  /* ── 提交 ──────────────────────────────────────────────── */
  const commitCore = async (message: string): Promise<void> => {
    if (checked.size > 0) await post('add', { subargs: Array.from(checked) })
    return post('commit', { subargs: ['-m', message] })
  }

  const toastCommitOk = (j: any, text: string): void => {
    const detail = (j.stdout || '').split('\n').find((l: string) => l.includes(']')) ?? ''
    const head = detail.split(']')[0].replace('[', '') ?? ''
    showToast('ok', text + (head ? ' ' + head : ''))
  }

  const afterCommit = (): void => {
    setMsg(''); setChecked(new Set()); setView(null); setCommits([]); setGraph([]); setExpanded(null); setDetail(null)
  }

  const doCommit = async (): Promise<void> => {
    const m = msg.trim()
    if (!m) { showToast('err', '请填写提交信息'); return }
    setBusy('commit')
    try {
      const j = await commitCore(m)
      toastCommitOk(j, '已提交')
      afterCommit()
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  const doCommitPush = async (): Promise<void> => {
    const m = msg.trim()
    if (!m) { showToast('err', '请填写提交信息'); return }
    setBusy('commitpush')
    try {
      const j = await commitCore(m)
      toastCommitOk(j, '已提交')
      await post('push', { subargs: [] })
      showToast('ok', '已提交并推送')
      afterCommit()
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  /* ── 分支：切换 / 新建 / 删除 ───────────────────────────── */
  const doSwitch = async (branch: string, create = false): Promise<void> => {
    setBusy(create ? 'create' : 'switch')
    try {
      const j = await post('switch', { branch, create })
      setBranchInfo({ current: j.current ?? branch, branches: j.branches ?? [], remotes: j.remotes ?? [] })
      showToast('ok', `已${create ? '创建并' : ''}切换到 ${j.current ?? branch}`)
      setMenuOpen(false)
      setView(null); setCommits([]); setGraph([]); setExpanded(null); setDetail(null)
    } catch (e) {
      // 后端错误里带开发者措辞（"传 force=true"），统一改写为用户能直接执行的动作
      const raw = String((e as Error).message || e)
      const m2 = raw.includes('未提交') ? '工作区有未提交的改动：先提交，或储藏（Stash）改动后再切换' : raw
      showToast('err', m2)
    } finally { setBusy(null) }
    await refresh()
  }

  const doDeleteBranch = async (branch: string): Promise<void> => {
    if (!window.confirm(`删除分支「${branch}」？未合并的分支会被 git 拒绝（-d）。`)) return
    setBusy(`delete:${branch}`)
    try {
      await post('branch_delete', { branch })
      showToast('ok', `已删除分支 ${branch}`)
      if (expanded && detail) { setExpanded(null); setDetail(null) }
    } catch (e) {
      const m2 = String((e as Error).message || e)
      showToast('err', m2)
    } finally { setBusy(null) }
    await refresh()
  }

  /* ── 储藏 ──────────────────────────────────────────────── */
  const doStash = async (): Promise<void> => {
    setBusy('stash')
    try {
      const j = await post('stash', stashMsg.trim() ? { message: stashMsg.trim() } : {})
      setStashes(j.stashes ?? [])
      showToast('ok', '已储藏当前改动（含未跟踪文件）')
      setStashMsg(''); setStashBoxOpen(false); setView(null); setChecked(new Set())
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  const doStashPop = async (index: number): Promise<void> => {
    setBusy(`stashpop:${index}`)
    try {
      const j = await post('stash_apply', { index, pop: true })
      setStashes(j.stashes ?? [])
      showToast('ok', `已恢复 stash@{${index}}`)
      setView(null)
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  const doStashDrop = async (index: number): Promise<void> => {
    if (!window.confirm(`丢弃储藏 stash@{${index}}？该储藏记录将被永久删除。`)) return
    setBusy(`stashdrop:${index}`)
    try {
      const j = await post('stash_drop', { index })
      setStashes(j.stashes ?? [])
      showToast('ok', `已丢弃 stash@{${index}}`)
    } catch (e) { showToast('err', String((e as Error).message || e)) } finally { setBusy(null) }
    await refresh()
  }

  /* ── 选择（复选框语义：提交前先 add 勾选项） ────────────── */
  const toggleFile = (p: string): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p); else next.add(p)
      return next
    })
  }

  const toggleAllRaw = (files: Array<{ path: string }>, on: boolean): void => {
    setChecked((prev) => {
      const next = new Set(prev)
      for (const f of files) { if (on) next.add(f.path); else next.delete(f.path) }
      return next
    })
  }

  const expandCommit = async (hash: string): Promise<void> => {
    if (expanded === hash) { setExpanded(null); setDetail(null); return }
    setExpanded(hash); setDetail(null); setDetailBusy(true)
    try {
      const j = await api(`/commit${qs()}&hash=${encodeURIComponent(hash)}`)
      setDetail({ commit: j.commit ?? null, stat: j.stat ?? '', files: j.files ?? [] })
    } catch (e) { showToast('err', `读取提交详情失败：${String((e as Error).message || e)}`) } finally { setDetailBusy(false) }
  }

  const openCommitFile = async (hash: string, hashShort: string, file: string): Promise<void> => {
    setTab('diff')
    setView({ file, kind: 'commit', content: '', loading: true, fromCommit: { hash, short: hashShort } })
    try {
      const j = await api(`/commit_diff${qs()}&hash=${encodeURIComponent(hash)}&file=${encodeURIComponent(file)}`)
      setView((v) => v && v.file === file && v.fromCommit?.hash === hash
        ? { ...v, content: j.diff || '（此提交未改动该文件的内容）', loading: false }
        : v)
    } catch (e) {
      const text = `读取失败：${String((e as Error).message || e)}`
      setView((v) => v && v.fromCommit?.hash === hash && v.file === file ? { ...v, content: text, loading: false } : v)
    }
  }

  /* ── 派生状态 ───────────────────────────────────────────── */
  const staged = status?.staged ?? []
  const unstaged = status?.unstaged ?? []
  const untracked = status?.untracked ?? []
  const hasRemote = status?.hasRemote ?? false
  const canCommit = checked.size > 0 || staged.length > 0 || unstaged.length > 0
  const commitPlan = checked.size > 0
    ? `将提交勾选的 ${checked.size} 项（先暂存）`
    : staged.length > 0
      ? `将提交已暂存的 ${staged.length} 项`
      : unstaged.length > 0
        ? '暂存区为空，将自动暂存已跟踪改动后提交'
        : ''

  const selKey = view ? (view.fromCommit ? `commit:${view.fromCommit.hash}:${view.file}` : `${view.kind}:${view.file}`) : ''
  const rowSel = (kind: DiffView['kind'], file: string): boolean =>
    selKey === `${kind}:${file}`

  const bothModes = view && !view.fromCommit && view.kind !== 'file' && status != null &&
    status.staged.some((f) => f.path === view.file) && status.unstaged.some((f) => f.path === view.file)

  const syncBadge = status && hasRemote && (status.ahead > 0 || status.behind > 0)
    ? <span className="counts">{status.behind > 0 ? `↓${status.behind}` : ''}{status.ahead > 0 ? ` ↑${status.ahead}` : ''}</span>
    : null

  /* ── 渲染 ───────────────────────────────────────────────── */
  return (
    <>
      <style>{CSS}</style>
      <div className="dsh-git">
        {toast && <div className={'dsh-toast ' + (toast.kind === 'ok' ? 'ok' : 'err')}>{toast.kind === 'ok' ? '✓ ' : '✕ '}{toast.text}</div>}
        {error && <div className="err">{error}</div>}

        {!repo ? (
          <div className="err">还没有可用的 git 仓库。在 DSH 里打开一个仓库目录作为工作区，这里会列出工作区内的 git 仓库供选择。</div>
        ) : (
          <>
            {/* 工具栏 */}
            <div className="toolbar">
              <select
                value={repo}
                title={repo}
                onChange={(e) => { setRepo(e.target.value); repoRef.current = e.target.value; resetRepoState() }}
              >
                {repos.map((p) => <option key={p} value={p}>{short(p)}</option>)}
              </select>
              <button className="chip" onClick={() => setMenuOpen(!menuOpen)} title="分支管理（切换 / 新建 / 删除 / 检出远程分支）">
                <span>⑂</span>
                <span className="name">{branchInfo.current || '(detached)'}</span>
                <span className="caret" style={{ fontSize: 10 }}>▼</span>
              </button>
              <span className="spacer" />
              <IconBtn icon="⬇" title="拉取（git pull）" disabled={!hasRemote} loading={busy === 'pull'} onClick={() => void runOp('pull', '已拉取')} />
              <IconBtn icon="⬆" title="推送（git push）" disabled={!hasRemote || !status?.hasCommits} loading={busy === 'push'} onClick={() => void runOp('push', '已推送')} />
              <IconBtn
                icon="⇅"
                title="同步：拉取并推送（git pull + git push）"
                disabled={!hasRemote || !status?.hasCommits}
                loading={busy === 'sync'}
                onClick={() => void doSync()}
                badge={syncBadge}
              />
              <IconBtn icon="⤓" title="Fetch 远程更新（不合并）" disabled={!hasRemote} loading={busy === 'fetch'} onClick={() => void runOp('fetch', '已 Fetch')} />
              <IconBtn icon="⟳" title="刷新状态" loading={busy === 'refresh'} onClick={() => void refresh()} />
              {menuOpen && (
                <>
                  <div className="menu-backdrop" style={{ position: 'fixed', inset: 0, zIndex: 39 }} onClick={() => setMenuOpen(false)} />
                  <BranchMenu
                    info={branchInfo}
                    busy={busy}
                    onClose={() => setMenuOpen(false)}
                    onSwitch={(b) => void doSwitch(b)}
                    onCreate={(n) => void doSwitch(n, true)}
                    onDelete={(b) => void doDeleteBranch(b)}
                  />
                </>
              )}
            </div>

            <div className="columns">
              {/* 左栏：提交框 + 变更分组 */}
              <div className="side">
                <div className="commit-box">
                  <textarea
                    placeholder="提交信息…（Ctrl+Enter 提交）"
                    value={msg}
                    onChange={(e) => setMsg(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (canCommit) void doCommit() }
                    }}
                  />
                  <div className="commit-actions">
                    <BusyButton className="primary" loading={busy === 'commit'} disabled={!canCommit} title={commitPlan || '没有可提交的改动'} onClick={() => void doCommit()}>✓ 提交</BusyButton>
                    <BusyButton loading={busy === 'commitpush'} disabled={!canCommit || !hasRemote} title="提交后直接推送到远程" onClick={() => void doCommitPush()}>提交并推送</BusyButton>
                    <span className="hint">{commitPlan}</span>
                  </div>
                </div>

                <Section
                  title="暂存的更改"
                  count={staged.length}
                  closed={closed.staged}
                  onCaret={() => setClosed((c) => ({ ...c, staged: !c.staged }))}
                  actions={staged.length > 0 && (
                    <button title="取消暂存全部" onClick={() => void doUnstage()}>全部取消暂存</button>
                  )}
                >
                  {staged.length === 0
                    ? <div className="empty">暂存区为空。点击「更改」里文件的 + 可暂存。</div>
                    : (
                      <div className="file-list">
                        {staged.map((f) => (
                          <FileRow
                            key={f.path}
                            f={f}
                            listKind="staged"
                            checked={checked.has(f.path)}
                            selected={rowSel('cached', f.path)}
                            onPick={() => void openFile(f.path, 'cached')}
                            onToggle={() => toggleFile(f.path)}
                            ops={[{ icon: '−', title: `取消暂存 ${f.path}`, onClick: () => void doUnstage(f.path) }]}
                          />
                        ))}
                      </div>
                    )}
                </Section>

                <Section
                  title="更改（未暂存）"
                  count={unstaged.length}
                  closed={closed.unstaged}
                  onCaret={() => setClosed((c) => ({ ...c, unstaged: !c.unstaged }))}
                  actions={unstaged.length > 0 && (
                    <>
                      <button title="暂存全部已跟踪改动" onClick={() => void doStageMany(unstaged.map((f) => f.path))}>全部暂存</button>
                      <button className="danger" title="回滚所有未暂存改动（不可撤销）" onClick={() => void doRestoreAll()}>全部回滚</button>
                    </>
                  )}
                >
                  {unstaged.length === 0
                    ? <div className="empty">没有未暂存的改动。</div>
                    : (
                      <div className="file-list">
                        {unstaged.map((f) => (
                          <FileRow
                            key={f.path}
                            f={f}
                            listKind="unstaged"
                            checked={checked.has(f.path)}
                            selected={rowSel('worktree', f.path)}
                            onPick={() => void openFile(f.path, 'worktree')}
                            onToggle={() => toggleFile(f.path)}
                            ops={[
                              { icon: '+', title: `暂存 ${f.path}`, onClick: () => void doStage(f.path) },
                              { icon: '↩', title: `回滚 ${f.path}（不可撤销）`, onClick: () => void doDiscard(f.path), danger: true },
                            ]}
                          />
                        ))}
                      </div>
                    )}
                </Section>

                <Section
                  title="未跟踪"
                  count={untracked.length}
                  closed={closed.untracked}
                  onCaret={() => setClosed((c) => ({ ...c, untracked: !c.untracked }))}
                  actions={untracked.length > 0 && (
                    <button title="暂存全部未跟踪文件" onClick={() => void doStageMany(untracked.map((f) => f.path))}>全部暂存</button>
                  )}
                >
                  {untracked.length === 0
                    ? <div className="empty">没有未跟踪文件。</div>
                    : (
                      <div className="file-list">
                        {untracked.map((f) => (
                          <FileRow
                            key={f.path}
                            f={f}
                            listKind="untracked"
                            checked={checked.has(f.path)}
                            selected={rowSel('file', f.path)}
                            onPick={() => void openFile(f.path, 'file')}
                            onToggle={() => toggleFile(f.path)}
                            ops={[
                              { icon: '+', title: `暂存 ${f.path}`, onClick: () => void doStage(f.path) },
                              { icon: '🗑', title: `删除 ${f.path}（不可撤销）`, onClick: () => void doDiscard(f.path), danger: true },
                            ]}
                          />
                        ))}
                      </div>
                    )}
                </Section>

                <Section
                  title="储藏（Stash）"
                  count={stashes.length}
                  closed={closed.stash}
                  onCaret={() => setClosed((c) => ({ ...c, stash: !c.stash }))}
                  actions={(
                    <button title="把当前所有改动（含未跟踪文件）存入储藏" onClick={() => { setStashBoxOpen(!stashBoxOpen) }}>
                      {stashBoxOpen ? '取消' : '储藏更改'}
                    </button>
                  )}
                >
                  {stashBoxOpen && (
                    <div style={{ display: 'flex', gap: 6, padding: '6px 10px', borderBottom: '1px solid var(--dsw-alias-border-l2,#d8dee4)' }}>
                      <input
                        type="text"
                        placeholder="储藏说明（可选），如 WIP 登录页"
                        value={stashMsg}
                        onChange={(e) => setStashMsg(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') void doStash() }}
                        style={{ flex: 1, minWidth: 0 }}
                      />
                      <BusyButton className="primary" loading={busy === 'stash'} disabled={status != null && status.total === 0} title="git stash push -u" onClick={() => void doStash()}>储藏</BusyButton>
                    </div>
                  )}
                  {stashes.length === 0
                    ? <div className="empty">没有储藏。改动想先放一边时，「储藏更改」会把它们（含未跟踪文件）安全存起来。</div>
                    : (
                      <div className="file-list">
                        {stashes.map((s) => (
                          <div key={s.ref} className="file" style={{ cursor: 'default' }} title={s.message}>
                            <span className="st st-r">⎌</span>
                            <span className="name">{s.message}</span>
                            <span className="ops">
                              <button title={`恢复并删除该储藏（git stash pop）`} onClick={() => void doStashPop(s.index)}>恢复</button>
                              <button className="danger" title="丢弃该储藏（不可恢复）" onClick={() => void doStashDrop(s.index)}>丢弃</button>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                </Section>

                {status && status.total === 0 && stashes.length === 0 && (
                  <div className="empty" style={{ textAlign: 'center' }}>✓ 工作区干净，没有更改</div>
                )}
              </div>

              {/* 右栏：差异 | 历史 */}
              <div className="main">
                <div className="tabs">
                  <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>差异</button>
                  <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>历史{commits.length > 0 ? ` (${commits.length})` : ''}</button>
                </div>

                {tab === 'diff' ? (
                  view ? (
                    <div className="diff-wrap">
                      <div className="pane-head">
                        <span className="title mono" title={view.file}>{view.fromCommit ? `${view.fromCommit.short} · ` : ''}{view.file}</span>
                        {bothModes
                          ? null /* 有模式切换时标签与按钮重复，省略 */
                          : <span className="tag">{view.kind === 'cached' ? '已暂存差异' : view.kind === 'worktree' ? '工作区差异' : view.kind === 'commit' ? '提交内差异' : '新文件预览'}</span>}
                        {bothModes && (
                          <span className="mode">
                            <button className={view.kind === 'cached' ? 'on' : ''} onClick={() => void openFile(view.file, 'cached')}>暂存差异</button>
                            <button className={view.kind === 'worktree' ? 'on' : ''} onClick={() => void openFile(view.file, 'worktree')}>工作区差异</button>
                          </span>
                        )}
                        <span className="hd-ops">
                          <button title="关闭" onClick={() => setView(null)}>✕</button>
                        </span>
                      </div>
                      {view.loading
                        ? <div className="empty"><span className="spinner" />加载中…</div>
                        : view.kind === 'file'
                          ? (
                            view.binary
                              ? <div className="empty">二进制文件，不支持预览。</div>
                              : (
                                <pre className="diff"><span className="dmeta">{view.truncated ? '（文件较大，仅显示前 512KB）\n' : ''}</span>{view.content || '（空文件）'}</pre>
                              )
                          )
                          : <pre className="diff" dangerouslySetInnerHTML={{ __html: diffHtml(view.content) }} />}
                    </div>
                  ) : (
                    <div className="diff-empty">← 点击左侧文件查看变更；切到「历史」可浏览提交，点开提交里的文件可查看当时的 diff</div>
                  )
                ) : (
                  <HistoryPane
                    commits={commits}
                    graph={graph}
                    loading={logLoading}
                    expanded={expanded}
                    detail={detail}
                    detailBusy={detailBusy}
                    onExpand={(h) => void expandCommit(h)}
                    onOpenFile={(h, s, f) => void openCommitFile(h, s, f)}
                    onReload={() => void loadCommits()}
                  />
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  )
}

/* ── 插件装配 ──────────────────────────────────────────────── */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.slots.inject('conversation.view', () =>
    ctx.slots.register({ name: 'conversation.view', id: '@daxu8972/dsh-git-panel', label: () => 'Git' }, GitPanel),
  ), 'dsh-git: conversation view panel')
}

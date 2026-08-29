/**
 * @daxu8972/dsh-git — git 子进程封装。
 *
 * 所有 git 操作统一走这里：用 `child_process.execFile` 在目标仓库目录里执行
 * `git`，返回结构化 JSON，供 HTTP API 面板与工具注册共用。
 * cmd = 'git' arg0 = subcommand，args = 子命令参数（不含 git 本身）。
 */
import { execFile } from 'node:child_process'
import { join } from 'node:path'

/** execFile 的异步化签名（含 input 的宽松版本），便于把 stdin 作为字符串写入。 */
type ExecFile = (
  file: string,
  args: readonly string[],
  options: { cwd: string; encoding: BufferEncoding; maxBuffer: number; timeout: number; windowsHide: boolean; input?: string },
) => Promise<{ stdout: string; stderr: string }>

const execFileAsync: ExecFile = (file, args, opts) =>
  // 规避 TS 对 execFile 回调重载的推断：直接 Promise 包裹。encoding='utf8' 时
  // stdout/stderr 实为 string，此处显式收窄。
  new Promise((resolve, reject) => {
    execFile(file, args, opts as any, (err, stdout, stderr) => {
      if (err) {
        ;(err as any).stdout = String(stdout)
        ;(err as any).stderr = String(stderr)
        reject(err)
        return
      }
      resolve({ stdout: String(stdout), stderr: String(stderr) })
    })
  })

/** git 子进程执行结果（stdout 已按 utf8 解码，剥离尾换行）。 */
export interface GitResult {
  /** 退出码；0 成功。 */
  code: number
  /** stdout（无失败时），已 trim。 */
  stdout: string
  /** stderr（失败反馈 / 进度信息）。 */
  stderr: string
  /** 失败原因（git 不在 PATH 等），用于抛出结构化解法。 */
  reason?: string
}

/** 一次超时的封装。 */
export interface RunGitOptions {
  /** 在 subcommand 后续加的额外参数（如 `add` → ['-A']）。 */
  args?: readonly string[]
  /** stdout 上限字节（默认 512KB，防面板拉爆生产日志）。 */
  maxStdout?: number
  /** PTY/交互场景强制输入（如 pull 合并信息）。 */
  stdin?: string
  /** 超时（ms，默认 60s）。 */
  timeoutMs?: number
}

export class GitExecError extends Error {
  readonly code: number
  readonly stderr: string
  constructor(result: GitResult) {
    super((result.stderr || result.stdout || `git 失败（exit ${result.code}）`).trim().slice(0, 2000))
    this.name = 'GitExecError'
    this.code = result.code
    this.stderr = result.stderr
  }
}

/** 在 cwd 仓库里执行一个 git 子命令。约定 `cmd` 从 api path 安全字面量而来。 */
export async function runGit(cwd: string, cmd: string, opts: RunGitOptions = {}): Promise<GitResult> {
  const max = opts.maxStdout ?? 512 * 1024
  const args = [cmd, ...(opts.args ?? [])]

  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf8',
      maxBuffer: max + 64 * 1024,
      timeout: opts.timeoutMs ?? 60_000,
      windowsHide: true,
      input: opts.stdin,
    })
    return { code: 0, stdout: stdout.trim(), stderr: stderr.trim() }
  } catch (err: any) {
    // child_process 语义：非零退出与 spawn 失败都到这里
    if (err && typeof err === 'object' && 'code' in err && typeof (err as any).code === 'number') {
      return {
        code: (err as any).code,
        stdout: String((err as any).stdout ?? '').trim(),
        stderr: String((err as any).stderr ?? '').trim(),
      }
    }
    // git 二进制缺失 / PATH 问题
    return {
      code: -1,
      stdout: '',
      stderr: '',
      reason: (err?.message || String(err)).slice(0, 500),
    }
  }
}

/** 成功的 stdout 否则抛 GitExecError。 */
export async function gitOk(cwd: string, cmd: string, opts?: RunGitOptions): Promise<string> {
  const r = await runGit(cwd, cmd, opts)
  if (r.code !== 0) throw new GitExecError(r)
  return r.stdout
}

// `--porcelain=v1 -b` 的首行是 `## master...origin/master [ahead 1, behind 2]`
// 或 `## HEAD (no branch)`（detached）。这里只取分支名部分。
const BRANCH_RE = /^## (.+?)(?:\.\.\.| \[|$)/

/** 解析 `git status --porcelain=v1 -b` 每行 → { index, worktree, path }。 */
export function parseStatus(porcelain: string): Array<{
  index: string
  worktree: string
  path: string
}> {
  return porcelain
    .split('\n')
    .filter((line) => line.length >= 3)
    .map((line) => ({
      index: line[0],
      worktree: line[1],
      path: line.slice(3),
    }))
}

/** 从 `-b` porcelain 首行解析当前分支（含 detached HEAD 情形）。 */
export function parseBranch(statusHead: string): string {
  const m = BRANCH_RE.exec(statusHead)
  if (m && m[1]) return m[1].trim()
  if (statusHead.startsWith('## HEAD')) return '(detached)'
  return '(unknown)'
}

export interface RepoStatus {
  path: string
  branch: string
  hasRemote: boolean
  /** 本地是否存在至少一个提交记录（`git rev-parse --verify HEAD` 是否成功）。 */
  hasCommits: boolean
  ahead: number
  behind: number
  staged: Array<{ index: string; worktree: string; path: string }>
  unstaged: Array<{ index: string; worktree: string; path: string }>
  untracked: Array<{ index: string; worktree: string; path: string }>
  total: number
}

/** 本地是否有任一提交（HEAD 能否解析）。 */
export async function hasCommits(path: string): Promise<boolean> {
  const r = await runGit(path, 'rev-parse', { args: ['--verify', 'HEAD'] })
  return r.code === 0
}

/** 给定仓库当前分支是否有已配置的上游（`git rev-parse --abbrev-ref @{u}`）。 */
export async function hasUpstream(path: string): Promise<boolean> {
  const r = await runGit(path, 'rev-parse', { args: ['--abbrev-ref', '@{u}'] })
  return r.code === 0
}

/** 当前分支名（`git branch --show-current`；detached 返回空）。 */
export async function currentBranch(path: string): Promise<string> {
  const r = await runGit(path, 'branch', { args: ['--show-current'] })
  return r.code === 0 ? r.stdout.trim() : ''
}

/**
 * 执行一次「会建上游」的推送：若当前分支没有上游，自动追加
 * `-u origin <branch>`（首次推送同时建立 origin/<branch> 跟踪）。
 * 返回最终的 git push 结果。
 */
export async function pushWithUpstream(path: string, extra: readonly string[] = []): Promise<GitResult> {
  const branch = await currentBranch(path)
  if (branch && !(await hasUpstream(path))) {
    const args = ['-u', 'origin', branch, ...extra]
    return runGit(path, 'push', { args, timeoutMs: 180_000 })
  }
  return runGit(path, 'push', { args: [...extra], timeoutMs: 180_000 })
}

/**
 * 聚合一个仓库的状态：分支 / 领先落后 / 已暂存 / 未暂存 / 未跟踪。
 */
export async function inspectRepo(path: string): Promise<RepoStatus> {
  const raw = await gitOk(path, 'status', {
    args: ['--porcelain=v1', '-b'],
    maxStdout: 4 * 1024 * 1024,
  })
  const lines = raw.split('\n')
  const head = lines[0] ?? ''
  const entries = lines.slice(1).filter((l) => l.length >= 3)
  const branch = parseBranch(head)
  // `## master...origin/master [ahead 1, behind 2]`
  const remoteTrack = /\.\.\.(\S+?)( \[.*)?$/.exec(head)
  const ahead = /ahead (\d+)/.exec(head)?.[1] ? Number(/ahead (\d+)/.exec(head)![1]) : 0
  const behind = /behind (\d+)/.exec(head)?.[1] ? Number(/behind (\d+)/.exec(head)![1]) : 0

  const staged: RepoStatus['staged'] = []
  const unstaged: RepoStatus['unstaged'] = []
  const untracked: RepoStatus['untracked'] = []
  for (const line of entries) {
    const index = line[0]
    const worktree = line[1]
    const path = line.slice(3)
    const rec = { index, worktree, path }
    if (index !== ' ' && index !== '?') staged.push(rec)
    else if (index === '?' && worktree === '?') untracked.push(rec)
    if (worktree !== ' ' && worktree !== '?') unstaged.push(rec)
  }
  return {
    path,
    branch,
    hasRemote: Boolean(remoteTrack),
    hasCommits: await hasCommits(path),
    ahead,
    behind,
    staged,
    unstaged,
    untracked,
    total: entries.length,
  }
}

/** 单个文件的 diff（path 可为目录，git 会自动带前缀）。 */
export async function diffOf(path: string, target?: string, staged = false): Promise<string> {
  return gitOk(path, 'diff', {
    args: [...(staged ? ['--cached'] : []), target ? ['--', target] : []].flat(),
    maxStdout: 8 * 1024 * 1024,
  })
}

/** 最近若干条提交（`%h %an %ad %s`，date=iso）。 */
export async function recentLog(path: string, n = 30): Promise<string> {
  return gitOk(path, 'log', {
    args: [`-${n}`, "--pretty=format:%h%x09%an%x09%ad%x09%s", '--date=iso'],
    maxStdout: 4 * 1024 * 1024,
  })
}

/** 本地分支（带 * 标记当前）。 */
export async function localBranches(path: string): Promise<string> {
  return gitOk(path, 'branch', { args: ['--list', '--no-color'] })
}

/** 解析 `git branch --list --no-color` 输出为分支名数组（当前分支排首位）。 */
export async function gitBranchList(path: string): Promise<{ current: string; branches: string[] }> {
  const raw = await localBranches(path)
  const branches: string[] = []
  let current = ''
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    if (trimmed.startsWith('* ')) {
      const name = trimmed.slice(2).trim()
      current = name
      branches.unshift(name)
    } else {
      branches.push(trimmed)
    }
  }
  return { current, branches }
}

/** 读取当前工作区状态，判断是否"干净"（无暂存/未暂存/未跟踪改动）。 */
export async function isWorkingTreeClean(path: string): Promise<boolean> {
  const r = await runGit(path, 'status', { args: ['--porcelain=v1'] })
  return r.code === 0 && r.stdout.trim() === ''
}

export interface SwitchBranchOptions {
  /** 目标分支名。 */
  branch: string
  /** 若目标分支不存在，是否自动创建（等价 `git switch -c`）。 */
  create?: boolean
  /** 未暂存改动存在时是否强制切换（等价 `git switch -f`）。 */
  force?: boolean
}

/**
 * 切换到指定分支。
 *  - 默认行为：`git switch <branch>`（工作区必须干净或已暂存）
 *  - create=true：`git switch -c <branch>`（新建并切换）
 *  - force=true：`git switch -f <branch>`（丢弃未暂存改动）
 *
 * 返回结果含 stdout/stderr 供调用方展示。
 */
export async function switchBranch(path: string, opts: SwitchBranchOptions): Promise<GitResult> {
  const args: string[] = []
  if (opts.force) args.push('-f')
  if (opts.create) args.push('-c')
  args.push(opts.branch)
  return runGit(path, 'switch', { args, timeoutMs: 60_000 })
}

/** 是否存在 git 仓库（根目录用 `rev-parse --is-inside-work-tree` 探测）。 */
export async function isRepo(path: string): Promise<boolean> {
  const r = await runGit(path, 'rev-parse', { args: ['--is-inside-work-tree'] })
  return r.code === 0 && r.stdout === 'true'
}

/**
 * 在一个工作区目录里找所有 git 仓库：
 *  - 工作区根目录本身算一个（若它是仓库）；
 *  - 直接子目录里是仓库的也算（一个工作区可含多个 git 项目）。
 * 用目录里是否存在 `.git` 粗筛，再用 `rev-parse` 验证是**有效**仓库
 * （存在残留空 `.git` 目录的工程根会被过滤掉）。
 */
export async function findGitRepos(root: string, depth = 1): Promise<string[]> {
  const result: string[] = []
  const fs = await import('node:fs')
  const candidates: string[] = []
  if (fs.existsSync(join(root, '.git'))) candidates.push(root)
  if (depth <= 1) {
    try {
      const entries = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name))
      for (const sub of entries) {
        if (fs.existsSync(join(sub, '.git'))) candidates.push(sub)
      }
    } catch {
      return result
    }
  }
  for (const dir of candidates) {
    if (await isRepo(dir)) result.push(dir)
  }
  return result
}

/**
 * 提交一条消息，语义对齐「改文件直接提交」：
 *  - 若已有暂存内容：直接 `git commit`（提交当前暂存区）；
 *  - 若暂存区为空但有未暂存「已跟踪」改动：先 `git add -u`
 *    （只暂存已跟踪改动，不含未跟踪文件），再 `git commit`。
 * 行为等价于 `git commit -a`，但更精细（不碰未跟踪文件）。
 */
export async function commitWithChanges(path: string, message: string): Promise<GitResult> {
  const hasStaged = (await runGit(path, 'diff', { args: ['--cached', '--quiet'], timeoutMs: 30_000 })).code !== 0
  const hasUnstagedTracked = (await runGit(path, 'diff', { args: ['--quiet'], timeoutMs: 30_000 })).code !== 0
  if (!hasStaged && hasUnstagedTracked) {
    const add = await runGit(path, 'add', { args: ['-u'], timeoutMs: 60_000 })
    if (add.code !== 0) return add
  }
  return runGit(path, 'commit', { args: ['-m', message], timeoutMs: 60_000 })
}

/**
 * 回滚单个未暂存文件的改动（`git restore <file>`）。
 * 仅对已跟踪文件有效；未跟踪文件（新文件）不适用。
 */
export async function restoreFile(path: string, file: string): Promise<GitResult> {
  return runGit(path, 'restore', { args: ['--', file], timeoutMs: 30_000 })
}

/**
 * 回滚所有未暂存的已跟踪文件改动（`git restore .`）。
 * 不影响暂存区，不影响未跟踪文件。
 */
export async function restoreAllFiles(path: string): Promise<GitResult> {
  return runGit(path, 'restore', { args: ['.'], timeoutMs: 60_000 })
}

/** 暂存单个文件（`git add <file>`）。 */
export async function stageFile(path: string, file: string): Promise<GitResult> {
  return runGit(path, 'add', { args: [file], timeoutMs: 30_000 })
}

/** 取消暂存单个文件（`git restore --staged <file>`）。不影响工作区改动。 */
export async function unstageFile(path: string, file: string): Promise<GitResult> {
  return runGit(path, 'restore', { args: ['--staged', '--', file], timeoutMs: 30_000 })
}

/** 取消暂存所有文件（`git restore --staged .`）。不影响工作区改动。 */
export async function unstageAll(path: string): Promise<GitResult> {
  return runGit(path, 'restore', { args: ['--staged', '.'], timeoutMs: 60_000 })
}

// ─── 结构化提交历史（IDEA 式日志） ─────────────────────────────

/** 一条提交记录（结构化，供历史面板渲染）。 */
export interface CommitEntry {
  /** 完整 hash（diff 等后续查询用）。 */
  hash: string
  /** 7 位短 hash（展示用）。 */
  short: string
  author: string
  /** ISO 时间。 */
  date: string
  subject: string
  /** 装饰（如 `HEAD -> master, origin/master`），可为空串。 */
  refs: string
  /** 父提交完整 hash 列表（root 提交为空数组；merge 提交有多个）。 */
  parents: string[]
}

/** 最近 N 条提交的结构化列表；空仓库（无提交）返回 []。 */
export async function structuredLog(path: string, n = 50): Promise<CommitEntry[]> {
  const r = await runGit(path, 'log', {
    args: [`-${n}`, '--date=iso', '--pretty=format:%H%x1f%h%x1f%an%x1f%ad%x1f%s%x1f%D%x1f%P%x1e'],
    maxStdout: 8 * 1024 * 1024,
  })
  if (r.code !== 0) return []
  return r.stdout
    .split('\x1e')
    .map((rec) => rec.replace(/^\n/, '').trim())
    .filter(Boolean)
    .map((rec) => {
      const [hash, short, author, date, subject, refs, parents] = rec.split('\x1f')
      return {
        hash: hash ?? '',
        short: short ?? '',
        author: author ?? '',
        date: date ?? '',
        subject: subject ?? '',
        refs: (refs ?? '').trim(),
        parents: (parents ?? '').split(' ').filter(Boolean),
      }
    })
    .filter((c) => c.hash)
}

// ─── Git Graph 泳道计算（VSCode Git Graph 式历史图） ───────────
// git log 保证「子提交先于父提交」输出，因此可以按输出顺序做泳道分配：
// 每个 lane 记录「期望出现的下一个 hash」，提交出现时消费对应 lane，
// 第一父提交沿原 lane 下行，其余父提交开新 lane 或汇入既有 lane。

/** 一条连线段（top: 行顶→节点；bottom: 节点→行底）。from===to 为直线穿过。 */
export interface GraphSegment { from: number; to: number; color: number }

/** 一行提交的泳道数据：节点位置 + 上下两半的连线段。 */
export interface GraphRowData {
  /** 节点所在 lane。 */
  lane: number
  /** 节点颜色索引（与 client 侧调色板对应）。 */
  color: number
  tops: GraphSegment[]
  bottoms: GraphSegment[]
}

/**
 * 泳道调色板。⚠ 必须与 client/src/ui.tsx 的 GRAPH_COLORS 保持同序同色，
 * color 字段存的是索引，两端各按自己的数组取色。
 */
export const GRAPH_COLORS = ['#3b82f6', '#22c55e', '#a855f7', '#f59e0b', '#ef4444', '#06b6d4', '#ec4899']

/** 由结构化提交列表计算每行的泳道渲染数据。 */
export function computeGraph(commits: Array<{ hash: string; parents: Array<string> }>): GraphRowData[] {
  const lanes: Array<{ hash: string | null; color: number }> = []
  let nextColor = 0
  const rows: GraphRowData[] = []

  /** 找一个空闲 lane（或追加）承载 hash，并分配新颜色。 */
  const alloc = (hash: string): { lane: number; color: number } => {
    const free = lanes.findIndex((l) => l.hash === null)
    const color = nextColor++ % GRAPH_COLORS.length
    if (free >= 0) {
      lanes[free] = { hash, color }
      return { lane: free, color }
    }
    lanes.push({ hash, color })
    return { lane: lanes.length - 1, color }
  }

  for (const c of commits) {
    // 本行之前已活动的 lane（alloc 发生在其后，天然不画悬空的 top 段）
    const activeAbove: number[] = []
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].hash !== null) activeAbove.push(i)
    }
    // 该提交的所有入口 lane（多个 = 多条分支线在此汇合，即 merge 节点）
    const incoming: number[] = []
    for (const i of activeAbove) {
      if (lanes[i].hash === c.hash) incoming.push(i)
    }
    if (incoming.length === 0) incoming.push(alloc(c.hash).lane)
    const nodeLane = incoming[0]
    const nodeColor = lanes[nodeLane].color

    // 上半段：指向本提交的 lane 曲线汇入节点，其余直线穿过
    const tops: GraphSegment[] = activeAbove.map((i) => ({
      from: i,
      to: incoming.includes(i) ? nodeLane : i,
      color: lanes[i].color,
    }))
    // 被汇合的入口 lane 释放（其线条终结于本节点）
    for (const i of incoming.slice(1)) lanes[i] = { hash: null, color: lanes[i].color }

    // 下半段：第一父提交沿 nodeLane 下行；其余父提交汇入既有 lane 或开新 lane
    const bottoms: GraphSegment[] = []
    const parents = c.parents
    if (parents.length > 0) {
      lanes[nodeLane] = { hash: parents[0], color: nodeColor }
      bottoms.push({ from: nodeLane, to: nodeLane, color: nodeColor })
    } else {
      // root 提交：线条终结于此
      lanes[nodeLane] = { hash: null, color: nodeColor }
    }
    for (const p of parents.slice(1)) {
      const exist = lanes.findIndex((l) => l.hash === p)
      if (exist >= 0) {
        // 父提交已在其它 lane 上等待：merge 曲线汇入该 lane（用节点颜色区分）
        bottoms.push({ from: nodeLane, to: exist, color: nodeColor })
      } else {
        const a = alloc(p)
        bottoms.push({ from: nodeLane, to: a.lane, color: a.color })
      }
    }
    // 直线穿过的 lane（上半行就存在、且未被本节点消费）补上 bottom 半段
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].hash === null || i === nodeLane) continue
      const existedAbove = tops.some((t) => t.from === i && t.to === i)
      if (existedAbove) bottoms.push({ from: i, to: i, color: lanes[i].color })
    }

    rows.push({ lane: nodeLane, color: nodeColor, tops, bottoms })
  }
  return rows
}

/** 一次提交里变更的单个文件。 */
export interface CommitFile {
  /** git name-status 状态字母：A/M/D/R/C/T/U/X。 */
  status: string
  path: string
  /** R/C 改名/复制时的原路径。 */
  prevPath?: string
}

/** 一次提交的概要 + 变更文件清单（`git show --name-status`）。 */
export async function commitDetail(path: string, hash: string): Promise<{ commit: CommitEntry | null; stat: string; files: CommitFile[] }> {
  const r = await runGit(path, 'show', {
    args: ['--name-status', '--shortstat', '--find-renames', '--date=iso', '--pretty=format:@@META@@%x09%H%x09%h%x09%an%x09%ad%x09%s%x09%D%x09%P', hash, '--'],
    maxStdout: 2 * 1024 * 1024,
  })
  if (r.code !== 0) throw new GitExecError(r)
  let commit: CommitEntry | null = null
  let stat = ''
  const files: CommitFile[] = []
  for (const line of r.stdout.split('\n')) {
    if (line.startsWith('@@META@@\t')) {
      const [, hash, short, author, date, subject, refs, parents] = line.split('\t')
      commit = { hash: hash ?? '', short: short ?? '', author: author ?? '', date: date ?? '', subject: subject ?? '', refs: (refs ?? '').trim(), parents: (parents ?? '').split(' ').filter(Boolean) }
      continue
    }
    if (/^\s*\d+\s+files?\s+changed/.test(line)) { stat = line.trim(); continue }
    const cols = line.split('\t')
    if (cols.length >= 2 && /^[AMDRCTUX]+$/.test(cols[0])) {
      if (cols.length >= 3 && (cols[0].startsWith('R') || cols[0].startsWith('C'))) {
        files.push({ status: cols[0], prevPath: cols[1], path: cols[2] })
      } else {
        files.push({ status: cols[0], path: cols[1] ?? '' })
      }
    }
  }
  return { commit, stat, files }
}

/** 某次提交里单个文件的 diff（`git show --format= <hash> -- <file>`；根提交同样适用）。 */
export async function commitFileDiff(path: string, hash: string, file: string): Promise<string> {
  return gitOk(path, 'show', {
    args: ['--format=', hash, '--', file],
    maxStdout: 8 * 1024 * 1024,
  })
}

// ─── 分支管理（本地 + 远程、删除） ─────────────────────────────

/** 本地 + 远程分支（远程形如 `origin/main`；`origin/HEAD` 已过滤）。 */
export async function allBranches(path: string): Promise<{ current: string; branches: string[]; remotes: string[] }> {
  const local = await gitBranchList(path)
  const r = await runGit(path, 'branch', { args: ['-r', '--no-color'] })
  const remotes = r.code === 0
    ? r.stdout.split('\n').map((l) => l.trim()).filter((l) => l && !l.includes('HEAD') && !l.includes(' -> '))
    : []
  return { ...local, remotes }
}

/** 删除本地分支（`git branch -d`；force 用 `-D`）。删除当前分支由调用方拦截。 */
export async function deleteBranch(path: string, branch: string, force = false): Promise<GitResult> {
  return runGit(path, 'branch', { args: [force ? '-D' : '-d', branch], timeoutMs: 30_000 })
}

// ─── Stash（储藏） ─────────────────────────────────────────────

/** 一条 stash 记录。 */
export interface StashEntry {
  /** 序号（对应 `stash@{n}`）。 */
  index: number
  /** 如 `stash@{0}`。 */
  ref: string
  /** 短 hash。 */
  short: string
  /** reflog 描述（如 `WIP on master: abc1234 msg`）。 */
  message: string
}

/** 解析 `git stash list --format=...` 输出。 */
export async function stashList(path: string): Promise<StashEntry[]> {
  const r = await runGit(path, 'stash', {
    args: ['list', '--pretty=format:%gd%x1f%gh%x1f%gs%x1e'],
    maxStdout: 1024 * 1024,
  })
  if (r.code !== 0 || !r.stdout) return []
  return r.stdout
    .split('\x1e')
    .map((s) => s.replace(/^\n/, '').trim())
    .filter(Boolean)
    .map((rec, i) => {
      const [ref, short, message] = rec.split('\x1f')
      return { index: i, ref: ref || `stash@{${i}}`, short: short ?? '', message: message ?? '' }
    })
}

/** 储藏当前改动（`git stash push [-u] [-m msg]`）。includeUntracked=true 时连未跟踪文件一起储藏。 */
export async function stashPush(path: string, message?: string, includeUntracked = true): Promise<GitResult> {
  const args = ['push']
  if (includeUntracked) args.push('-u')
  if (message) args.push('-m', message)
  return runGit(path, 'stash', { args, timeoutMs: 60_000 })
}

/** 恢复储藏（pop=恢复并删除；apply=恢复但保留）。 */
export async function stashApply(path: string, index: number, pop = true): Promise<GitResult> {
  return runGit(path, 'stash', { args: [pop ? 'pop' : 'apply', `stash@{${index}}`], timeoutMs: 60_000 })
}

/** 删除指定储藏（`git stash drop stash@{n}`）。 */
export async function stashDrop(path: string, index: number): Promise<GitResult> {
  return runGit(path, 'stash', { args: ['drop', `stash@{${index}}`], timeoutMs: 30_000 })
}

// ─── 丢弃改动 / 未跟踪文件预览 ─────────────────────────────────

/**
 * 丢弃一个文件的改动：
 *  - 已跟踪文件 → `git restore -- <file>`（还原到 HEAD/index）；
 *  - 未跟踪文件 → `git clean -f -- <file>`（直接删除）。
 * 两者都不可逆，调用方需先确认。
 */
export async function discardFile(path: string, file: string): Promise<GitResult> {
  const tracked = await runGit(path, 'ls-files', { args: ['--error-unmatch', '--', file], timeoutMs: 30_000 })
  if (tracked.code === 0) return restoreFile(path, file)
  return runGit(path, 'clean', { args: ['-f', '--', file], timeoutMs: 30_000 })
}

export interface WorktreeFile {
  /** 文本内容（binary=true 时为空串）。 */
  content: string
  /** 二进制文件（含 NUL 字节）不返回内容。 */
  binary: boolean
  /** 超过 512KB 被截断。 */
  truncated: boolean
  size: number
}

/** 读取一个未跟踪（或任意）工作区文件的内容供面板预览。路径越界（逃出仓库根）时抛错。 */
export async function readWorktreeFile(repoPath: string, file: string): Promise<WorktreeFile> {
  const fs = await import('node:fs')
  const pathMod = await import('node:path')
  const abs = pathMod.resolve(repoPath, file)
  const root = pathMod.resolve(repoPath)
  if (abs !== root && !abs.startsWith(root + pathMod.sep)) {
    throw new Error('路径越界：文件必须位于仓库目录内')
  }
  const stat = await fs.promises.stat(abs)
  const max = 512 * 1024
  const buf = await fs.promises.readFile(abs)
  // 前 8KB 出现 NUL 字节判定为二进制
  const probe = buf.subarray(0, 8192)
  const binary = probe.includes(0)
  const slice = binary ? Buffer.alloc(0) : buf.subarray(0, max)
  return { content: slice.toString('utf8'), binary, truncated: !binary && buf.length > max, size: stat.size }
}

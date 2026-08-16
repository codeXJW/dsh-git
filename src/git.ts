/**
 * @dsh-external/dsh-git — git 子进程封装。
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

/** 是否存在 git 仓库（根目录用 `rev-parse --is-inside-work-tree` 探测）。 */
export async function isRepo(path: string): Promise<boolean> {
  const r = await runGit(path, 'rev-parse', { args: ['--is-inside-work-tree'] })
  return r.code === 0 && r.stdout === 'true'
}

/**
 * 在一个工作区目录里找所有 git 仓库：
 *  - 工作区根目录本身算一个（若它是仓库）；
 *  - 直接子目录里是仓库的也算（一个工作区可含多个 git 项目）。
 * 用目录里是否存在 `.git` 判断；返回绝对路径列表。目录不可读时跳过。
 */
export async function findGitRepos(root: string, depth = 1): Promise<string[]> {
  const result: string[] = []
  const fs = await import('node:fs')
  if (fs.existsSync(join(root, '.git'))) result.push(root)
  if (depth <= 1) {
    let entries: string[] = []
    try {
      entries = fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => join(root, d.name))
    } catch {
      return result
    }
    for (const sub of entries) {
      if (fs.existsSync(join(sub, '.git'))) result.push(sub)
    }
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

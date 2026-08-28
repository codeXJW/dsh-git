/**
 * @daxu8972/dsh-git — host HTTP API 装配。
 *
 * 通过 `ctx.webServer` 注册一个 `/#PLUGIN#/api` 的 JSON 端点，浏览器端面板
 * 直接 fetch 它来读状态 / 跑 diff / 提交 / 拉取等可视化操作。
 * 每个请求都带 `path`（目标仓库绝对路径），缺省落到第一个工作区路径。
 */
import type { Context } from 'cordis'
import { GitExecError, allBranches, commitDetail, commitFileDiff, commitWithChanges, currentBranch, deleteBranch, diffOf, discardFile, findGitRepos, inspectRepo, isRepo, isWorkingTreeClean, pushWithUpstream, readWorktreeFile, restoreAllFiles, restoreFile, runGit, stashApply, stashDrop, stashList, stashPush, stageFile, structuredLog, switchBranch, unstageAll, unstageFile } from './git.js'

const PREFIX = '/@daxu8972/dsh-git/api'

/** host webserver 服务的最小可用面（运行期存在才挂载；编译期不依赖其包）。 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: any, res: any) => void | Promise<void>
  }): () => void
}

/** host workspace 注册表最小面：拿全部工作区（含 session→workspace 映射）。 */
interface WorkspaceLike {
  list(): Array<{ path: string; sessionIds: readonly string[] }>
}

type ApiContext = Context & {
  webServer: WebServerLike
  workspaceRegistry: WorkspaceLike
}

/** 允许跨 fetch 的 JSON 头。 */
function json(res: any, body: unknown, status = 200): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
    'cache-control': 'no-store',
  })
  res.end(text)
}

function badJson(res: any, message: string, status = 400): void {
  json(res, { ok: false, error: message }, status)
}

function ok(res: any, data: unknown): void {
  json(res, { ok: true, ...(data as Record<string, unknown>) })
}

function readBody(req: any): Promise<string> {
  return new Promise((resolve, reject) => {
    let acc = ''
    req.on('data', (c: Buffer) => {
      acc += c.toString('utf8')
      if (acc.length > 2 * 1024 * 1024) reject(new Error('body too large'))
    })
    req.on('end', () => resolve(acc))
    req.on('error', reject)
  })
}

/** 从 URL search 拿参数。 */
function param(url: URL, key: string): string | undefined {
  const v = url.searchParams.get(key)
  return v == null || v === '' ? undefined : v
}

const ALLOWED_COMMANDS = new Set([
  'add', 'commit', 'pull', 'push', 'fetch', 'checkout', 'reset',
])

export function mountGitApi(ctx: ApiContext): () => void {
  const ws = ctx.webServer

  /** 当前会话所属工作区目录；无 session 参数则取第一个工作区。 */
  function currentWorkspacePath(session?: string): string | undefined {
    const list = ctx.workspaceRegistry.list()
    if (session) {
      const hit = list.find((w) => w.sessionIds.includes(session as any))
      if (hit) return hit.path
    }
    return list.length > 0 ? list[0].path : undefined
  }

  /** 目标仓库解析：优先 ?path= 显式指定，否则取当前会话工作区里第一个 git 仓库。 */
  async function resolveRepo(url: URL, session?: string): Promise<string | null> {
    const explicit = param(url, 'path')
    if (explicit) return explicit
    const wsPath = currentWorkspacePath(session)
    if (!wsPath) return null
    const repos = await findGitRepos(wsPath)
    return repos.length > 0 ? repos[0] : null
  }

  const handler = async (req: any, res: any): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://x')
    const pathname = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()
    const rest = pathname.slice(PREFIX.length).replace(/^\/+/, '')
    const session = param(url, 'session')

    try {
      // /api/repos?session=<id> —— 返回「当前会话工作区里所有 git 仓库」候选
      if (method === 'GET' && rest === 'repos') {
        const wsPath = currentWorkspacePath(session)
        if (!wsPath) { ok(res, { repos: [], workspace: null }); return }
        const repos = await findGitRepos(wsPath)
        ok(res, { repos, workspace: wsPath })
        return
      }

      const repo = await resolveRepo(url, session)
      if (!repo) {
        badJson(res, '未找到可用 git 仓库（?path=/abs/repo 显式指定，或让当前会话工作区位于 git 仓库）')
        return
      }
      if (!(await isRepo(repo))) {
        badJson(res, `不是 git 仓库：${repo}`)
        return
      }

      // 只允许干净的只读命令段。
      switch (`${method} ${rest}`) {
        case 'GET status': {
          ok(res, { repo, status: await inspectRepo(repo) })
          return
        }
        case 'GET diff': {
          const target = param(url, 'file')
          const staged = param(url, 'staged') === '1'
          ok(res, { repo, diff: await diffOf(repo, target, staged) })
          return
        }
        case 'GET log': {
          const nRaw = Number(param(url, 'n') ?? 30)
          const n = Number.isFinite(nRaw) && nRaw > 0 ? Math.min(nRaw, 200) : 30
          // 结构化列表（新）；`lines` 保留为兼容旧客户端的 tab 文本格式
          const commits = await structuredLog(repo, n)
          const lines = commits.map((c) => [c.short, c.author, c.date, c.subject].join('\t'))
          ok(res, { repo, lines, commits })
          return
        }
        case 'GET branches': {
          const bl = await allBranches(repo)
          ok(res, { repo, current: bl.current, branches: bl.branches, remotes: bl.remotes })
          return
        }
        // 单次提交详情（变更文件清单 + shortstat）
        case 'GET commit': {
          const hash = param(url, 'hash')
          if (!hash) { badJson(res, '需要 hash 参数'); return }
          ok(res, await commitDetail(repo, hash))
          return
        }
        // 单次提交里某个文件的 diff
        case 'GET commit_diff': {
          const hash = param(url, 'hash')
          const file = param(url, 'file')
          if (!hash || !file) { badJson(res, '需要 hash 和 file 参数'); return }
          ok(res, { diff: await commitFileDiff(repo, hash, file) })
          return
        }
        // 工作区文件内容预览（未跟踪文件点开时用）
        case 'GET view': {
          const file = param(url, 'file')
          if (!file) { badJson(res, '需要 file 参数'); return }
          ok(res, await readWorktreeFile(repo, file))
          return
        }
        // stash 列表
        case 'GET stashes': {
          ok(res, { stashes: await stashList(repo) })
          return
        }
        case 'POST switch': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const branch = String(body.branch ?? '')
          if (!branch) { badJson(res, '需要 branch 字段'); return }
          const create = Boolean(body.create)
          const force = Boolean(body.force)
          if (!force) {
            const clean = await isWorkingTreeClean(repo)
            if (!clean) { badJson(res, '工作区有未提交的改动，请先提交或暂存，或传 force=true 强制切换', 422); return }
          }
          const result = await switchBranch(repo, { branch, create, force })
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git switch 失败（exit ${result.code}）`, code: result.code }, 422); return }
          const bl = await allBranches(repo)
          ok(res, { repo, stdout: result.stdout, current: bl.current, branches: bl.branches, remotes: bl.remotes })
          return
        }
        // 删除本地分支（当前分支会被拦截）
        case 'POST branch_delete': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const branch = String(body.branch ?? '')
          if (!branch) { badJson(res, '需要 branch 字段'); return }
          const current = await currentBranch(repo)
          if (branch === current) { badJson(res, `不能删除当前分支 ${branch}`, 422); return }
          const result = await deleteBranch(repo, branch, Boolean(body.force))
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git branch -d 失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, stdout: result.stdout, deleted: branch })
          return
        }
        // 储藏当前改动（含未跟踪文件）
        case 'POST stash': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const message = typeof body.message === 'string' && body.message.trim() ? body.message.trim() : undefined
          const result = await stashPush(repo, message, body.includeUntracked !== false)
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git stash 失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, stdout: result.stdout, stashes: await stashList(repo) })
          return
        }
        // 恢复储藏（pop 默认 true = 恢复并删除该条）
        case 'POST stash_apply': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const index = Number(body.index)
          if (!Number.isInteger(index) || index < 0) { badJson(res, '需要 index（stash 序号）'); return }
          const result = await stashApply(repo, index, body.pop !== false)
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git stash 恢复失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, stdout: result.stdout, stashes: await stashList(repo) })
          return
        }
        // 丢弃某条储藏
        case 'POST stash_drop': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const index = Number(body.index)
          if (!Number.isInteger(index) || index < 0) { badJson(res, '需要 index（stash 序号）'); return }
          const result = await stashDrop(repo, index)
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git stash drop 失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, stdout: result.stdout, stashes: await stashList(repo) })
          return
        }
        // 丢弃单个文件的改动（已跟踪=restore，未跟踪=clean 删除）
        case 'POST discard': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const file = String(body.file ?? '')
          if (!file) { badJson(res, '需要 file 字段'); return }
          const result = await discardFile(repo, file)
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `丢弃改动失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, file, stdout: result.stdout })
          return
        }
        case 'POST restore': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const file = body.file ? String(body.file) : ''
          if (file) {
            const result = await restoreFile(repo, file)
            if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git restore 失败（exit ${result.code}）` }, 422); return }
            ok(res, { repo, scope: 'single', file, stdout: result.stdout })
          } else {
            const result = await restoreAllFiles(repo)
            if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git restore 失败（exit ${result.code}）` }, 422); return }
            ok(res, { repo, scope: 'all', stdout: result.stdout })
          }
          return
        }
        case 'POST stage': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const file = String(body.file ?? '')
          if (!file) { badJson(res, '需要 file 字段'); return }
          const result = await stageFile(repo, file)
          if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `git add 失败（exit ${result.code}）` }, 422); return }
          ok(res, { repo, file, stdout: result.stdout })
          return
        }
        case 'POST unstage': {
          let body: any = {}
          try { body = JSON.parse((await readBody(req)) || '{}') } catch { badJson(res, '请求体需为 JSON'); return }
          const file = body.file ? String(body.file) : ''
          if (file) {
            const result = await unstageFile(repo, file)
            if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `取消暂存失败（exit ${result.code}）` }, 422); return }
            ok(res, { repo, scope: 'single', file, stdout: result.stdout })
          } else {
            const result = await unstageAll(repo)
            if (result.code !== 0) { json(res, { ok: false, error: result.stderr || `取消暂存失败（exit ${result.code}）` }, 422); return }
            ok(res, { repo, scope: 'all', stdout: result.stdout })
          }
          return
        }
        default: {
          // POST 写操作：必须在 ALLOWED_COMMANDS 里
          if (method !== 'POST') {
            badJson(res, `未知 GET 路由：${rest}`)
            return
          }
          if (!ALLOWED_COMMANDS.has(rest)) {
            badJson(res, `未知写操作：${rest}`)
            return
          }
          let body: any = {}
          try {
            body = JSON.parse((await readBody(req)) || '{}')
          } catch {
            badJson(res, '请求体需为 JSON')
            return
          }
          const subArgs = body.subargs ?? body.args ?? []
          const argList = Array.isArray(subArgs) ? subArgs : [String(subArgs)]
          // push：无上游自动 -u；commit：提交前自动暂存未暂存的已跟踪改动。
          let result
          if (rest === 'push') {
            result = await pushWithUpstream(repo, argList)
          } else if (rest === 'commit') {
            const mIdx = argList.indexOf('-m')
            const message = mIdx !== -1 && argList[mIdx + 1] ? argList[mIdx + 1] : (typeof body.message === 'string' ? body.message : '')
            result = await commitWithChanges(repo, message)
          } else {
            result = await runGit(repo, rest, { args: argList, stdin: body.stdin, timeoutMs: body.timeoutMs })
          }
          json(res, { ok: result.code === 0, repo, code: result.code, stdout: result.stdout, stderr: result.stderr })
        }
      }
    } catch (e) {
      if (e instanceof GitExecError) badJson(res, e.message, 422)
      else badJson(res, e instanceof Error ? e.message : String(e), 500)
    }
  }

  return ws.register({ kind: 'prefix', path: PREFIX, handler })
}

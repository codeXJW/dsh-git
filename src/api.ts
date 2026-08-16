/**
 * @dsh-external/dsh-git — host HTTP API 装配。
 *
 * 通过 `ctx.webServer` 注册一个 `/#PLUGIN#/api` 的 JSON 端点，浏览器端面板
 * 直接 fetch 它来读状态 / 跑 diff / 提交 / 拉取等可视化操作。
 * 每个请求都带 `path`（目标仓库绝对路径），缺省落到第一个工作区路径。
 */
import type { Context } from 'cordis'
import { GitExecError, diffOf, inspectRepo, isRepo, localBranches, recentLog, runGit } from './git.js'

const PREFIX = '/@dsh-external/dsh-git/api'

/** host webserver 服务的最小可用面（运行期存在才挂载；编译期不依赖其包）。 */
interface WebServerLike {
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: any, res: any) => void | Promise<void>
  }): () => void
}

/** host workspace 注册表最小面：拿全部仓库路径候选。 */
interface WorkspaceLike {
  list(): Array<{ path: string }>
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

  /** 解析目标仓库；缺省取第一个工作区路径。 */
  async function resolveRepo(url: URL): Promise<string | null> {
    const explicit = param(url, 'path')
    if (explicit) return explicit
    const reg = ctx.workspaceRegistry
    const list = reg.list()
    if (list.length > 0) return list[0].path
    return null
  }

  const handler = async (req: any, res: any): Promise<void> => {
    const url = new URL(req.url ?? '/', 'http://x')
    const pathname = url.pathname
    const method = (req.method ?? 'GET').toUpperCase()
    const rest = pathname.slice(PREFIX.length).replace(/^\/+/, '')

    try {
      // /api/repos —— 返回「工作区里所有 git 仓库」候选
      if (method === 'GET' && rest === 'repos') {
        const reg = ctx.workspaceRegistry
        const cands = reg.list().map((w) => w.path)
        const repos: string[] = []
        for (const p of cands) {
          if (await isRepo(p)) repos.push(p)
        }
        ok(res, { repos })
        return
      }

      const repo = await resolveRepo(url)
      if (!repo) {
        badJson(res, '未指定仓库路径（?path=/abs/dir）且无可用 DSH 工作区')
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
          const n = Number(param(url, 'n') ?? 30)
          ok(res, { repo, lines: await recentLog(repo, Number.isFinite(n) && n > 0 ? Math.min(n, 200) : 30) })
          return
        }
        case 'GET branches': {
          ok(res, { repo, branches: await localBranches(repo) })
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
          const result = await runGit(repo, rest, {
            args: Array.isArray(subArgs) ? subArgs : [String(subArgs)],
            stdin: body.stdin,
            timeoutMs: body.timeoutMs,
          })
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

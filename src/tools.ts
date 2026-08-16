/**
 * @dsh-external/dsh-git — 把常用 git 操作注册成 DSH 工具，让模型能直接驱动。
 * 这些工具与 HTTP API 共用同一套 git runner，实现「一次封装、双端复用」。
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { commitWithChanges, diffOf, gitOk, inspectRepo, pushWithUpstream, recentLog, runGit } from './git.js'

type AppContext = Context & {
  logger?: { info?(...a: any[]): void; warn?(...a: any[]): void }
}

/** 工具输出：git 文本 → model 文本块。 */
function text(s: string): any {
  return [{ type: 'text', text: s }]
}

export function registerGitTools(ctx: AppContext): () => void {
  const disposers: Array<() => void> = []

  /** 解析仓库路径。工具约定用 `path` 参数（绝对目录）。 */
  function repoOf(p?: string): string {
    if (p) return p
    throw new Error('需要 path（目标仓库绝对路径）')
  }

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_status',
    description: '查看一个 git 仓库的状态：当前分支、领先/落后远程、已暂存/未暂存/未跟踪文件。用于提交前快速了解变更。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { branch: { type: 'string' }, ahead: { type: 'integer' }, behind: { type: 'integer' }, staged: { type: 'integer' }, unstaged: { type: 'integer' }, untracked: { type: 'integer' } } },
      render(args: any, value: any) {
        return text(
          `分支 ${value.branch}（ahead ${value.ahead} / behind ${value.behind}）\n` +
          `已暂存 ${value.staged} 项 · 未暂存 ${value.unstaged} 项 · 未跟踪 ${value.untracked} 项`,
        )
      },
    },
    async execute(args) {
      const s = await inspectRepo(repoOf(args.path))
      return { branch: s.branch, ahead: s.ahead, behind: s.behind, staged: s.staged.length, unstaged: s.unstaged.length, untracked: s.untracked.length }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_diff',
    description: '查看 git 工作区未暂存（或 --cached 已暂存）的变更内容 diff。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      file: { type: 'string', description: '可选：只看某个文件/目录的 diff（相对路径）' },
      staged: { type: 'boolean', description: '为 true 时看已暂存（index）差异' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { diff: { type: 'string' } } },
      render(_a, value: any) { return text(value.diff || '（无差异）') },
    },
    async execute(args) {
      return { diff: await diffOf(repoOf(args.path), args.file, args.staged ?? false) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_log',
    description: '查看最近 N 条 git 提交（hash / 作者 / 时间 / 摘要）。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      n: { type: 'integer', description: '条数，默认 20' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { lines: { type: 'string' } } },
      render(_a, value: any) { return text(value.lines) },
    },
    async execute(args) {
      return { lines: await recentLog(repoOf(args.path), args.n ?? 20) }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_add',
    description: '把文件加入 git 暂存区。路径留空 = `git add -A` 全部。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      files: { type: 'array', items: { type: 'string' }, description: '可选：要 add 的文件路径列表，留空则全部' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' } } },
      render(_a, value: any) { return text(value.stdout || '已 add') },
    },
    isConcurrencySafe: () => true,
    async execute(args) {
      const f = (args.files ?? []).map(String).filter(Boolean)
      const std = await gitOk(repoOf(args.path), 'add', { args: f.length ? f : ['-A'] })
      return { stdout: std }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_commit',
    description: '提交一条消息。若暂存区为空但有未暂存的已跟踪改动，会自动先 git add -u 再提交（未跟踪文件不提交）。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      message: { type: 'string', description: '提交信息' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' } } },
      render(_a, value: any) { return text(value.stdout) },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const r = await commitWithChanges(repoOf(args.path), String(args.message ?? ''))
      if (r.code !== 0) throw new Error(r.stderr || r.stdout || `git commit 失败（exit ${r.code}）`)
      return { stdout: r.stdout }
    },
    presentCall(args: any) {
      return { card: 'generic' as const, title: `git commit: ${args.message}` }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_pull',
    description: '拉取远程更新（git pull）。可带额外参数如 --rebase。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      extra: { type: 'array', items: { type: 'string' }, description: '可选：额外 git 参数，如 ["--rebase"]' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, stderr: { type: 'string' } } },
      render(_a, value: any) { return text(value.stdout || value.stderr) },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const extra = (args.extra ?? []).map(String)
      const r = await runGit(repoOf(args.path), 'pull', { args: extra, timeoutMs: 180_000 })
      if (r.code !== 0) throw new Error(r.stderr || `git pull 失败（exit ${r.code}）`)
      return { stdout: r.stdout, stderr: r.stderr }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_push',
    description: '推送当前分支到远程。若当前分支没配置上游，自动 git push -u origin <branch>（首次推送建立跟踪）。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      extra: { type: 'array', items: { type: 'string' }, description: '可选：额外 git 参数' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, stderr: { type: 'string' } } },
      render(_a, value: any) { return text(value.stdout || value.stderr) },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const extra = (args.extra ?? []).map(String)
      const r = await pushWithUpstream(repoOf(args.path), extra)
      if (r.code !== 0) throw new Error(r.stderr || `git push 失败（exit ${r.code}）`)
      return { stdout: r.stdout, stderr: r.stderr }
    },
  })))

  return () => disposers.forEach((d) => d())
}

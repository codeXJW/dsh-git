/**
 * @daxu8972/dsh-git — 把常用 git 操作注册成 DSH 工具，让模型能直接驱动。
 * 这些工具与 HTTP API 共用同一套 git runner，实现「一次封装、双端复用」。
 */
import type { Context } from 'cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { commitDetail, deleteBranch, stashApply, stashDrop, stashList, stashPush } from './git.js'
import { commitWithChanges, diffOf, gitBranchList, gitOk, inspectRepo, isWorkingTreeClean, pushWithUpstream, recentLog, restoreAllFiles, restoreFile, runGit, switchBranch } from './git.js'

type AppContext = Context & {
  logger?: { info?(...a: any[]): void; warn?(...a: any[]): void }
}

/** 工具输出：git 文本 → model 文本块。 */
function text(s: string): any {
  return [{ type: 'text', text: s }]
}

/** stash 序号参数收窄：非法/缺省回落到 0（stash@{0}）。 */
function stashIndexOf(v: unknown): number {
  return typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : 0
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

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_switch',
    description: '切换分支。默认切换到已有分支；设 create=true 新建并切换；设 force=true 强制切换（丢弃未暂存改动）。切换前会检查工作区是否干净，不干净时提示用户。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      branch: { type: 'string', description: '目标分支名' },
      create: { type: 'boolean', description: '若目标分支不存在，是否自动创建（git switch -c）' },
      force: { type: 'boolean', description: '有未暂存改动时是否强制切换（git switch -f，会丢弃未暂存改动）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, branch: { type: 'string' }, current: { type: 'string' }, branches: { type: 'array', items: { type: 'string' } } } },
      render(_a, value: any) {
        return text(`已切换到 ${value.branch}\n\n当前所有分支：\n${value.branches.map((b: string) => (b === value.current ? '* ' : '  ') + b).join('\n')}`)
      },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const p = repoOf(args.path)
      const branch = String(args.branch ?? '')
      if (!branch) throw new Error('需要 branch（目标分支名）')

      // 安全检查：非 force 时工作区必须干净
      if (!args.force) {
        const clean = await isWorkingTreeClean(p)
        if (!clean) throw new Error('工作区有未提交的改动，请先提交或暂存，或使用 force=true 强制切换（会丢弃未暂存改动）')
      }

      const r = await switchBranch(p, {
        branch,
        create: Boolean(args.create),
        force: Boolean(args.force),
      })
      if (r.code !== 0) throw new Error(r.stderr || `git switch 失败（exit ${r.code}）`)

      const { current, branches } = await gitBranchList(p)
      return { stdout: r.stdout, branch: current, current, branches }
    },
    presentCall(args: any) {
      return { card: 'generic' as const, title: `git switch → ${args.branch}${args.create ? ' (新建)' : ''}${args.force ? ' (强制)' : ''}` }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_restore',
    description: '回滚未暂存的文件改动。传 file 回滚单个文件，不传 file 则回滚所有未暂存的已跟踪文件。不影响暂存区，不影响未跟踪文件。此操作不可逆。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      file: { type: 'string', description: '可选：要回滚的单个文件相对路径。不传则回滚所有未暂存改动' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, scope: { type: 'string' } } },
      render(_a, value: any) { return text(value.scope === 'single' ? `已回滚：${value.file}` : '已回滚所有未暂存改动') },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const p = repoOf(args.path)
      const file = args.file ? String(args.file) : ''
      if (file) {
        const r = await restoreFile(p, file)
        if (r.code !== 0) throw new Error(r.stderr || `git restore 失败（exit ${r.code}）`)
        return { stdout: r.stdout, scope: 'single', file }
      } else {
        const r = await restoreAllFiles(p)
        if (r.code !== 0) throw new Error(r.stderr || `git restore 失败（exit ${r.code}）`)
        return { stdout: r.stdout, scope: 'all' }
      }
    },
    presentCall(args: any) {
      return { card: 'generic' as const, title: args.file ? `git restore: ${args.file}` : 'git restore: 回滚全部' }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_stash',
    description: 'Stash（储藏）操作。action=list 列出储藏；action=push 储藏当前所有改动（含未跟踪文件，可带 message）；action=pop 恢复最近（或第 index 条）储藏并删除该条；action=apply 恢复但保留；action=drop 丢弃第 index 条储藏。pop/apply/drop 的 index 从 0 开始（对应 stash@{n}），不传默认 0。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      action: { type: 'string', description: 'list | push | pop | apply | drop，默认 list' },
      message: { type: 'string', description: 'action=push 时的储藏说明（可选）' },
      index: { type: 'integer', description: 'pop/apply/drop 的储藏序号（stash@{n} 的 n），默认 0' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, stashes: { type: 'string' } } },
      render(_a, value: any) { return text((value.stdout ? value.stdout + '\n\n' : '') + (value.stashes || '（当前无储藏）')) },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const p = repoOf(args.path)
      const action = String(args.action ?? 'list')
      if (action === 'push') {
        const r = await stashPush(p, args.message ? String(args.message) : undefined, true)
        if (r.code !== 0) throw new Error(r.stderr || `git stash push 失败（exit ${r.code}）`)
        const stashes = await stashList(p)
        return { stdout: r.stdout, stashes: stashes.map((s) => `${s.ref}: ${s.message}`).join('\n') }
      }
      if (action === 'pop' || action === 'apply') {
        const idx = stashIndexOf(args.index)
        const r = await stashApply(p, idx, action === 'pop')
        if (r.code !== 0) throw new Error(r.stderr || `git stash ${action} 失败（exit ${r.code}）`)
        const stashes = await stashList(p)
        return { stdout: r.stdout, stashes: stashes.map((s) => `${s.ref}: ${s.message}`).join('\n') }
      }
      if (action === 'drop') {
        const idx = stashIndexOf(args.index)
        const r = await stashDrop(p, idx)
        if (r.code !== 0) throw new Error(r.stderr || `git stash drop 失败（exit ${r.code}）`)
        const stashes = await stashList(p)
        return { stdout: r.stdout, stashes: stashes.map((s) => `${s.ref}: ${s.message}`).join('\n') }
      }
      const stashes = await stashList(p)
      return { stdout: '', stashes: stashes.map((s) => `${s.ref}: ${s.message}`).join('\n') }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_branch_delete',
    description: '删除本地分支（git branch -d；force=true 用 -D 强删）。不能删除当前所在分支。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      branch: { type: 'string', description: '要删除的分支名' },
      force: { type: 'boolean', description: '未合并也强制删除（git branch -D）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { stdout: { type: 'string' }, branches: { type: 'array', items: { type: 'string' } } } },
      render(_a, value: any) { return text(`已删除分支。\n\n当前所有分支：\n${value.branches.map((b: string) => '  ' + b).join('\n')}`) },
    },
    isConcurrencySafe: () => false,
    async execute(args) {
      const p = repoOf(args.path)
      const branch = String(args.branch ?? '')
      if (!branch) throw new Error('需要 branch（要删除的分支名）')
      const { current } = await gitBranchList(p)
      if (branch === current) throw new Error(`不能删除当前所在分支 ${branch}，请先切换到其他分支`)
      const r = await deleteBranch(p, branch, Boolean(args.force))
      if (r.code !== 0) throw new Error(r.stderr || `git branch -d 失败（exit ${r.code}）`)
      const { branches } = await gitBranchList(p)
      return { stdout: r.stdout, branches }
    },
    presentCall(args: any) {
      return { card: 'generic' as const, title: `git branch -d: ${args.branch}` }
    },
  })))

  disposers.push(ctx.tools.register(defineTool({
    name: 'git_commit_files',
    description: '查看某次提交变更了哪些文件（状态 A/M/D/R + 路径 + 变更统计），也可看提交说明。',
    parameters: {
      path: { type: 'string', description: '目标仓库绝对路径' },
      hash: { type: 'string', description: '提交 hash（完整或短 hash）' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { summary: { type: 'string' } } },
      render(_a, value: any) { return text(value.summary) },
    },
    isConcurrencySafe: () => true,
    async execute(args: any) {
      const p = repoOf(args.path)
      const hash = String(args.hash ?? '')
      if (!hash) throw new Error('需要 hash（提交 hash）')
      const d = await commitDetail(p, hash)
      const lines = [
        d.commit ? `${d.commit.short} ${d.commit.subject}（${d.commit.author} · ${d.commit.date}）` : '',
        d.stat,
        ...d.files.map((f) => `${f.status}\t${f.prevPath ? f.prevPath + ' -> ' : ''}${f.path}`),
      ].filter(Boolean)
      return { summary: lines.join('\n') }
    },
  })))

  return () => disposers.forEach((d) => d())
}

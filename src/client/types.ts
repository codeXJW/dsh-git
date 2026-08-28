/**
 * @daxu8972/dsh-git — client 面板共享类型。
 */
export interface GitFile { index: string; worktree: string; path: string }

export interface RepoStatus {
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

export interface CommitEntry {
  hash: string
  short: string
  author: string
  date: string
  subject: string
  refs: string
}

export interface CommitFile { status: string; path: string; prevPath?: string }

export interface CommitDetailPayload { commit: CommitEntry | null; stat: string; files: CommitFile[] }

export interface StashEntry { index: number; ref: string; short: string; message: string }

export interface BranchInfo { current: string; branches: string[]; remotes: string[] }

/** 右侧差异/预览视图的当前内容。 */
export interface DiffView {
  /** 展示的文件相对路径。 */
  file: string
  /** diff 来源：worktree=工作区差异；cached=已暂存差异；commit=某次提交的文件 diff；file=未跟踪文件内容预览。 */
  kind: 'worktree' | 'cached' | 'commit' | 'file'
  content: string
  loading: boolean
  /** kind=commit 时的提交信息。 */
  fromCommit?: { hash: string; short: string }
  binary?: boolean
  truncated?: boolean
}

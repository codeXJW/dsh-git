/**
 * @daxu8972/dsh-git — 历史面板（IDEA 式日志）。
 * 提交列表 → 点提交展开变更文件清单 → 点文件在右侧 diff 页查看该提交内此文件的 diff。
 */
import type { CommitDetailPayload, CommitEntry } from './types.js'
import { BusyButton, shortDate, statusMeta } from './ui.js'

/** refs 字段（如 `HEAD -> master, origin/master, tag: v1`）→ pill 描述数组。 */
function refPills(refs: string): Array<{ text: string; head: boolean }> {
  return (refs || '')
    .split(', ')
    .filter(Boolean)
    .filter((r) => !r.startsWith('tag: '))
    .map((r) => ({ text: r.replace(/^HEAD -> /, ''), head: r.startsWith('HEAD') }))
}

function fileStatusCls(status: string): string {
  if (status.startsWith('A')) return 'st-a'
  if (status.startsWith('D')) return 'st-d'
  if (status.startsWith('R') || status.startsWith('C')) return 'st-r'
  return 'st-m'
}

export function HistoryPane({ commits, loading, expanded, detail, detailBusy, onExpand, onOpenFile, onReload }: {
  commits: CommitEntry[]
  loading: boolean
  /** 当前展开的提交 hash。 */
  expanded: string | null
  /** 展开提交的详情（文件清单）。 */
  detail: CommitDetailPayload | null
  detailBusy: boolean
  onExpand: (hash: string) => void
  onOpenFile: (hash: string, short: string, file: string) => void
  onReload: () => void
}): React.ReactNode {
  if (loading && !commits.length) {
    return <div className="hist"><div className="empty"><span className="spinner" />加载提交历史…</div></div>
  }
  if (!commits.length) {
    return (
      <div className="hist">
        <div className="empty">还没有任何提交。完成第一次提交后，这里会显示提交历史。</div>
      </div>
    )
  }
  return (
    <div className="hist">
      <div className="pane-head">
        <span className="title">提交历史（{commits.length}）</span>
        <span className="hd-ops">
          <BusyButton loading={loading} onClick={onReload}>刷新</BusyButton>
        </span>
      </div>
      <div className="hist-list">
        {commits.map((c) => {
          const isOpen = expanded === c.hash
          const pills = refPills(c.refs)
          return (
            <div key={c.hash} className={'hist-row' + (isOpen ? ' expanded' : '')} onClick={() => onExpand(c.hash)}>
              <div className="subject" title={c.subject}>
                {c.subject}
                {pills.map((p) => (
                  <span key={p.text} className={'refpill' + (p.head ? ' head' : '')}>{p.text}</span>
                ))}
              </div>
              <div className="meta">
                <span className="hash">{c.short}</span>
                <span>{c.author}</span>
                <span>{shortDate(c.date)}</span>
              </div>
              {isOpen && (
                <div className="hist-detail" onClick={(e) => e.stopPropagation()}>
                  {detailBusy && !detail
                    ? <div className="empty"><span className="spinner" />加载变更文件…</div>
                    : (
                      <>
                        {detail?.stat && <div className="stat">{detail.stat}</div>}
                        {detail?.files.map((f) => (
                          <div
                            key={f.path}
                            className="hist-file"
                            title={`查看该提交中 ${f.path} 的 diff`}
                            onClick={() => onOpenFile(c.hash, c.short, f.prevPath ? f.prevPath : f.path)}
                          >
                            <span className={'st ' + fileStatusCls(f.status)}>{f.status[0]}</span>
                            <span className="hn">
                              {f.prevPath ? `${f.prevPath} → ${f.path}` : f.path}
                            </span>
                          </div>
                        ))}
                        {detail && detail.files.length === 0 && <div className="empty">（此提交没有文件变更）</div>}
                      </>
                    )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

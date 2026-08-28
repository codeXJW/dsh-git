/**
 * @daxu8972/dsh-git — 历史面板（VSCode Git Graph 式泳道图）。
 * 左侧 SVG 泳道图（彩色分支线 + 节点圆点），右侧提交信息与分支标签；
 * 点提交展开变更文件清单，点文件在右侧 diff 页查看该提交内此文件的 diff。
 */
import type { CommitDetailPayload, CommitEntry, GraphRowData, GraphSegment } from './types.js'
import { BusyButton, GRAPH_COLORS, shortDate } from './ui.js'

/** 与 .hist-row 的 CSS 高度保持一致。 */
const ROW_H = 30
const LANE_W = 13

/** refs 字段 → 带类型的标签（HEAD 分支 / 远程 / tag / 本地分支）。 */
function refPills(refs: string): Array<{ text: string; kind: 'head' | 'remote' | 'tag' | 'local' }> {
  return (refs || '')
    .split(', ')
    .filter(Boolean)
    .map((r) => {
      if (r.startsWith('HEAD -> ')) return { text: r.slice(8), kind: 'head' as const }
      if (r.startsWith('tag: ')) return { text: r.slice(5), kind: 'tag' as const }
      if (r === 'HEAD') return { text: 'HEAD', kind: 'head' as const }
      if (r.includes('/')) return { text: r, kind: 'remote' as const }
      return { text: r, kind: 'local' as const }
    })
}

function fileStatusCls(status: string): string {
  if (status.startsWith('A')) return 'st-a'
  if (status.startsWith('D')) return 'st-d'
  if (status.startsWith('R') || status.startsWith('C')) return 'st-r'
  return 'st-m'
}

/** 一行的泳道 SVG：上半段连线 + 下半段连线 + 节点圆点。 */
function GraphSvg({ row, maxLanes, isHead }: { row: GraphRowData; maxLanes: number; isHead: boolean }): React.ReactNode {
  const width = (maxLanes + 1) * LANE_W + 4
  const x = (lane: number): number => lane * LANE_W + LANE_W / 2 + 2
  const color = (s: GraphSegment): string => GRAPH_COLORS[s.color % GRAPH_COLORS.length]

  const seg = (s: GraphSegment, half: 'top' | 'bottom', key: string): React.ReactNode => {
    const y0 = half === 'top' ? 0 : ROW_H / 2
    const y1 = half === 'top' ? ROW_H / 2 : ROW_H
    if (s.from === s.to) {
      return <line key={key} x1={x(s.from)} y1={y0} x2={x(s.to)} y2={y1} stroke={color(s)} strokeWidth={2} />
    }
    const dy = (y1 - y0) / 2
    // 三次贝塞尔 S 曲线：两端切线均为竖直，保证与相邻行无缝衔接
    const d = `M ${x(s.from)} ${y0} C ${x(s.from)} ${y0 + dy} ${x(s.to)} ${y1 - dy} ${x(s.to)} ${y1}`
    return <path key={key} d={d} stroke={color(s)} strokeWidth={2} fill="none" />
  }

  return (
    <svg className="graph" width={width} height={ROW_H} aria-hidden>
      {row.tops.map((s, i) => seg(s, 'top', `t${i}`))}
      {row.bottoms.map((s, i) => seg(s, 'bottom', `b${i}`))}
      <circle
        cx={x(row.lane)}
        cy={ROW_H / 2}
        r={isHead ? 5 : 4.5}
        fill={GRAPH_COLORS[row.color % GRAPH_COLORS.length]}
        stroke="var(--dsw-alias-bg-layer-2,#fff)"
        strokeWidth={isHead ? 2.5 : 1.5}
      />
    </svg>
  )
}

export function HistoryPane({ commits, graph, loading, expanded, detail, detailBusy, onExpand, onOpenFile, onReload }: {
  commits: CommitEntry[]
  /** 与 commits 对齐的泳道数据（旧服务端可能没有，为空时退化为无图列表）。 */
  graph: GraphRowData[]
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

  // 泳道数据与提交数不一致（旧服务端 / 数据异常）时退化为无图列表
  const rows = graph.length === commits.length ? graph : null
  const maxLanes = rows
    ? rows.reduce((m, r) => {
      const laneMax = Math.max(
        r.lane,
        ...r.tops.map((s) => Math.max(s.from, s.to)),
        ...r.bottoms.map((s) => Math.max(s.from, s.to)),
      )
      return Math.max(m, laneMax)
    }, 0)
    : 0

  return (
    <div className="hist">
      <div className="pane-head">
        <span className="title">提交历史（{commits.length}）</span>
        <span className="hd-ops">
          <BusyButton loading={loading} onClick={onReload}>刷新</BusyButton>
        </span>
      </div>
      <div className="hist-list">
        {commits.map((c, i) => {
          const isOpen = expanded === c.hash
          const pills = refPills(c.refs)
          const isHead = pills.some((p) => p.kind === 'head')
          return (
            <div className="hist-item" key={c.hash}>
              <div className={'hist-row' + (isOpen ? ' expanded' : '')} onClick={() => onExpand(c.hash)}>
                {rows && <GraphSvg row={rows[i]} maxLanes={maxLanes} isHead={isHead} />}
                <span className="subject" title={c.subject}>
                  {c.subject}
                  {pills.map((p) => (
                    <span key={p.text} className={`refpill ${p.kind}`}>{p.text}</span>
                  ))}
                </span>
                <span className="meta">
                  <span className="hash" title={c.hash}>{c.short}</span>
                  <span className="author">{c.author}</span>
                  <span>{shortDate(c.date)}</span>
                </span>
              </div>
              {isOpen && (
                <div className="hist-detail">
                  {detailBusy && !detail
                    ? <div className="empty"><span className="spinner" />加载变更文件…</div>
                    : (
                      <>
                        {detail?.stat && <div className="stat">{detail.stat}</div>}
                        {detail?.commit && (
                          <div className="stat">
                            {detail.commit.hash.slice(0, 12)} · {detail.commit.author} · {detail.commit.date}
                          </div>
                        )}
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

/**
 * @daxu8972/dsh-git — client 面板样式（VSCode/IDEA 式布局）。
 * 用 DSH 设计 token（--dsw-alias-*），深浅色主题自动跟随宿主。
 */
export const CSS = `
.dsh-git{font:13px/1.6 system-ui,sans-serif;color:var(--dsw-alias-label-primary,#1f2328);padding:6px;max-width:1400px;margin:0 auto;width:100%;box-sizing:border-box}
.dsh-git h2{font-size:15px;margin:0 0 8px;font-weight:600}
.dsh-git button{font:inherit;padding:4px 10px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;cursor:pointer}
.dsh-git button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git button.primary{background:var(--dsw-alias-brand-primary,#2b5fdc);color:#fff;border-color:transparent}
.dsh-git button.primary:hover{filter:brightness(1.08)}
.dsh-git button.ghost{border-color:transparent;background:transparent}
.dsh-git button:disabled{opacity:.45;cursor:default;pointer-events:none}
.dsh-git button.loading{opacity:.65;cursor:progress}
.dsh-git select,.dsh-git input[type=text],.dsh-git textarea{font:inherit;padding:4px 8px;border-radius:7px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff);color:inherit;box-sizing:border-box}
.dsh-git select{width:auto;max-width:230px}
.dsh-git .meta{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:12px}
.dsh-git .mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
.dsh-git .err{color:#cf222e;background:rgba(207,34,46,.08);padding:6px 9px;border-radius:7px;margin:6px 0}
.dsh-git .spinner{width:12px;height:12px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;display:inline-block;vertical-align:-2px;margin-right:6px;animation:dshGitSpin .7s linear infinite;flex:none}
@keyframes dshGitSpin{to{transform:rotate(360deg)}}
.dsh-git .dsh-toast{position:fixed;top:16px;left:50%;transform:translateX(-50%);z-index:9999;padding:8px 16px;border-radius:8px;font:13px system-ui,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.18);animation:dshToastIn .2s ease;max-width:70vw;white-space:pre-wrap}
.dsh-git .dsh-toast.ok{background:#1a7f37;color:#fff}
.dsh-git .dsh-toast.err{background:#cf222e;color:#fff}
@keyframes dshToastIn{from{opacity:0;transform:translateX(-50%) translateY(-8px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}

/* ── 顶部工具栏 ─────────────────────────────── */
.dsh-git .toolbar{display:flex;gap:6px;align-items:center;flex-wrap:wrap;padding:2px 0 8px;position:relative}
.dsh-git .toolbar .spacer{flex:1}
.dsh-git .chip{display:inline-flex;align-items:center;gap:6px;font-weight:600;max-width:240px}
.dsh-git .chip .name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git .iconbtn{padding:4px 8px;line-height:1.2}
.dsh-git .iconbtn .counts{font-size:11px;margin-left:3px}
.dsh-git .pill{display:inline-block;font-size:11px;border-radius:9px;padding:0 8px;background:var(--dsw-alias-bg-layer-3,#eaeef2)}
.dsh-git .pill.up{color:#1a7f37}.dsh-git .pill.down{color:#9a6700}

/* ── 分支弹层（IDEA 分支部件式） ─────────────── */
.dsh-git .branch-menu{position:absolute;z-index:40;top:calc(100% - 2px);left:0;min-width:300px;max-width:380px;max-height:min(430px,60vh);overflow-y:auto;border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:10px;background:var(--dsw-alias-bg-layer-2,#fff);box-shadow:0 8px 28px rgba(31,35,40,.16);padding:8px;box-sizing:border-box}
.dsh-git .branch-menu .menu-search{display:flex;gap:6px;margin-bottom:6px}
.dsh-git .branch-menu .menu-search input{flex:1;min-width:0}
.dsh-git .branch-menu .menu-title{font-size:11px;font-weight:600;color:var(--dsw-alias-label-tertiary,#6e7781);text-transform:uppercase;letter-spacing:.04em;margin:8px 2px 2px}
.dsh-git .branch-row{display:flex;align-items:center;gap:6px;padding:4px 8px;border-radius:6px;cursor:pointer}
.dsh-git .branch-row:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .branch-row.current{font-weight:600}
.dsh-git .branch-row .tick{width:14px;color:var(--dsw-alias-brand-primary,#2b5fdc);flex:none}
.dsh-git .branch-row .bn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git .branch-row .del{visibility:hidden;border:none;background:none;color:#cf222e;cursor:pointer;padding:0 4px;border-radius:4px;font-size:12px}
.dsh-git .branch-row:hover .del{visibility:visible}
.dsh-git .branch-row .del:hover{background:rgba(207,34,46,.1)}
.dsh-git .branch-menu .menu-empty{padding:6px 8px;color:var(--dsw-alias-label-tertiary,#6e7781)}

/* ── 双栏主体 ───────────────────────────────── */
.dsh-git .columns{display:grid;grid-template-columns:minmax(280px,350px) minmax(0,1fr);gap:10px;align-items:start}
.dsh-git .side{display:flex;flex-direction:column;gap:8px;max-height:calc(100vh - 235px);overflow-y:auto;padding-right:2px}
.dsh-git .main{min-width:0;display:flex;flex-direction:column;gap:0}
@media (max-width:760px){.dsh-git .columns{grid-template-columns:1fr}.dsh-git .side{max-height:none}}

/* ── 提交框 ─────────────────────────────────── */
.dsh-git .commit-box{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;padding:8px;background:var(--dsw-alias-bg-layer-2,#fff)}
.dsh-git .commit-box textarea{width:100%;min-height:56px;max-height:180px;resize:vertical;line-height:1.5}
.dsh-git .commit-actions{display:flex;gap:6px;margin-top:6px;align-items:center;flex-wrap:wrap}
.dsh-git .commit-actions .hint{margin-left:auto;font-size:11px;color:var(--dsw-alias-label-tertiary,#6e7781)}

/* ── 可折叠分组（VSCode 源代码管理式） ───────── */
.dsh-git .section{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;overflow:hidden;background:var(--dsw-alias-bg-layer-2,#fff)}
.dsh-git .section>header{display:flex;align-items:center;gap:6px;padding:5px 8px;font-size:12px;font-weight:600;background:var(--dsw-alias-bg-layer-1,#f6f8fa);cursor:pointer;user-select:none}
.dsh-git .section>header .caret{display:inline-block;transition:transform .15s;font-size:10px;color:var(--dsw-alias-label-tertiary,#6e7781)}
.dsh-git .section.closed>header .caret{transform:rotate(-90deg)}
.dsh-git .section>header .cnt{color:var(--dsw-alias-label-tertiary,#6e7781);font-weight:400}
.dsh-git .section>header .hd-ops{margin-left:auto;display:flex;gap:4px}
.dsh-git .section>header .hd-ops button{font-size:11px;padding:1px 8px;border-radius:5px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:transparent;line-height:18px}
.dsh-git .section>header .hd-ops button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git .section>header .hd-ops button.danger{color:#cf222e;border-color:rgba(207,34,46,.25)}
.dsh-git .empty{padding:8px 10px;color:var(--dsw-alias-label-tertiary,#6e7781)}

/* ── 文件行 ─────────────────────────────────── */
.dsh-git .file-list{display:block}
.dsh-git .file{display:flex;gap:8px;align-items:center;padding:4px 10px;cursor:pointer;border-bottom:1px solid transparent}
.dsh-git .file:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .file.selected{background:var(--dsw-alias-bg-layer-3,#eaeef2)}
.dsh-git .file input[type=checkbox]{margin:0;width:14px;height:14px;cursor:pointer;flex:none}
.dsh-git .file .name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:ltr}
.dsh-git .file .ops{display:flex;gap:3px;flex:none;visibility:hidden}
.dsh-git .file:hover .ops,.dsh-git .file.selected .ops{visibility:visible}
.dsh-git .file .ops button{font-size:11px;padding:0 6px;border-radius:5px;line-height:18px;border:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-2,#fff)}
.dsh-git .file .ops button:hover{border-color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git .file .ops button.danger{color:#cf222e;border-color:rgba(207,34,46,.25)}
.dsh-git .file .ops button.danger:hover{background:rgba(207,34,46,.08)}
.dsh-git .st{width:16px;flex:none;text-align:center;font-size:11px;font-weight:700;line-height:1.4}
.dsh-git .st-a{color:#1a7f37}.dsh-git .st-m{color:#9a6700}.dsh-git .st-d{color:#cf222e}.dsh-git .st-r{color:#8250df}

/* ── 右侧标签页 ─────────────────────────────── */
.dsh-git .tabs{display:flex;gap:2px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dee4)}
.dsh-git .tabs button{border:none;background:none;box-shadow:none;padding:5px 14px;cursor:pointer;border-radius:7px 7px 0 0;border-bottom:2px solid transparent;font-weight:600;color:var(--dsw-alias-label-tertiary,#6e7781);margin-bottom:-1px}
.dsh-git .tabs button:hover{color:inherit;border-color:transparent;background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .tabs button.active{color:var(--dsw-alias-brand-primary,#2b5fdc);border-bottom-color:var(--dsw-alias-brand-primary,#2b5fdc);background:transparent}
.dsh-git .pane-head{display:flex;align-items:center;gap:8px;padding:7px 10px;border-bottom:1px solid var(--dsw-alias-border-l2,#d8dee4);background:var(--dsw-alias-bg-layer-1,#f6f8fa);border-radius:9px 9px 0 0;flex-wrap:wrap}
.dsh-git .pane-head .title{font-weight:600;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsh-git .pane-head .tag{font-size:11px;border-radius:9px;padding:0 8px;background:var(--dsw-alias-bg-layer-3,#eaeef2);flex:none}
.dsh-git .pane-head .mode{display:inline-flex;border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:6px;overflow:hidden;font-size:11px;flex:none}
.dsh-git .pane-head .mode button{border:none;border-radius:0;background:var(--dsw-alias-bg-layer-2,#fff);padding:0 8px;line-height:20px;font-size:11px}
.dsh-git .pane-head .mode button.on{background:var(--dsw-alias-brand-primary,#2b5fdc);color:#fff}
.dsh-git .pane-head .hd-ops{margin-left:auto;display:flex;gap:4px}
.dsh-git .pane-head .hd-ops button{font-size:11px;padding:1px 8px;border-radius:5px;line-height:18px}

/* ── diff / 文件预览 ─────────────────────────── */
.dsh-git pre.diff{margin:0;padding:8px 10px;overflow:auto;font:11px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;background:var(--dsw-alias-bg-layer-1,#f6f8fa);white-space:pre;border-radius:0 0 9px 9px;max-height:calc(100vh - 320px);tab-size:4}
.dsh-git pre.diff .dplus{color:#1a7f37;background:rgba(26,127,55,.08);display:inline-block;width:100%}
.dsh-git pre.diff .dminus{color:#cf222e;background:rgba(207,34,46,.08);display:inline-block;width:100%}
.dsh-git pre.diff .dhunk{color:#0550ae;background:rgba(9,105,218,.08);display:inline-block;width:100%}
.dsh-git pre.diff .dmeta{color:var(--dsw-alias-label-tertiary,#6e7781);display:inline-block;width:100%}
.dsh-git .diff-wrap{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;overflow:hidden}
.dsh-git .diff-empty{border:1px dashed var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;padding:28px 10px;text-align:center;color:var(--dsw-alias-label-tertiary,#6e7781)}

/* ── 历史面板（Git Graph 式泳道图） ───────────── */
.dsh-git .hist{border:1px solid var(--dsw-alias-border-l2,#d8dee4);border-radius:9px;overflow:hidden}
.dsh-git .hist-list{max-height:calc(100vh - 320px);overflow:auto}
.dsh-git .hist-item{border-bottom:1px solid var(--dsw-alias-border-l2,#d8dee4)}
.dsh-git .hist-item:last-child{border-bottom:none}
.dsh-git .hist-row{display:flex;align-items:center;gap:8px;height:30px;padding:0 10px 0 2px;cursor:pointer;min-width:0}
.dsh-git .hist-row:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .hist-row.expanded{background:var(--dsw-alias-bg-layer-3,#eaeef2)}
.dsh-git .hist-row svg.graph{flex:none;display:block}
.dsh-git .hist-row .subject{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}
.dsh-git .refpill{display:inline-block;font-size:10px;font-weight:600;border-radius:8px;padding:0 6px;margin-left:6px;vertical-align:1px;background:var(--dsw-alias-bg-layer-3,#eaeef2);color:var(--dsw-alias-label-tertiary,#57606a)}
.dsh-git .refpill.head{background:rgba(26,127,55,.14);color:#1a7f37}
.dsh-git .refpill.remote{background:rgba(9,105,218,.12);color:#0550ae}
.dsh-git .refpill.tag{background:rgba(159,106,13,.14);color:#9a6700}
.dsh-git .hist-row .meta{flex:none;display:flex;gap:8px;align-items:center;color:var(--dsw-alias-label-tertiary,#6e7781);font-size:11px}
.dsh-git .hist-row .meta .hash{font-family:ui-monospace,Menlo,monospace;color:var(--dsw-alias-brand-primary,#2b5fdc)}
.dsh-git .hist-detail{padding:4px 10px 8px 30px;background:var(--dsw-alias-bg-layer-2,#fff)}
.dsh-git .hist-detail .stat{color:var(--dsw-alias-label-tertiary,#6e7781);font-size:11px;margin:2px 0 4px}
.dsh-git .hist-file{display:flex;align-items:center;gap:8px;padding:3px 8px;border-radius:6px;cursor:pointer}
.dsh-git .hist-file:hover{background:var(--dsw-alias-bg-layer-1,#f6f8fa)}
.dsh-git .hist-file .hn{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,monospace;font-size:12px}
`

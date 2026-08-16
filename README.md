# @dsh-external/dsh-git

> DSH 外置 Git 插件 —— 把常用 Git 操作带进 DSH，既能当**模型工具**用，也能通过**可视化面板**点一点就完成「查看变更 / 提交 / 拉取 / 推送」。

`hybrid` 形态：服务端注册 git 工具（status/diff/log/add/commit/pull/push）+ 客户端 Git 标签页。

---

## 特性

| 能力 | 服务端工具 | 可视化面板 |
|------|:---:|:---:|
| 查看状态（分支/领先落后/变更清单） | `git_status` | ✅ |
| 查看 diff | `git_diff` | ✅ |
| 提交历史 | `git_log` | ✅ |
| 暂存 | `git_add` | ✅「暂存全部」 |
| 提交 | `git_commit` | ✅ 提交框 |
| 拉取 | `git_pull` | ✅ |
| 推送 | `git_push` | ✅ |
| fetch | — | ✅ |

**目标仓库**：默认取 DSH 当前打开的**工作区**目录（`ctx.workspaceRegistry`）；面板可直接在仓库下拉里切换。HTTP API 也可用 `?path=/abs/dir` 显式指定任意目录。

---

## 安装

### 方式 A：注入器（推荐，免重启）

在 DSH 注入器环境里：

```
dev_install_package {"dir": "<本插件目录绝对路径>"}
```

`dev_install_package` 会：改 profile `package.json`（dependencies + bundles）→ 建 `node_modules` junction → `loader.create` 动态加载。重启后由 `bundles` 列表正常装配。

### 方式 B：本地 tgz 安装

```bash
npm pack
# 得到 @dsh-external-dsh-git-0.1.0.tgz
```

然后作为普通依赖塞进你的 DSH profile：

```
dev_install_package {"dir": "<解压后的包目录>"}
# 或手动：把 tarball 里的 lib/ + package.json 放进 node_modules/@dsh-external/dsh-git
```

### 方式 C：npm registry（发布后）

```bash
npm install @dsh-external/dsh-git
```

再在 DSH 的 profile 里加载该 bundle（与内置 `dsh-skin` 同理）。

> 无论哪种方式，要求宿主 DSH 已装配 `dsh-tools`（工具）、`dsh-host-webserver` + `dsh-workspace`（面板 HTTP API）。这些是 DSH 自带插件，缺任意面板能力会优雅降级为「仅工具」。

---

## 开发 / 构建

使用与 DSH 同源 checkout 编译（依赖 `@deepseek-ai/dsh-tools` / `dsh-llm` 等内部包）：

```bash
DSH_CHECKOUT=<dsh-harness 源码根目录> bash scripts/build.sh   # 服务端 src → lib/
npm run build:client                                          # 浏览器端 → lib/client.js
```

> 需先 `npm install`（devDependencies 只有 typescript / tsdown / @types/node）。
> `build.sh` 会把 `vendor/cordis`、`packages/core/tools` 等以 junction 链到本地 `node_modules` 供编译。

构建产物：

```
lib/index.js      # 插件入口（apply）
lib/api.js        # HTTP /@dsh-external/dsh-git/api
lib/tools.js      # ctx.tools.register 工具
lib/git.js        # git 子进程封装
lib/client.js     # 浏览器面板（ModuleLoader.load 自动发现）
```

---

## 体系结构

```
浏览器（client.js）
  └─ Git 标签页（conversation.view 槽）──fetch──▶ HTTP JSON API
                                                    │
DSH host（apply）
  ├─ ctx.webServer.register('/@dsh-external/dsh-git/api')
  │     ├─ GET  /repos        工作区里的 git 仓库候选
  │     ├─ GET  /status       状态
  │     ├─ GET  /diff         diff（?file=&staged=1）
  │     ├─ GET  /log          提交历史
  │     ├─ GET  /branches     本地分支
  │     └─ POST /add|commit|pull|push|fetch|checkout|reset
  └─ ctx.tools.register(...)  git_status/git_diff/git_log/git_add/git_commit/git_pull/git_push
```

---

## 安全说明

- **写操作**通过 HTTP API 的 `POST /{cmd}` 到达，后端仅放行一个白名单命令集（`add/commit/pull/push/fetch/checkout/reset`）。
- 只读展示（status/diff/log）无需审批；模型驱动的写工具可配合 DSH 的 `approval`/`permission` 策略做审批。
- git 在 `PATH` 中必须可用；缺失时 API 返回结构化错误，面板给出提示。
- 面板与 API 均为**本机回环**使用（DSH web 进程），不暴露公网。

---

## License

MIT © 2026 @dsh-external

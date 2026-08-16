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
| 历史 | `git_log` | ✅ |

**目标仓库**：默认取 DSH 当前打开的**工作区**目录（`ctx.workspaceRegistry`）；一个工作区可有多个 git 项目（面板下拉切换）。HTTP API 也可用 `?path=/abs/dir` 显式指定任意目录。

---

## 安装使用（快速上手）

### 1. 安装插件

注入器是最快的装配方式（免重启）：

```
dev_install_package {"dir": "<本插件目录绝对路径>"}
```

重启后由 profile 的 `bundles` 列表正常装配。详见下方「安装」小节。

### 2. 打开 Git 面板

1. 打开 DSH Web 界面（默认 `http://127.0.0.1:3080`）
2. 进入一个会话，会话区域顶部会有一个**标签页环**（默认是「Chat」）
3. 点旁边的 **「Git」** 标签页 —— 就是可视化面板了
   > 若装完看不到 Git 标签，**刷新一下页面（F5）** 让浏览器加载最新 client bundle。

### 3. 使用面板

面板顶部是仓库下拉框（列出**当前工作区**里的所有 git 项目，可切换）。

- **查看变更**：左侧「已暂存」「未暂存」两组文件列表，点任一文件，右侧立刻显示该文件的 diff（绿 + 红高亮）
- **选择提交哪些**：每个文件行前有**复选框**，列表标题栏有**全选**；勾选后点「提交」就只提交勾选的文件
- **提交**：填提交信息 → 点「提交」。若暂存区为空但有已跟踪改动，会自动 `git add -u` 后提交（等价 `git commit -a`，未跟踪文件不会被自动提交）
- **操作按钮**：`暂存全部` / `提交` / `拉取` / `推送` / `Fetch` / `历史`
  - 每个操作点下，对应按钮会**转圈 loading**，完成后顶部弹出**绿色「✓」成功 toast**（提交/推送会附 hash），失败弹红色「✕」
  - 按钮按可用性置灰：无已暂存且无改动时「提交」灰；本地无任何提交时「推送」灰
- **历史**：点「历史」查看最近 30 条提交日志
- 提交成功后勾选自动清除、状态自动刷新

### 4. 在对话里让模型用 git（可选）

同一插件还注册了模型工具，你直接说：

> “帮我看看当前仓库有哪些变更”　“提交这些改动”　“拉取最新代码”

DSH 会用 `git_status` / `git_diff` / `git_log` / `git_add` / `git_commit` / `git_pull` / `git_push` 执行。

---

## GitHub 认证配置（重要，决定能否 push）

插件的提交是本地操作；**拉取 / 推送远端** 依赖你的机器能访问 GitHub。DSH 后端就是执行 git 命令，所以和你命令行 `git push` 的认证情况**完全一致**——如果命令行 push 要登录，面板 push 也会要。

> 💡 首次 push 若报 `Permission denied` / `Enter passphrase` / `connect to github`，都是认证没配好，先看下面。

### 推荐：SSH key（认机器，免密码）

1. **生成一个无口令的 key**（用 `cmd` 传空口令，避免 PowerShell 把引号当字面量）：
   ```bash
   ssh-keygen -t ed25519 -C yourname@machine -f %USERPROFILE%\.ssh\github_nopass -N ""
   ```
   > 一定要确认私钥**没有口令**：`ssh-keygen -y -P "" -f ...\.ssh\github_nopass` 能输出公钥才算成功。若提示要口令，说明 `-N ""` 传参被 shell 吃了（常见于 PowerShell），改用上面的 `cmd` 方式重新生成。

2. **把公钥上传到 GitHub**：复制 `.ssh/github_nopass.pub` 内容 → [github.com/settings/ssh/new](https://github.com/settings/ssh/new) → Title 随意、Key type `Authentication Key` → Add。

3. **让 git 用这个 key**（追加到 `~/.ssh/config`，并让 `IdentitiesOnly yes` 避免混用其他 key）：
   ```
   Host github.com
     HostName github.com
     User git
     IdentityFile ~/.ssh/github_nopass
     IdentitiesOnly yes
   ```

4. **把仓库远程切到 SSH**：
   ```
   git remote set-url origin git@github.com:<owner>/<repo>.git
   ```

5. **验证**：`ssh -T git@github.com` 应回 `Hi <owner>! ... successfully authenticated`。

### 备选：HTTPS + token

1. 在 GitHub 生成一个 PAT（Personal Access Token），勾选 `repo` 写权限。
2. 存入本地凭据（`credential.helper` 用 `store` 时写在 `~/.git-credentials`），或首次 push 时按提示输入用户名 + token。
3. 保持 origin 为 `https://github.com/<owner>/<repo>.git`。

> ⚠️ **常见坑**：不要在你的 git config 里设置 `url.https://github.com/.insteadof = git@github.com:` 这类全局重写——它会把 SSH 地址强制转成 HTTPS，导致既要 SSH key 又要 HTTPS 凭据，反而触发登录弹窗。如需 HTTPS+token 就统一用 HTTPS；如需 SSH 就统一 SSH，别混。

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

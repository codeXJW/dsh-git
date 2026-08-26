/**
 * @daxu8972/dsh-git — DSH 外置 Git 插件（hybrid）。
 *
 * 服务端装配两块能力，彼此共用同一套 git runner：
 *  1. `ctx.webServer` → HTTP JSON API（`/@daxu8972/dsh-git/api`），供浏览器端
 *     可视化面板 fetch（读状态 / diff / log / 提交 / 拉取 / 推送）。
 *  2. `ctx.tools.register` → 把 git_status/git_diff/… 注册成模型可见工具。
 *
 * 客户端（src/client/）则把面板挂进 `conversation.view` 槽，变成一个 Git 标签页。
 */
import type { Context } from 'cordis'
import { mountGitApi } from './api.js'
import { registerGitTools } from './tools.js'

export const name = '@daxu8972/dsh-git'

// 服务端依赖：
//   - tools：git 工具注册（@deepseek-ai/dsh-tools）
//   - webServer / workspaceRegistry：HTTP 面板 API 与默认仓库解析（DSH 自带）
// 三者皆为 DSH 内置、web profile 必然装配。
export const inject = ['tools', 'webServer', 'workspaceRegistry']

export function apply(ctx: Context): void {
  // 1) 注册 git 工具（模型可直接驱动）
  const toolsDispose = registerGitTools(ctx)

  // 2) 注册 HTTP 面板 API（webServer / workspaceRegistry 已通过 inject 注入）
  const apiDispose = mountGitApi(ctx as Context & { webServer: any; workspaceRegistry: any })

  ctx.logger?.info?.('[dsh-git] 已装配：git 工具 + HTTP 面板 API')

  // 卸载清理（cordis Events 未声明 'dispose' 字符串字面量，这里显式标注 any）
  ctx.on('dispose' as any, () => {
    try { toolsDispose() } catch { /* ignore */ }
    try { apiDispose() } catch { /* ignore */ }
  })
}

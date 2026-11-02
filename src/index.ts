/**
 * dsh-game —— 让 DeepSeek Harness "真的知道"游戏内容。
 *
 * v0.1（P0）只做**已实测跑通**的源：
 *   - BWIKI（wiki.biligame.com/<slug>/api.php，MediaWiki Action API）
 *
 * 实测事实（2026-11-02）：
 *   - /yingzhiren 影之刃 WIKI 可用：搜索、parse 正文都能取；
 *   - **限流很凶**：连续几次请求就返回 HTTP 567（未知状态=被限），
 *     冷却 ~25 秒后单个请求恢复 → 必须串行 + 最小间隔 + 退避 + 缓存。
 *
 * 不做的源（按"只做能抓到内容的"原则）：
 *   - 游民星空 / 游侠 / 3DM：无公开 API、反爬、攻略是分页图集，抓下来也难摘要；
 *   - 灰机wiki：api.php 实测 403（未通，暂不接）。
 */
import type { Context } from '@deepseek-ai/cordis'

import { Config, resolveConfig, type ConfigShape } from './config.js'

import { GameRegistry } from './registry.js'
import { registerTools } from './tools.js'
import { WikiClient } from './wiki.js'

export { Config }

export const name = 'dsh-game'

/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export const inject = ['tools']

const LEVEL_RANK = { debug: 0, info: 1, warn: 2 } as const
type Level = keyof typeof LEVEL_RANK

export function apply(ctx: Context, rawConfig: ConfigShape): void {
  const config = resolveConfig(rawConfig)
  const threshold = LEVEL_RANK[config.logLevel] ?? 1
  const log = (level: Level, message: string): void => {
    if ((LEVEL_RANK[level] ?? 1) < threshold) return
    const line = '[dsh-game] ' + message
    if (level === 'warn') console.warn(line)
    else console.log(line)
  }

  const registry = new GameRegistry({
    file: config.registryFile === '' ? undefined : config.registryFile,
    log,
  })
  const wiki = new WikiClient({
    minIntervalMs: config.minIntervalMs,
    cacheTtlMs: Math.max(0, config.cacheTtlMinutes) * 60_000,
    timeoutMs: config.timeoutMs,
    userAgent: config.userAgent,
    maxRetries: config.maxRetries,
    log,
  })

  registerTools(ctx, { registry, wiki, maxChars: config.maxReplyChars, log })

  // 给通道留可选服务入口：ctx.get('dshGame') 存在时，napcat 之类可以直接调
  try {
    const host = ctx as unknown as { provide?: (name: string, value: unknown) => void }
    host.provide?.('dshGame', {
      list: () => registry.list(),
      resolve: (name: string) => registry.resolve(name),
      search: (game: string, keyword: string) => wiki.search(registry.site(game), keyword),
      read: (game: string, title: string) => wiki.read(registry.site(game), title),
    })
  } catch {
    log('debug', '宿主不支持 provide(dshGame)，跳过服务注册（工具仍可用）')
  }

  log('info', 'dsh-game 已加载（源：BWIKI；游戏表 ' + registry.size() + ' 个）')
}

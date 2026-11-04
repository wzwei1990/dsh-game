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
import { TermStore, matchTerms } from './terms.js'
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
  const termStore = new TermStore({
    ttlDays: config.termsTtlDays,
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

  registerTools(ctx, {
    registry,
    wiki,
    terms: termStore,
    maxChars: config.maxReplyChars,
    minIntervalMs: config.minIntervalMs,
    reverifyDays: config.reverifyDays,
    termsMaxPages: config.termsMaxPages,
    log,
  })

  /**
   * 词表预热：插件加载后在后台把每个已收录游戏的词表补齐（不阻塞启动）。
   * 用户不需要手动跑 game_terms —— 这里是幂等的：有缓存直接跳过，过期才重建。
   */
  const warmTerms = (): void => {
    const games = registry.list().filter(entry => entry.status === 'active')
    for (const [index, entry] of games.entries()) {
      // 串行 + 间隔：BWIKI 限流很凶，别在启动时并发打
      setTimeout(() => {
        void termStore.warm(entry.name, entry.site, wiki, config.termsMaxPages)
          .then(result => {
            if (result !== undefined) log('info', '词表就绪：' + entry.name + '（' + result.terms.size + ' 个词）')
          })
          .catch(() => undefined)
      }, index * (config.minIntervalMs + 1000))
    }
  }
  warmTerms()

  // 给通道留可选服务入口：ctx.get('dshGame') 存在时，napcat 之类可以直接调
  try {
    const host = ctx as unknown as { provide?: (name: string, value: unknown) => void }
    host.provide?.('dshGame', {
      list: () => registry.list(),
      resolve: (name: string) => registry.resolve(name),
      search: (game: string, keyword: string) => wiki.search(registry.site(game), keyword),
      read: (game: string, title: string, options?: { maxChars?: number; section?: number }) =>
        wiki.read(registry.site(game), title, options ?? {}),
      terms: (game: string) => termStore.get(game, registry.site(game).slug),
      /** 词表召回：给通道判断"这条消息在聊哪个游戏"用（只召回，不判断） */
      detect: async (text: string) => {
        const out: Array<{ game: string; hits: string[]; pages: string[] }> = []
        for (const entry of registry.list()) {
          if (entry.status !== 'active') continue
          const index = termStore.get(entry.name, entry.site.slug)
          if (index === undefined) {
            // 还没建好：后台补建（不阻塞本次召回），下次就能命中
            void termStore.warm(entry.name, entry.site, wiki, config.termsMaxPages).catch(() => undefined)
            continue
          }
          const hits = matchTerms(text, index.terms)
          if (hits.length === 0) continue
          out.push({
            game: entry.name,
            hits,
            pages: hits.map(term => index.terms.get(term) ?? term),
          })
        }
        return out.sort((a, b) => b.hits.length - a.hits.length)
      },
    })
  } catch {
    log('debug', '宿主不支持 provide(dshGame)，跳过服务注册（工具仍可用）')
  }

  log('info', 'dsh-game 已加载（源：BWIKI；游戏表 ' + registry.size() + ' 个）')
}

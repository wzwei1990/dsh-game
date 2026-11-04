/**
 * 词表：用 GWIKI 的全站页面标题做"本游戏有哪些专有名词"。
 *
 * 用途：群聊里没人会说游戏全名（实测 200 条里 0 次），但会说地名/道具名/Boss 名。
 * 词表负责把这些词认出来，交给模型判断"是不是在聊这个游戏、要不要查 wiki"。
 *
 * 只做**召回**，不做判断：命中不等于要查，模型自己决定。
 */
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

import type { GameSite } from './registry.js'
import type { WikiClientLike } from './wiki.js'

export interface TermIndex {
  /** 标准名（游戏名） */
  game: string
  slug: string
  /** 词 → 页面标题（页面标题可能比词更长，如 庞镇 → 庞镇后街小院钥匙） */
  terms: Map<string, string>
  builtAt: number
}

export interface TermHit {
  game: string
  terms: string[]
  pages: string[]
}

/** 明显不是"名词"的页面标题（测试页、管理页、视频号、模板类） */
const NOISE = [
  /^BV[0-9A-Za-z]{10,}$/,
  /测试/,
  /管理$/,
  /后台$/,
  /^模板:/,
  /^分类:/,
  /^文件:/,
  /^MediaWiki:/,
  /^帮助:/,
  /^沙盒/,
  /^\d+$/,
]

/** 通用词：太泛，做词表只会误命中（"任务""攻略"这种到处都出现） */
const GENERIC = new Set([
  '任务', '系统', '攻略', '地图', '角色', '武器', '材料', '技能', '成就', '版本', '活动', '装备', '道具',
  '副本', '剧情', '图鉴', '进度', '存档', '难度', '设置', '操作', '玩法', '界面', '奖励', '商店', '菜单',
  '列表', '总览', '首页', '导航', '分类', '说明', '介绍', '机制', '攻略组', '视频', '音乐', '美术',
])

/** 标题 → 可用作词表的名词（2~8 字，去掉括号补充说明） */
export function toTerm(title: string): string | undefined {
  const base = title.replace(/[（(].*?[）)]/g, '').trim()
  if (base.length < 2 || base.length > 8) return undefined
  if (NOISE.some(pattern => pattern.test(base))) return undefined
  // 纯标点/纯英文短串（如 BOSS 这种通用词）不要
  if (/^[A-Za-z0-9\s]+$/.test(base)) return undefined
  if (/^(BOSS|NPC|PVP|PVE|DLC|MOD)$/i.test(base)) return undefined
  if (GENERIC.has(base)) return undefined
  return base
}

export function buildTermMap(titles: readonly string[]): Map<string, string> {
  const terms = new Map<string, string>()
  for (const title of titles) {
    const term = toTerm(title)
    if (term === undefined) continue
    // 同一个词保留更短的页面标题（更可能是主条目）
    const existing = terms.get(term)
    if (existing === undefined || title.length < existing.length) terms.set(term, title)
  }
  return terms
}

/** 最长匹配：返回命中的词（按长度降序，最多 limit 个） */
export function matchTerms(text: string, terms: Map<string, string>, limit = 4): string[] {
  const hits: string[] = []
  for (const term of terms.keys()) {
    if (term.length >= 2 && text.includes(term)) hits.push(term)
  }
  return hits.sort((a, b) => b.length - a.length).slice(0, limit)
}

export interface TermStoreOptions {
  file?: string
  /** 词表有效期（天） */
  ttlDays: number
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

interface CachedTerms {
  version: 1
  game: string
  slug: string
  builtAt: number
  titles: string[]
}

/** 词表缓存：~/.dsh/dsh-game/terms/<game>.json */
export class TermStore {
  private readonly ttlMs: number
  private readonly log: (level: 'debug' | 'info' | 'warn', message: string) => void
  private readonly root: string
  private readonly memory = new Map<string, TermIndex>()
  /** 正在建的词表（并发去重） */
  private readonly inflight = new Map<string, Promise<TermIndex | undefined>>()

  constructor(options: TermStoreOptions) {
    const dshHome = process.env.DSH_HOME
    this.root = options.file ?? join(dshHome !== undefined && dshHome !== '' ? dshHome : join(homedir(), '.dsh'), 'dsh-game', 'terms')
    this.ttlMs = Math.max(0, options.ttlDays) * 24 * 60 * 60_000
    this.log = options.log ?? (() => undefined)
  }

  private fileOf(game: string, slug: string): string {
    const safe = createHash('sha1').update(slug + '|' + game).digest('hex').slice(0, 12)
    return join(this.root, safe + '.json')
  }

  /** 读缓存（含内存缓存）；过期返回 undefined */
  get(game: string, slug: string, now = Date.now()): TermIndex | undefined {
    const key = slug + '|' + game
    const mem = this.memory.get(key)
    if (mem !== undefined) {
      if (this.ttlMs === 0 || now - mem.builtAt < this.ttlMs) return mem
      this.memory.delete(key)
    }
    try {
      const raw = JSON.parse(readFileSync(this.fileOf(game, slug), 'utf8')) as CachedTerms
      if (!Array.isArray(raw.titles) || raw.titles.length === 0) return undefined
      if (this.ttlMs > 0 && now - raw.builtAt >= this.ttlMs) return undefined
      const index: TermIndex = { game, slug, terms: buildTermMap(raw.titles), builtAt: raw.builtAt }
      this.memory.set(key, index)
      return index
    } catch {
      return undefined
    }
  }

  /** 落盘（调用方负责先拉 titles） */
  save(game: string, slug: string, titles: readonly string[]): TermIndex {
    const builtAt = Date.now()
    const payload: CachedTerms = { version: 1, game, slug, builtAt, titles: [...titles] }
    try {
      mkdirSync(dirname(this.fileOf(game, slug)), { recursive: true })
      writeFileSync(this.fileOf(game, slug), JSON.stringify(payload), 'utf8')
    } catch (error) {
      this.log('warn', '写词表失败: ' + (error instanceof Error ? error.message : String(error)))
    }
    const index: TermIndex = { game, slug, terms: buildTermMap(titles), builtAt }
    this.memory.set(slug + '|' + game, index)
    return index
  }

  /** 后台预热：没缓存就建；同一个游戏并发调用只建一次（不阻塞调用方） */
  async warm(game: string, site: GameSite, wiki: WikiClientLike, maxPages = 3): Promise<TermIndex | undefined> {
    const cached = this.get(game, site.slug)
    if (cached !== undefined) return cached
    const key = site.slug + '|' + game
    const running = this.inflight.get(key)
    if (running !== undefined) return running
    const task = this.ensure(game, site, wiki, maxPages)
      .finally(() => { this.inflight.delete(key) })
    this.inflight.set(key, task)
    return task
  }

  /** 拉词表（缓存过期/不存在时拉一次 allpages） */
  async ensure(game: string, site: GameSite, wiki: WikiClientLike, maxPages = 3): Promise<TermIndex | undefined> {
    const cached = this.get(game, site.slug)
    if (cached !== undefined) return cached
    try {
      const titles = await wiki.allpages(site, maxPages)
      if (titles.length === 0) return undefined
      const index = this.save(game, site.slug, titles)
      this.log('info', '词表已建立：' + game + '（' + index.terms.size + ' 个词，页面 ' + titles.length + '）')
      return index
    } catch (error) {
      this.log('warn', '建立词表失败: ' + game + ' — ' + (error instanceof Error ? error.message : String(error)))
      return undefined
    }
  }
}

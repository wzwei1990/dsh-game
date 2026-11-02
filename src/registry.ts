/**
 * 游戏注册表：谁在被聊，谁就排前面；新游戏只在第一次被提到时探测一次。
 * 落盘 ~/.dsh/dsh-game/games.json（跨会话复用，重启不丢）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

export interface GameSite {
  /** 站点类型；v0.1 只有 biligame（BWIKI） */
  kind: 'biligame'
  /** 子站 slug，如 yingzhiren */
  slug: string
}

export interface GameEntry {
  /** 标准名（展示用） */
  name: string
  /** 别名（群里怎么叫都认） */
  aliases: string[]
  site: GameSite
  /** 被提到的次数（用于排序/预取预算） */
  hits: number
  firstSeen: number
  lastHit: number
  /** unresolved = 探测过但没找到；active = 可用 */
  status: 'active' | 'unresolved'
}

export interface RegistryOptions {
  file?: string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

/** 归一化：去空白/标点、全角转半角、小写 */
export function normalizeName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[《》「」『』【】()（）\[\]{}<>·・、,，.。:：;；!！?？"'“”‘’\s_-]/g, '')
}

/** 内置种子：已实测跑通的游戏（新游戏由 discover 注册，这里只放确定能用的） */
export const SEED_GAMES: GameEntry[] = [
  {
    name: '影之刃零',
    aliases: ['影之刃零', '影之刃', '影零', 'phantom blade zero', 'pbz'],
    site: { kind: 'biligame', slug: 'yingzhiren' },
    hits: 0,
    firstSeen: 0,
    lastHit: 0,
    status: 'active',
  },
]

export class GameRegistry {
  private readonly file: string
  private readonly log: (level: 'debug' | 'info' | 'warn', message: string) => void
  private games: GameEntry[]

  constructor(options: RegistryOptions = {}) {
    this.file = options.file ?? join(homedir(), '.dsh', 'dsh-game', 'games.json')
    this.log = options.log ?? (() => undefined)
    this.games = this.load()
  }

  private load(): GameEntry[] {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { games?: GameEntry[] }
      const games = (raw.games ?? []).filter(entry => typeof entry?.name === 'string' && entry.site?.slug !== undefined)
      if (games.length > 0) return mergeSeeds(games)
    } catch (error) {
      this.log('debug', '读取注册表失败（用内置种子）: ' + (error instanceof Error ? error.message : String(error)))
    }
    return mergeSeeds([])
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      writeFileSync(this.file, JSON.stringify({ version: 1, games: this.games }, null, 2), 'utf8')
    } catch (error) {
      this.log('warn', '写注册表失败: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  size(): number {
    return this.games.length
  }

  /** 按最近命中排序（活跃游戏在前） */
  list(): GameEntry[] {
    return [...this.games].sort((a, b) => {
      if (a.status !== b.status) return a.status === 'active' ? -1 : 1
      return b.lastHit - a.lastHit || b.hits - a.hits
    })
  }

  /** 找游戏（支持别名/模糊），命中即 hits++ */
  resolve(name: string): GameEntry | undefined {
    const needle = normalizeName(name)
    if (needle === '') return undefined
    const exact = this.games.find(entry => normalizeName(entry.name) === needle)
      ?? this.games.find(entry => entry.aliases.some(alias => normalizeName(alias) === needle))
    const hit = exact ?? this.games.find(entry => {
      const hay = [entry.name, ...entry.aliases].map(normalizeName)
      return hay.some(value => value.includes(needle) || (needle.length >= 3 && needle.includes(value)))
    })
    if (hit === undefined) return undefined
    hit.hits += 1
    hit.lastHit = Date.now()
    this.save()
    return hit
  }

  /** 取站点（找不到就抛错，让工具层给模型一句人话） */
  site(name: string): GameSite {
    const entry = this.resolve(name)
    if (entry === undefined) throw new Error('游戏表里没有「' + name + '」；先用 game_resolve 探测，或确认名字')
    return entry.site
  }

  /** 注册/更新（discover 成功后调用） */
  upsert(input: { name: string; aliases?: string[]; site: GameSite; status?: 'active' | 'unresolved' }): GameEntry {
    const needle = normalizeName(input.name)
    const existing = this.games.find(entry => normalizeName(entry.name) === needle)
    if (existing !== undefined) {
      existing.site = input.site
      existing.aliases = dedupe([...(input.aliases ?? []), ...existing.aliases, input.name])
      existing.status = input.status ?? 'active'
      existing.lastHit = Date.now()
      this.save()
      return existing
    }
    const entry: GameEntry = {
      name: input.name,
      aliases: dedupe([input.name, ...(input.aliases ?? [])]),
      site: input.site,
      hits: 1,
      firstSeen: Date.now(),
      lastHit: Date.now(),
      status: input.status ?? 'active',
    }
    this.games.push(entry)
    this.save()
    return entry
  }
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const value of values) {
    const trimmed = value.trim()
    const key = normalizeName(trimmed)
    if (key === '' || seen.has(key)) continue
    seen.add(key)
    out.push(trimmed)
  }
  return out
}

/** 种子合并：磁盘上已有的保留命中统计，缺失的补进来 */
export function mergeSeeds(games: GameEntry[]): GameEntry[] {
  const out = [...games]
  for (const seed of SEED_GAMES) {
    const key = normalizeName(seed.name)
    if (out.some(entry => normalizeName(entry.name) === key)) continue
    out.push({ ...seed, aliases: [...seed.aliases] })
  }
  return out
}

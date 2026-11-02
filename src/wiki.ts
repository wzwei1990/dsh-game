/**
 * BWIKI（MediaWiki Action API）客户端：搜索 + 取正文。
 *
 * 只做"能拿到正文"的读操作；每条结果都带来源 URL，方便模型引用、也方便我们排障。
 * 正文清洗是重点：wiki 页面里混着导航、编辑提示、表格，直接丢给模型会浪费上下文。
 */
import { PoliteFetcher, describeError, type HttpError } from './throttle.js'
import type { GameSite } from './registry.js'

export interface WikiOptions {
  minIntervalMs: number
  cacheTtlMs: number
  timeoutMs: number
  maxRetries: number
  userAgent: string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export interface SearchHit {
  title: string
  snippet: string
  url: string
}

export interface PageResult {
  title: string
  url: string
  text: string
  chars: number
  truncated: boolean
}

export interface SectionInfo {
  index: number
  level: number
  title: string
}

export interface WikiClientLike {
  search(site: GameSite, keyword: string, limit?: number): Promise<SearchHit[]>
  read(site: GameSite, title: string, options?: { maxChars?: number; section?: number }): Promise<PageResult>
  sections(site: GameSite, title: string): Promise<SectionInfo[]>
}

interface BwikiResponse<T> {
  query?: T
  parse?: { title?: string; text?: string }
  error?: { code?: string; info?: string }
}

interface SearchQuery {
  search?: Array<{ title?: string; snippet?: string }>
  searchinfo?: { totalhits?: number }
}

interface SiteInfoQuery {
  general?: { sitename?: string; server?: string; articlepath?: string }
}

/** 站点基础信息（用于校验 slug 是否真的有 wiki） */
export async function probeSite(fetcher: PoliteFetcher, slug: string): Promise<{ ok: boolean; name?: string }> {
  const url = 'https://wiki.biligame.com/' + encodeURIComponent(slug) + '/api.php?action=query&meta=siteinfo&siprop=general&format=json&formatversion=2'
  const json = await fetcher.json<BwikiResponse<SiteInfoQuery>>(url, { referer: 'https://wiki.biligame.com/' + encodeURIComponent(slug) + '/' })
  const name = json.query?.general?.sitename
  return name === undefined ? { ok: false } : { ok: true, name }
}

/** MediaWiki HTML → 纯文本（保留标题层级，表格转行，去掉导航/目录/脚本） */
export function htmlToText(html: string): string {
  let text = html
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '')
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '')
  // 目录区块（TOC）整块丢掉：模型不需要"目录"列表
  text = text.replace(/<div[^>]*(?:id|class)="[^"]*toc[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '')
  // 表格：每个 <tr> 变成一行，单元格用 " / " 分隔（比纯文本粘连好读）
  text = text.replace(/<table[\s\S]*?<\/table>/gi, table => rowsToLines(table))
  // 标题转成 "## "
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, inner: string) => {
    const clean = stripTags(inner)
    return '\n\n' + '#'.repeat(Math.min(6, Number(level) + 1)) + ' ' + clean + '\n'
  })
  // 换行/段落
  text = text.replace(/<br\s*\/?>/gi, '\n')
  text = text.replace(/<\/(p|div|li|tr|table|section)>/gi, '\n')
  text = text.replace(/<li[^>]*>/gi, '- ')
  text = stripTags(text)
  text = decodeEntities(text)
  // 去掉 wiki 的固定噪声行
  const noise = [
    /^阅\s*编\s*刷\s*历.*$/u,
    /^如果是第一次来.*$/u,
    /^按右上角.*$/u,
    /^欢迎来到.*WIKI.*$/u,
    /^本WIKI.*$/u,
    /^WIKI功能.*$/u,
    /^编辑\s*$/u,
    /^\s*$/u,
  ]
  const lines = text
    .split('\n')
    .map(line => line.replace(/\s+/g, ' ').trim())
    .filter(line => !noise.some(pattern => pattern.test(line)))
  // 连续空行压成一个
  const out: string[] = []
  for (const line of lines) {
    if (line === '' && out[out.length - 1] === '') continue
    out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * 把一张 wiki 表格转成紧凑文本。
 * - 两列「等级 / 数值」表：压成一行区间（1→50：12000→330120）
 * - 常规表：保留表头 + 前若干行，超长就省略中间（wiki 的等级表常有 50 行，全给会淹没答案）
 */
export function rowsToLines(table: string): string {
  const rows = Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
    .map(row => Array.from((row[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
      .map(cell => decodeEntities(stripTags(cell[1] ?? '')).replace(/\s+/g, ' ').trim())
      .filter(cell => cell !== ''))
    .filter(cells => cells.length > 0)
  if (rows.length === 0) return ''

  // 两列等级表：等级递增 + 数值 → 一行区间（允许前面有"等级 / 生命"这类表头行）
  const pairs = rows.filter(cells => cells.length === 2 && /^\d+$/.test(cells[0] ?? ''))
  if (pairs.length >= 6 && pairs.length >= rows.length - 2) {
    const first = pairs[0]!
    const last = pairs[pairs.length - 1]!
    return '\n' + '等级 ' + first[0] + '→' + last[0] + '：' + first[1] + '→' + last[1]
      + '（共 ' + String(pairs.length) + ' 档）' + '\n'
  }

  const LIMIT = 16
  const head = rows.length > LIMIT ? rows.slice(0, 10) : rows
  const tail = rows.length > LIMIT ? rows.slice(-3) : []
  const lines = head.map(cells => cells.join(' / '))
  if (tail.length > 0) {
    lines.push('…（表共 ' + String(rows.length) + ' 行，中间省略）')
    for (const cells of tail) lines.push(cells.join(' / '))
  }
  return '\n' + lines.join('\n') + '\n'
}

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ')
}

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&middot;': '·',
}

export function decodeEntities(value: string): string {
  let out = value
  for (const [entity, char] of Object.entries(ENTITIES)) {
    out = out.split(entity).join(char)
  }
  out = out.replace(/&#(\d+);/g, (_m, code: string) => {
    const n = Number(code)
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
  })
  out = out.replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => {
    const n = Number.parseInt(hex, 16)
    return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' '
  })
  return out
}

export class WikiClient implements WikiClientLike {
  private readonly fetcher: PoliteFetcher
  private readonly cacheTtlMs: number
  private readonly log: (level: 'debug' | 'info' | 'warn', message: string) => void
  private readonly memory = new Map<string, { at: number; value: unknown }>()

  constructor(options: WikiOptions) {
    this.fetcher = new PoliteFetcher({
      minIntervalMs: options.minIntervalMs,
      maxRetries: options.maxRetries,
      timeoutMs: options.timeoutMs,
      userAgent: options.userAgent,
      log: options.log,
    })
    this.cacheTtlMs = options.cacheTtlMs
    this.log = options.log ?? (() => undefined)
  }

  private apiBase(site: GameSite): string {
    return 'https://wiki.biligame.com/' + encodeURIComponent(site.slug) + '/api.php'
  }

  private pageUrl(site: GameSite, title: string): string {
    return 'https://wiki.biligame.com/' + encodeURIComponent(site.slug) + '/' + encodeURIComponent(title.replace(/\s/g, '_'))
  }

  private cacheGet<T>(key: string): T | undefined {
    if (this.cacheTtlMs <= 0) return undefined
    const hit = this.memory.get(key)
    if (hit === undefined || Date.now() - hit.at >= this.cacheTtlMs) return undefined
    return hit.value as T
  }

  private cacheSet(key: string, value: unknown): void {
    if (this.cacheTtlMs <= 0) return
    this.memory.set(key, { at: Date.now(), value })
  }

  async search(site: GameSite, keyword: string, limit = 6): Promise<SearchHit[]> {
    const trimmed = keyword.trim()
    if (trimmed === '') return []
    const key = 'search:' + site.slug + ':' + trimmed + ':' + limit
    const cached = this.cacheGet<SearchHit[]>(key)
    if (cached !== undefined) return cached
    const url = this.apiBase(site)
      + '?action=query&list=search&srlimit=' + String(Math.max(1, Math.min(20, limit)))
      + '&srsearch=' + encodeURIComponent(trimmed)
      + '&format=json&formatversion=2'
    const json = await this.fetcher.json<BwikiResponse<SearchQuery>>(url, { referer: this.pageUrl(site, '首页') })
    const hits = (json.query?.search ?? [])
      .filter(item => typeof item.title === 'string' && item.title !== '')
      .map(item => ({
        title: item.title as string,
        snippet: htmlToText(item.snippet ?? '').slice(0, 160),
        url: this.pageUrl(site, item.title as string),
      }))
    this.cacheSet(key, hits)
    this.log('debug', 'wiki 搜索 ' + site.slug + ' "' + trimmed + '" → ' + hits.length + ' 条')
    return hits
  }

  /** 列出一个页面的章节（用于先看大纲，再只读需要的章节，省上下文） */
  async sections(site: GameSite, title: string): Promise<SectionInfo[]> {
    const clean = title.trim()
    if (clean === '') throw new Error('页面标题不能为空')
    const key = 'sections:' + site.slug + ':' + clean
    const cached = this.cacheGet<SectionInfo[]>(key)
    if (cached !== undefined) return cached
    const url = this.apiBase(site)
      + '?action=parse&page=' + encodeURIComponent(clean)
      + '&prop=sections&redirects=1&format=json&formatversion=2'
    const json = await this.fetcher.json<{ parse?: { sections?: Array<{ index?: string; level?: string; line?: string }> } }>(url, { referer: this.pageUrl(site, clean) })
    const sections = (json.parse?.sections ?? [])
      .filter(item => item.index !== undefined && item.line !== undefined)
      .map(item => ({ index: Number(item.index), level: Number(item.level ?? 1), title: htmlToText(item.line ?? '') }))
    this.cacheSet(key, sections)
    return sections
  }

  async read(site: GameSite, title: string, options: { maxChars?: number; section?: number } = {}): Promise<PageResult> {
    const clean = title.trim()
    const maxChars = options.maxChars
    const section = options.section
    if (clean === '') throw new Error('页面标题不能为空')
    const key = 'page:' + site.slug + ':' + clean + (section === undefined ? '' : '#' + String(section))
    const cached = this.cacheGet<PageResult>(key)
    if (cached !== undefined) return trimPage(cached, maxChars)
    const url = this.apiBase(site)
      + '?action=parse&page=' + encodeURIComponent(clean)
      + '&prop=text&redirects=1&format=json&formatversion=2&disablelimitreport=1&disableeditsection=1'
      + (section === undefined ? '' : '&section=' + String(section))
    const json = await this.fetcher.json<BwikiResponse<unknown>>(url, { referer: this.pageUrl(site, clean) })
    if (json.error !== undefined) {
      throw new Error('wiki 没有这个页面（' + String(json.error.info ?? json.error.code ?? 'unknown') + '）')
    }
    const html = json.parse?.text ?? ''
    if (html === '') throw new Error('wiki 返回空页面：' + clean)
    let text = htmlToText(html)
    // 有些条目是重定向页（正文只有"重定向到： / - 头目"），跟一层
    const redirect = /^重定向到：\s*\/?\s*-\s*(.+)$/m.exec(text)
    if (redirect !== null && (redirect[1] ?? '').trim() !== '') {
      const target = (redirect[1] ?? '').trim()
      this.log('debug', '跟随重定向 ' + clean + ' → ' + target)
      return this.read(site, target, options)
    }
    const result: PageResult = {
      title: json.parse?.title ?? clean,
      url: this.pageUrl(site, clean),
      text,
      chars: text.length,
      truncated: false,
    }
    this.cacheSet(key, result)
    this.log('debug', 'wiki 页面 ' + site.slug + '/' + clean + ' → ' + result.chars + ' 字')
    return trimPage(result, maxChars)
  }
}

export function trimPage(page: PageResult, maxChars: number | undefined): PageResult {
  if (maxChars === undefined || maxChars <= 0 || page.text.length <= maxChars) return page
  return {
    ...page,
    text: page.text.slice(0, maxChars) + '\n…（内容过长，已截断；完整页面见来源链接）',
    truncated: true,
  }
}

/** 工具层用：把错误说成人话（限流/没有页面/网络） */
export function humanError(error: unknown): string {
  if (error instanceof Error && /567|403|429|503/.test(error.message)) {
    return 'wiki 现在限流中（' + describeError(error) + '），过一会儿再问'
  }
  return describeError(error)
}

export type { HttpError }

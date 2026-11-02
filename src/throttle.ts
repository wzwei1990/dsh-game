/**
 * 礼貌抓取：单主机串行 + 最小间隔 + 失败退避。
 *
 * BWIKI 实测：连续几次请求直接 567（非标准状态=被限），冷却 ~25s 后恢复。
 * 所以这里不允许并发，也不允许"重试立刻再来"。
 */

export interface ThrottleOptions {
  minIntervalMs: number
  maxRetries: number
  timeoutMs: number
  userAgent: string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly url?: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

/** 这些状态码视为"被限流/拦了"，要退避而不是重试立刻打 */
const THROTTLE_STATUS = new Set([403, 429, 503, 567])

/** 退避序列（毫秒）：第 n 次重试等多久 */
export function backoffMs(attempt: number, minIntervalMs: number): number {
  const base = Math.max(minIntervalMs, 2000)
  return base * Math.pow(2, Math.max(0, attempt)) * 2
}

export class PoliteFetcher {
  private readonly options: ThrottleOptions
  /** 每主机最后一次请求完成时间 */
  private readonly lastAt = new Map<string, number>()
  /** 每主机的串行链 */
  private readonly chains = new Map<string, Promise<unknown>>()

  constructor(options: ThrottleOptions) {
    this.options = options
  }

  /** 串行执行：同一主机上排队，前一个完成后至少隔 minIntervalMs 再发下一个 */
  async json<T>(url: string, init?: { referer?: string }): Promise<T> {
    const host = hostOf(url)
    const previous = this.chains.get(host) ?? Promise.resolve()
    const task = previous
      .catch(() => undefined)
      .then(() => this.runWithRetry<T>(url, init))
    // 链只用于排队，失败不影响后续
    this.chains.set(host, task.catch(() => undefined))
    return task
  }

  private async runWithRetry<T>(url: string, init?: { referer?: string }): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt += 1) {
      await this.waitTurn(hostOf(url), attempt)
      try {
        return await this.fetchJson<T>(url, init)
      } catch (error) {
        lastError = error
        const status = error instanceof HttpError ? error.status : undefined
        const throttled = status !== undefined && THROTTLE_STATUS.has(status)
        if (!throttled && status !== undefined && status < 500) throw error
        this.options.log?.('warn', '请求失败（' + describeError(error) + '），第 ' + (attempt + 1) + ' 次重试前退避')
      }
    }
    throw lastError instanceof Error ? lastError : new HttpError(describeError(lastError), undefined, url)
  }

  /** 等到"距上次请求 ≥ minIntervalMs"；重试时额外退避 */
  private async waitTurn(host: string, attempt: number): Promise<void> {
    const now = Date.now()
    const last = this.lastAt.get(host) ?? 0
    const gap = attempt === 0 ? this.options.minIntervalMs : backoffMs(attempt, this.options.minIntervalMs)
    const wait = Math.max(0, last + gap - now)
    if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
    this.lastAt.set(host, Date.now())
  }

  private async fetchJson<T>(url: string, init?: { referer?: string }): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': this.options.userAgent,
          Accept: 'application/json',
          ...(init?.referer === undefined ? {} : { Referer: init.referer }),
        },
      })
      if (!response.ok) throw new HttpError('HTTP ' + String(response.status), response.status, url)
      const text = await response.text()
      try {
        return JSON.parse(text) as T
      } catch {
        throw new HttpError('返回不是 JSON（可能被拦了）: ' + text.slice(0, 120), response.status, url)
      }
    } catch (error) {
      if (error instanceof HttpError) throw error
      const message = controller.signal.aborted
        ? '请求超时（' + String(this.options.timeoutMs) + 'ms）'
        : error instanceof Error ? error.message : String(error)
      throw new HttpError(message, undefined, url)
    } finally {
      clearTimeout(timer)
    }
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.toLowerCase()
  } catch {
    return url
  }
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}

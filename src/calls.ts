/**
 * 工具调用日志：每次 game_* 被调用记一行 JSONL，用来回答"这个插件到底被用了几次"。
 *
 * 位置：~/.dsh/dsh-game/logs/calls.jsonl
 * 轮转：超过 2MB 挪成 calls.jsonl.1（只保留一份旧档）
 * 写入是异步的、失败静默 —— 日志绝不能影响工具本身。
 */

import { appendFile, mkdir, rename, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const MAX_BYTES = 2 * 1024 * 1024

export interface CallRecord {
  /** 工具名，如 game_wiki_search */
  tool: string
  /** 调用参数（已裁剪） */
  args: Record<string, unknown>
  ok: boolean
  /** 耗时毫秒 */
  ms: number
  /** 返回文本长度（成功时） */
  chars?: number
  /** 失败原因（失败时） */
  error?: string
}

export interface CallLogOptions {
  /** 日志目录（缺省 ~/.dsh/dsh-game） */
  dir?: string
  log?: (level: 'debug' | 'info' | 'warn', message: string) => void
}

export class CallLog {
  private readonly dir: string
  private readonly log: CallLogOptions['log']
  private queue: Promise<void> = Promise.resolve()

  constructor(options: CallLogOptions = {}) {
    this.dir = options.dir ?? join(homedir(), '.dsh', 'dsh-game')
    this.log = options.log
  }

  get file(): string {
    return join(this.dir, 'logs', 'calls.jsonl')
  }

  /** 记一次调用（不等待落盘）。 */
  record(record: CallRecord): void {
    const line = JSON.stringify({
      t: new Date().toISOString(),
      ...record,
      args: trimArgs(record.args),
    }) + '\n'
    this.queue = this.queue.then(async () => {
      try {
        const dir = join(this.dir, 'logs')
        await mkdir(dir, { recursive: true })
        await this.rotateIfNeeded()
        await appendFile(this.file, line, 'utf8')
      } catch (error) {
        this.log?.('debug', '工具调用日志写入失败: ' + (error instanceof Error ? error.message : String(error)))
      }
    })
  }

  private async rotateIfNeeded(): Promise<void> {
    try {
      const info = await stat(this.file)
      if (info.size > MAX_BYTES) await rename(this.file, this.file + '.1')
    } catch {
      // 文件还不存在
    }
  }
}

/** 参数只留短字段，避免把整段 prompt 写进日志。 */
function trimArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (typeof value === 'string') out[key] = value.length > 120 ? value.slice(0, 120) + '…' : value
    else if (typeof value === 'number' || typeof value === 'boolean') out[key] = value
  }
  return out
}

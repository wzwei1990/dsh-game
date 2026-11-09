/**
 * 工具调用日志：每次 game_* 被调用记一行 JSONL，用来回答"这个插件到底被用了几次"。
 *
 * 位置：~/.dsh/dsh-game/logs/calls.jsonl
 * 轮转：超过 2MB 挪成 calls.jsonl.1（只保留一份旧档）
 * 写入是异步的、失败静默 —— 日志绝不能影响工具本身。
 */
export interface CallRecord {
    /** 工具名，如 game_wiki_search */
    tool: string;
    /** 调用参数（已裁剪） */
    args: Record<string, unknown>;
    ok: boolean;
    /** 耗时毫秒 */
    ms: number;
    /** 返回文本长度（成功时） */
    chars?: number;
    /** 失败原因（失败时） */
    error?: string;
}
export interface CallLogOptions {
    /** 日志目录（缺省 ~/.dsh/dsh-game） */
    dir?: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export declare class CallLog {
    private readonly dir;
    private readonly log;
    private queue;
    constructor(options?: CallLogOptions);
    get file(): string;
    /** 记一次调用（不等待落盘）。 */
    record(record: CallRecord): void;
    private rotateIfNeeded;
}

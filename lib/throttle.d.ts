/**
 * 礼貌抓取：单主机串行 + 最小间隔 + 失败退避。
 *
 * BWIKI 实测：连续几次请求直接 567（非标准状态=被限），冷却 ~25s 后恢复。
 * 所以这里不允许并发，也不允许"重试立刻再来"。
 */
export interface ThrottleOptions {
    minIntervalMs: number;
    maxRetries: number;
    timeoutMs: number;
    userAgent: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export declare class HttpError extends Error {
    readonly status?: number | undefined;
    readonly url?: string | undefined;
    constructor(message: string, status?: number | undefined, url?: string | undefined);
}
/** 退避序列（毫秒）：第 n 次重试等多久 */
export declare function backoffMs(attempt: number, minIntervalMs: number): number;
export declare class PoliteFetcher {
    private readonly options;
    /** 每主机最后一次请求完成时间 */
    private readonly lastAt;
    /** 每主机的串行链 */
    private readonly chains;
    constructor(options: ThrottleOptions);
    /** 串行执行：同一主机上排队，前一个完成后至少隔 minIntervalMs 再发下一个 */
    json<T>(url: string, init?: {
        referer?: string;
    }): Promise<T>;
    private runWithRetry;
    /** 等到"距上次请求 ≥ minIntervalMs"；重试时额外退避 */
    private waitTurn;
    private fetchJson;
}
export declare function hostOf(url: string): string;
export declare function describeError(error: unknown): string;

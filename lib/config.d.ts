import z from '@deepseek-ai/schemastery';
export interface ConfigShape {
    /** 游戏注册表文件（留空 = ~/.dsh/dsh-game/games.json） */
    registryFile: string;
    /** 同一主机两次请求的最小间隔（毫秒）；BWIKI 实测极易 567，别调太小 */
    minIntervalMs: number;
    /** 页面/搜索缓存有效期（分钟，0 = 不缓存） */
    cacheTtlMinutes: number;
    /** 单次请求超时（毫秒） */
    timeoutMs: number;
    /** 失败重试次数（567/403/429/网络错误） */
    maxRetries: number;
    /** 工具单次返回的最大字符数（超出截断并标注） */
    maxReplyChars: number;
    /** User-Agent（BWIKI 对默认 UA 更苛刻，建议保留浏览器 UA） */
    userAgent: string;
    logLevel: 'debug' | 'info' | 'warn';
}
export declare const Config: z<Schemastery.ObjectS<NoInfer<{
    registryFile: z<string, string, "volatile-defined">;
    minIntervalMs: z<number, number, "volatile-defined">;
    cacheTtlMinutes: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    maxRetries: z<number, number, "volatile-defined">;
    maxReplyChars: z<number, number, "volatile-defined">;
    userAgent: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
    registryFile: z<string, string, "volatile-defined">;
    minIntervalMs: z<number, number, "volatile-defined">;
    cacheTtlMinutes: z<number, number, "volatile-defined">;
    timeoutMs: z<number, number, "volatile-defined">;
    maxRetries: z<number, number, "volatile-defined">;
    maxReplyChars: z<number, number, "volatile-defined">;
    userAgent: z<string, string, "volatile-defined">;
    logLevel: z<"debug" | "info" | "warn", "debug" | "info" | "warn", "volatile-defined">;
}>>, "plain">;
export declare const DEFAULTS: ConfigShape;
export declare function resolveConfig(input: Partial<ConfigShape> | undefined): ConfigShape;

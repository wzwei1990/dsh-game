import z from '@deepseek-ai/schemastery';
// 不加 Z<ConfigShape> 注解：.volatile() 会把字段推断成 Volatile<T>
export const Config = z.object({
    registryFile: z.string().default('')
        .description('游戏注册表路径（留空=~/.dsh/dsh-game/games.json）').volatile(),
    minIntervalMs: z.natural().default(6000)
        .description('同一主机两次请求的最小间隔（毫秒）；BWIKI 限流很凶，不建议低于 3000').volatile(),
    cacheTtlMinutes: z.natural().default(1440)
        .description('页面/搜索缓存有效期（分钟，0=不缓存）').volatile(),
    timeoutMs: z.natural().default(20000)
        .description('单次请求超时（毫秒）').volatile(),
    maxRetries: z.natural().default(2)
        .description('失败重试次数（限流/网络错误）').volatile(),
    reverifyDays: z.natural().default(1).description('超过多少天未校验就提示复验（wiki 可能改地址）').volatile(),
    maxReplyChars: z.natural().default(6000)
        .description('工具单次返回的最大字符数（超出截断）').volatile(),
    userAgent: z.string()
        .default('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36')
        .description('请求 User-Agent（BWIKI 对默认 UA 更苛刻）').volatile(),
    logLevel: z.union([z.const('debug'), z.const('info'), z.const('warn')]).default('info')
        .description('日志级别').volatile(),
});
export const DEFAULTS = {
    registryFile: '',
    minIntervalMs: 6000,
    cacheTtlMinutes: 1440,
    timeoutMs: 20000,
    maxRetries: 2,
    reverifyDays: 1,
    maxReplyChars: 6000,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    logLevel: 'info',
};
export function resolveConfig(input) {
    const merged = { ...DEFAULTS };
    const source = input ?? {};
    for (const key of Object.keys(DEFAULTS)) {
        const value = source[key];
        if (value === undefined || value === null)
            continue;
        if (key === 'logLevel') {
            if (value === 'debug' || value === 'info' || value === 'warn')
                merged.logLevel = value;
            continue;
        }
        if (key === 'registryFile' || key === 'userAgent') {
            merged[key] = String(value);
            continue;
        }
        const numeric = Number(value);
        if (Number.isFinite(numeric))
            merged[key] = Math.max(0, Math.floor(numeric));
    }
    return merged;
}

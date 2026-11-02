import { Config, resolveConfig } from './config.js';
import { GameRegistry } from './registry.js';
import { registerTools } from './tools.js';
import { WikiClient } from './wiki.js';
export { Config };
export const name = 'dsh-game';
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export const inject = ['tools'];
const LEVEL_RANK = { debug: 0, info: 1, warn: 2 };
export function apply(ctx, rawConfig) {
    const config = resolveConfig(rawConfig);
    const threshold = LEVEL_RANK[config.logLevel] ?? 1;
    const log = (level, message) => {
        if ((LEVEL_RANK[level] ?? 1) < threshold)
            return;
        const line = '[dsh-game] ' + message;
        if (level === 'warn')
            console.warn(line);
        else
            console.log(line);
    };
    const registry = new GameRegistry({
        file: config.registryFile === '' ? undefined : config.registryFile,
        log,
    });
    const wiki = new WikiClient({
        minIntervalMs: config.minIntervalMs,
        cacheTtlMs: Math.max(0, config.cacheTtlMinutes) * 60_000,
        timeoutMs: config.timeoutMs,
        userAgent: config.userAgent,
        maxRetries: config.maxRetries,
        log,
    });
    registerTools(ctx, { registry, wiki, maxChars: config.maxReplyChars, minIntervalMs: config.minIntervalMs, reverifyDays: config.reverifyDays, log });
    // 给通道留可选服务入口：ctx.get('dshGame') 存在时，napcat 之类可以直接调
    try {
        const host = ctx;
        host.provide?.('dshGame', {
            list: () => registry.list(),
            resolve: (name) => registry.resolve(name),
            search: (game, keyword) => wiki.search(registry.site(game), keyword),
            read: (game, title) => wiki.read(registry.site(game), title),
        });
    }
    catch {
        log('debug', '宿主不支持 provide(dshGame)，跳过服务注册（工具仍可用）');
    }
    log('info', 'dsh-game 已加载（源：BWIKI；游戏表 ' + registry.size() + ' 个）');
}

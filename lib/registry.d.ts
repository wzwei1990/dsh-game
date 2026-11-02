export interface GameSite {
    /** 站点类型；v0.1 只有 biligame（BWIKI） */
    kind: 'biligame';
    /** 子站 slug，如 yingzhiren */
    slug: string;
}
export interface GameEntry {
    /** 标准名（展示用） */
    name: string;
    /** 别名（群里怎么叫都认） */
    aliases: string[];
    site: GameSite;
    /** 被提到的次数（用于排序/预取预算） */
    hits: number;
    firstSeen: number;
    lastHit: number;
    /**
     * active = 可用；unresolved = 探测过但没找到；
     * stale = 以前能用但现在访问失败（wiki 改地址/改版），需要重新登记
     */
    status: 'active' | 'unresolved' | 'stale';
    /** 上次校验成功的时间（ms）；用于定期复验 */
    verifiedAt?: number;
    /** 来源：seed=内置；manual=手填 slug；url=给的是子站地址 */
    source?: 'seed' | 'manual' | 'url';
}
export interface RegistryOptions {
    file?: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 归一化：去空白/标点、全角转半角、小写 */
export declare function normalizeName(value: string): string;
/** 内置种子：已实测跑通的游戏（新游戏由 discover 注册，这里只放确定能用的） */
export declare const SEED_GAMES: GameEntry[];
/** 从 URL 里取 BWIKI 子站 slug：https://wiki.biligame.com/yingzhiren/xxx → yingzhiren */
export declare function parseBwikiUrl(input: string): string | undefined;
/** 条目是否需要复验（verifiedAt 超过 ttlDays 天，或从未校验） */
export declare function needsVerify(entry: GameEntry, ttlDays: number, now?: number): boolean;
export declare class GameRegistry {
    private readonly file;
    private readonly log;
    private games;
    /** 实际使用的注册表路径（排障用） */
    readonly path: string;
    /** 最近一次保存失败的原因（成功则为空） */
    lastSaveError: string;
    constructor(options?: RegistryOptions);
    private load;
    private save;
    size(): number;
    /** 按最近命中排序（活跃游戏在前） */
    list(): GameEntry[];
    /** 找游戏（支持别名/模糊），命中即 hits++ */
    resolve(name: string): GameEntry | undefined;
    /** 取站点（找不到就抛错，让工具层给模型一句人话） */
    site(name: string): GameSite;
    /** 注册/更新（探测成功后调用）；source 记录"这个地址是怎么来的" */
    upsert(input: {
        name: string;
        aliases?: string[];
        site: GameSite;
        status?: 'active' | 'unresolved' | 'stale';
        source?: 'seed' | 'manual' | 'url';
    }): GameEntry;
    /** 复验成功：标记 active + 刷新时间（地址可能被更新过） */
    markVerified(name: string, site?: GameSite): GameEntry | undefined;
    /** 访问失败：标记 stale，提示重新登记（不删除，保留 hits 历史） */
    markStale(name: string): void;
    /** 只查找、不计 hits（内部用） */
    private find;
}
/** 种子合并：磁盘上已有的保留命中统计，缺失的补进来 */
export declare function mergeSeeds(games: GameEntry[]): GameEntry[];

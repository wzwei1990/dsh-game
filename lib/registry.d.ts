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
    /** unresolved = 探测过但没找到；active = 可用 */
    status: 'active' | 'unresolved';
}
export interface RegistryOptions {
    file?: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 归一化：去空白/标点、全角转半角、小写 */
export declare function normalizeName(value: string): string;
/** 内置种子：已实测跑通的游戏（新游戏由 discover 注册，这里只放确定能用的） */
export declare const SEED_GAMES: GameEntry[];
export declare class GameRegistry {
    private readonly file;
    private readonly log;
    private games;
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
    /** 注册/更新（discover 成功后调用） */
    upsert(input: {
        name: string;
        aliases?: string[];
        site: GameSite;
        status?: 'active' | 'unresolved';
    }): GameEntry;
}
/** 种子合并：磁盘上已有的保留命中统计，缺失的补进来 */
export declare function mergeSeeds(games: GameEntry[]): GameEntry[];

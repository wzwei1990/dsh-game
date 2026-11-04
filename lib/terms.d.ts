import type { GameSite } from './registry.js';
import type { WikiClientLike } from './wiki.js';
export interface TermIndex {
    /** 标准名（游戏名） */
    game: string;
    slug: string;
    /** 词 → 页面标题（页面标题可能比词更长，如 庞镇 → 庞镇后街小院钥匙） */
    terms: Map<string, string>;
    builtAt: number;
}
export interface TermHit {
    game: string;
    terms: string[];
    pages: string[];
}
/** 标题 → 可用作词表的名词（2~8 字，去掉括号补充说明） */
export declare function toTerm(title: string): string | undefined;
export declare function buildTermMap(titles: readonly string[]): Map<string, string>;
/** 最长匹配：返回命中的词（按长度降序，最多 limit 个） */
export declare function matchTerms(text: string, terms: Map<string, string>, limit?: number): string[];
export interface TermStoreOptions {
    file?: string;
    /** 词表有效期（天） */
    ttlDays: number;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 词表缓存：~/.dsh/dsh-game/terms/<game>.json */
export declare class TermStore {
    private readonly ttlMs;
    private readonly log;
    private readonly root;
    private readonly memory;
    /** 正在建的词表（并发去重） */
    private readonly inflight;
    constructor(options: TermStoreOptions);
    private fileOf;
    /** 读缓存（含内存缓存）；过期返回 undefined */
    get(game: string, slug: string, now?: number): TermIndex | undefined;
    /** 落盘（调用方负责先拉 titles） */
    save(game: string, slug: string, titles: readonly string[]): TermIndex;
    /** 后台预热：没缓存就建；同一个游戏并发调用只建一次（不阻塞调用方） */
    warm(game: string, site: GameSite, wiki: WikiClientLike, maxPages?: number): Promise<TermIndex | undefined>;
    /** 拉词表（缓存过期/不存在时拉一次 allpages） */
    ensure(game: string, site: GameSite, wiki: WikiClientLike, maxPages?: number): Promise<TermIndex | undefined>;
}

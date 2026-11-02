/**
 * BWIKI（MediaWiki Action API）客户端：搜索 + 取正文。
 *
 * 只做"能拿到正文"的读操作；每条结果都带来源 URL，方便模型引用、也方便我们排障。
 * 正文清洗是重点：wiki 页面里混着导航、编辑提示、表格，直接丢给模型会浪费上下文。
 */
import { PoliteFetcher, type HttpError } from './throttle.js';
import type { GameSite } from './registry.js';
export interface WikiOptions {
    minIntervalMs: number;
    cacheTtlMs: number;
    timeoutMs: number;
    maxRetries: number;
    userAgent: string;
    log?: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
export interface SearchHit {
    title: string;
    snippet: string;
    url: string;
}
export interface PageResult {
    title: string;
    url: string;
    text: string;
    chars: number;
    truncated: boolean;
}
export interface WikiClientLike {
    search(site: GameSite, keyword: string, limit?: number): Promise<SearchHit[]>;
    read(site: GameSite, title: string, maxChars?: number): Promise<PageResult>;
}
/** 站点基础信息（用于校验 slug 是否真的有 wiki） */
export declare function probeSite(fetcher: PoliteFetcher, slug: string): Promise<{
    ok: boolean;
    name?: string;
}>;
/** MediaWiki HTML → 纯文本（保留标题层级，去掉导航/脚本/表格残渣） */
export declare function htmlToText(html: string): string;
export declare function decodeEntities(value: string): string;
export declare class WikiClient implements WikiClientLike {
    private readonly fetcher;
    private readonly cacheTtlMs;
    private readonly log;
    private readonly memory;
    constructor(options: WikiOptions);
    private apiBase;
    private pageUrl;
    private cacheGet;
    private cacheSet;
    search(site: GameSite, keyword: string, limit?: number): Promise<SearchHit[]>;
    read(site: GameSite, title: string, maxChars?: number): Promise<PageResult>;
}
export declare function trimPage(page: PageResult, maxChars: number | undefined): PageResult;
/** 工具层用：把错误说成人话（限流/没有页面/网络） */
export declare function humanError(error: unknown): string;
export type { HttpError };

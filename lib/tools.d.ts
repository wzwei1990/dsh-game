/**
 * 模型侧工具：先认游戏 → 再搜条目 → 再读正文。
 *
 * 设计原则：工具只返回"查到的原文片段 + 来源链接"，观点/语气交给模型；
 * 查不到就明确说查不到，禁止编数值（prompt 里也会写）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { type GameRegistry, type GameSite } from './registry.js';
import type { SearchHit, WikiClientLike } from './wiki.js';
export interface ToolDeps {
    registry: GameRegistry;
    wiki: WikiClientLike;
    maxChars: number;
    /** 探测/复验时的最小请求间隔 */
    minIntervalMs: number;
    /** 超过多少天未校验就提示复验（0=不提示） */
    reverifyDays: number;
    log: (level: 'debug' | 'info' | 'warn', message: string) => void;
}
/** 搜索结果的紧凑文本 */
export declare function searchText(game: string, keyword: string, hits: SearchHit[], site: GameSite): string;
/** 正文结果的文本（带来源，方便模型引用） */
export declare function pageText(result: {
    title: string;
    url: string;
    text: string;
    truncated: boolean;
}, game: string): string;
export declare function registerTools(ctx: Context, deps: ToolDeps): void;

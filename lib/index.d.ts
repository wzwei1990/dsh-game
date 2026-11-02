/**
 * dsh-game —— 让 DeepSeek Harness "真的知道"游戏内容。
 *
 * v0.1（P0）只做**已实测跑通**的源：
 *   - BWIKI（wiki.biligame.com/<slug>/api.php，MediaWiki Action API）
 *
 * 实测事实（2026-11-02）：
 *   - /yingzhiren 影之刃 WIKI 可用：搜索、parse 正文都能取；
 *   - **限流很凶**：连续几次请求就返回 HTTP 567（未知状态=被限），
 *     冷却 ~25 秒后单个请求恢复 → 必须串行 + 最小间隔 + 退避 + 缓存。
 *
 * 不做的源（按"只做能抓到内容的"原则）：
 *   - 游民星空 / 游侠 / 3DM：无公开 API、反爬、攻略是分页图集，抓下来也难摘要；
 *   - 灰机wiki：api.php 实测 403（未通，暂不接）。
 */
import type { Context } from '@deepseek-ai/cordis';
import { Config, type ConfigShape } from './config.js';
export { Config };
export declare const name = "dsh-game";
/** 只依赖工具注册表：本插件不碰会话/渠道，通道按需消费服务。 */
export declare const inject: string[];
export declare function apply(ctx: Context, rawConfig: ConfigShape): void;

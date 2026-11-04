/**
 * BWIKI（MediaWiki Action API）客户端：搜索 + 取正文。
 *
 * 只做"能拿到正文"的读操作；每条结果都带来源 URL，方便模型引用、也方便我们排障。
 * 正文清洗是重点：wiki 页面里混着导航、编辑提示、表格，直接丢给模型会浪费上下文。
 */
import { PoliteFetcher, describeError } from './throttle.js';
/** 站点基础信息（用于校验 slug 是否真的有 wiki） */
export async function probeSite(fetcher, slug) {
    const url = 'https://wiki.biligame.com/' + encodeURIComponent(slug) + '/api.php?action=query&meta=siteinfo&siprop=general&format=json&formatversion=2';
    const json = await fetcher.json(url, { referer: 'https://wiki.biligame.com/' + encodeURIComponent(slug) + '/' });
    const name = json.query?.general?.sitename;
    return name === undefined ? { ok: false } : { ok: true, name };
}
/** MediaWiki HTML → 纯文本（保留标题层级，表格转行，去掉导航/目录/脚本） */
export function htmlToText(html) {
    let text = html;
    text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
    text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
    // 目录区块（TOC）整块丢掉：模型不需要"目录"列表
    text = text.replace(/<div[^>]*(?:id|class)="[^"]*toc[^"]*"[^>]*>[\s\S]*?<\/div>/gi, '');
    // 表格：每个 <tr> 变成一行，单元格用 " / " 分隔（比纯文本粘连好读）
    text = text.replace(/<table[\s\S]*?<\/table>/gi, table => rowsToLines(table));
    // 标题转成 "## "
    text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, inner) => {
        const clean = stripTags(inner);
        return '\n\n' + '#'.repeat(Math.min(6, Number(level) + 1)) + ' ' + clean + '\n';
    });
    // 换行/段落
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(p|div|li|tr|table|section)>/gi, '\n');
    text = text.replace(/<li[^>]*>/gi, '- ');
    text = stripTags(text);
    text = decodeEntities(text);
    // 去掉 wiki 的固定噪声行
    const noise = [
        /^阅\s*编\s*刷\s*历.*$/u,
        /^如果是第一次来.*$/u,
        /^按右上角.*$/u,
        /^欢迎来到.*WIKI.*$/u,
        /^本WIKI.*$/u,
        /^WIKI功能.*$/u,
        /^编辑\s*$/u,
        /^\s*$/u,
    ];
    const lines = text
        .split('\n')
        .map(line => line.replace(/\s+/g, ' ').trim())
        .filter(line => !noise.some(pattern => pattern.test(line)));
    // 连续空行压成一个
    const out = [];
    for (const line of lines) {
        if (line === '' && out[out.length - 1] === '')
            continue;
        out.push(line);
    }
    return out.join('\n').trim();
}
/**
 * 把一张 wiki 表格转成紧凑文本。
 * - 两列「等级 / 数值」表：压成一行区间（1→50：12000→330120）
 * - 常规表：保留表头 + 前若干行，超长就省略中间（wiki 的等级表常有 50 行，全给会淹没答案）
 */
export function rowsToLines(table) {
    const rows = Array.from(table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi))
        .map(row => Array.from((row[1] ?? '').matchAll(/<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi))
        .map(cell => decodeEntities(stripTags(cell[1] ?? '')).replace(/\s+/g, ' ').trim())
        .filter(cell => cell !== ''))
        .filter(cells => cells.length > 0);
    if (rows.length === 0)
        return '';
    // 两列等级表：等级递增 + 数值 → 一行区间（允许前面有"等级 / 生命"这类表头行）
    const pairs = rows.filter(cells => cells.length === 2 && /^\d+$/.test(cells[0] ?? ''));
    if (pairs.length >= 6 && pairs.length >= rows.length - 2) {
        const first = pairs[0];
        const last = pairs[pairs.length - 1];
        return '\n' + '等级 ' + first[0] + '→' + last[0] + '：' + first[1] + '→' + last[1]
            + '（共 ' + String(pairs.length) + ' 档）' + '\n';
    }
    const LIMIT = 16;
    const head = rows.length > LIMIT ? rows.slice(0, 10) : rows;
    const tail = rows.length > LIMIT ? rows.slice(-3) : [];
    const lines = head.map(cells => cells.join(' / '));
    if (tail.length > 0) {
        lines.push('…（表共 ' + String(rows.length) + ' 行，中间省略）');
        for (const cells of tail)
            lines.push(cells.join(' / '));
    }
    return '\n' + lines.join('\n') + '\n';
}
function stripTags(value) {
    return value.replace(/<[^>]+>/g, ' ');
}
const ENTITIES = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
    '&middot;': '·',
};
export function decodeEntities(value) {
    let out = value;
    for (const [entity, char] of Object.entries(ENTITIES)) {
        out = out.split(entity).join(char);
    }
    out = out.replace(/&#(\d+);/g, (_m, code) => {
        const n = Number(code);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    });
    out = out.replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
        const n = Number.parseInt(hex, 16);
        return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ' ';
    });
    return out;
}
export class WikiClient {
    fetcher;
    cacheTtlMs;
    log;
    memory = new Map();
    constructor(options) {
        this.fetcher = new PoliteFetcher({
            minIntervalMs: options.minIntervalMs,
            maxRetries: options.maxRetries,
            timeoutMs: options.timeoutMs,
            userAgent: options.userAgent,
            log: options.log,
        });
        this.cacheTtlMs = options.cacheTtlMs;
        this.log = options.log ?? (() => undefined);
    }
    apiBase(site) {
        return 'https://wiki.biligame.com/' + encodeURIComponent(site.slug) + '/api.php';
    }
    pageUrl(site, title) {
        return 'https://wiki.biligame.com/' + encodeURIComponent(site.slug) + '/' + encodeURIComponent(title.replace(/\s/g, '_'));
    }
    cacheGet(key) {
        if (this.cacheTtlMs <= 0)
            return undefined;
        const hit = this.memory.get(key);
        if (hit === undefined || Date.now() - hit.at >= this.cacheTtlMs)
            return undefined;
        return hit.value;
    }
    cacheSet(key, value) {
        if (this.cacheTtlMs <= 0)
            return;
        this.memory.set(key, { at: Date.now(), value });
    }
    async search(site, keyword, limit = 6) {
        const trimmed = keyword.trim();
        if (trimmed === '')
            return [];
        const key = 'search:' + site.slug + ':' + trimmed + ':' + limit;
        const cached = this.cacheGet(key);
        if (cached !== undefined)
            return cached;
        const url = this.apiBase(site)
            + '?action=query&list=search&srlimit=' + String(Math.max(1, Math.min(20, limit)))
            + '&srsearch=' + encodeURIComponent(trimmed)
            + '&format=json&formatversion=2';
        const json = await this.fetcher.json(url, { referer: this.pageUrl(site, '首页') });
        const hits = (json.query?.search ?? [])
            .filter(item => typeof item.title === 'string' && item.title !== '')
            .map(item => ({
            title: item.title,
            snippet: htmlToText(item.snippet ?? '').slice(0, 160),
            url: this.pageUrl(site, item.title),
        }));
        this.cacheSet(key, hits);
        this.log('debug', 'wiki 搜索 ' + site.slug + ' "' + trimmed + '" → ' + hits.length + ' 条');
        return hits;
    }
    /**
     * 拉全站页面标题（词表用）。MediaWiki 每页最多 500 条，这里最多翻 maxPages 页。
     * BWIKI 限流很凶：内部由 PoliteFetcher 串行排队，调用方一次只拉一个游戏即可。
     */
    async allpages(site, maxPages = 3) {
        const key = 'allpages:' + site.slug + ':' + String(maxPages);
        const cached = this.cacheGet(key);
        if (cached !== undefined)
            return cached;
        const titles = [];
        let cont = '';
        for (let page = 0; page < Math.max(1, maxPages); page += 1) {
            const url = this.apiBase(site)
                + '?action=query&list=allpages&apnamespace=0&aplimit=500&format=json&formatversion=2'
                + (cont === '' ? '' : '&apcontinue=' + encodeURIComponent(cont));
            const json = await this.fetcher.json(url, { referer: this.pageUrl(site, '首页') });
            for (const item of json.query?.allpages ?? []) {
                if (typeof item.title === 'string' && item.title !== '')
                    titles.push(item.title);
            }
            cont = json.continue?.apcontinue ?? '';
            if (cont === '')
                break;
        }
        this.cacheSet(key, titles);
        this.log('debug', 'wiki 标题 ' + site.slug + ' → ' + titles.length + ' 个');
        return titles;
    }
    /** 列出一个页面的章节（用于先看大纲，再只读需要的章节，省上下文） */
    async sections(site, title) {
        const clean = title.trim();
        if (clean === '')
            throw new Error('页面标题不能为空');
        const key = 'sections:' + site.slug + ':' + clean;
        const cached = this.cacheGet(key);
        if (cached !== undefined)
            return cached;
        const url = this.apiBase(site)
            + '?action=parse&page=' + encodeURIComponent(clean)
            + '&prop=sections&redirects=1&format=json&formatversion=2';
        const json = await this.fetcher.json(url, { referer: this.pageUrl(site, clean) });
        const sections = (json.parse?.sections ?? [])
            .filter(item => item.index !== undefined && item.line !== undefined)
            .map(item => ({ index: Number(item.index), level: Number(item.level ?? 1), title: htmlToText(item.line ?? '') }));
        this.cacheSet(key, sections);
        return sections;
    }
    async read(site, title, options = {}) {
        const clean = title.trim();
        const maxChars = options.maxChars;
        const section = options.section;
        if (clean === '')
            throw new Error('页面标题不能为空');
        const key = 'page:' + site.slug + ':' + clean + (section === undefined ? '' : '#' + String(section));
        const cached = this.cacheGet(key);
        if (cached !== undefined)
            return trimPage(cached, maxChars);
        const url = this.apiBase(site)
            + '?action=parse&page=' + encodeURIComponent(clean)
            + '&prop=text&redirects=1&format=json&formatversion=2&disablelimitreport=1&disableeditsection=1'
            + (section === undefined ? '' : '&section=' + String(section));
        const json = await this.fetcher.json(url, { referer: this.pageUrl(site, clean) });
        if (json.error !== undefined) {
            throw new Error('wiki 没有这个页面（' + String(json.error.info ?? json.error.code ?? 'unknown') + '）');
        }
        const html = json.parse?.text ?? '';
        if (html === '')
            throw new Error('wiki 返回空页面：' + clean);
        let text = htmlToText(html);
        // 有些条目是重定向页（正文只有"重定向到： / - 头目"），跟一层
        const redirect = /^重定向到：\s*\/?\s*-\s*(.+)$/m.exec(text);
        if (redirect !== null && (redirect[1] ?? '').trim() !== '') {
            const target = (redirect[1] ?? '').trim();
            this.log('debug', '跟随重定向 ' + clean + ' → ' + target);
            return this.read(site, target, options);
        }
        const result = {
            title: json.parse?.title ?? clean,
            url: this.pageUrl(site, clean),
            text,
            chars: text.length,
            truncated: false,
        };
        this.cacheSet(key, result);
        this.log('debug', 'wiki 页面 ' + site.slug + '/' + clean + ' → ' + result.chars + ' 字');
        return trimPage(result, maxChars);
    }
}
export function trimPage(page, maxChars) {
    if (maxChars === undefined || maxChars <= 0 || page.text.length <= maxChars)
        return page;
    return {
        ...page,
        text: page.text.slice(0, maxChars) + '\n…（内容过长，已截断；完整页面见来源链接）',
        truncated: true,
    };
}
/** 工具层用：把错误说成人话（限流/没有页面/网络） */
export function humanError(error) {
    if (error instanceof Error && /567|403|429|503/.test(error.message)) {
        return 'wiki 现在限流中（' + describeError(error) + '），过一会儿再问';
    }
    return describeError(error);
}

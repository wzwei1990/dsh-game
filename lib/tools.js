import { defineTool } from '@deepseek-ai/dsh-tools';
import { parseBwikiUrl } from './registry.js';
function textOutput() {
    return {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
    };
}
function entryLine(entry, reverifyDays = 0) {
    const flags = [];
    if (entry.status === 'unresolved')
        flags.push('未找到 wiki');
    if (entry.status === 'stale')
        flags.push('地址可能已变，需 game_verify');
    if (entry.verifiedAt === undefined || entry.verifiedAt === 0)
        flags.push('从未校验');
    else if (reverifyDays > 0 && Date.now() - entry.verifiedAt > reverifyDays * 24 * 60 * 60_000) {
        flags.push('已 ' + Math.round((Date.now() - entry.verifiedAt) / (24 * 60 * 60_000)) + ' 天未校验');
    }
    return entry.name + '（' + entry.site.slug + '）' + (flags.length === 0 ? '' : ' [' + flags.join(' / ') + ']');
}
/** 搜索结果的紧凑文本 */
export function searchText(game, keyword, hits, site) {
    if (hits.length === 0) {
        return '【' + game + '】没有搜到「' + keyword + '」相关条目。\n'
            + '可以换个关键词再试（如 Boss 名 / 道具名 / 玩法），或直接告诉我你记得的页面名。'
            + '\n来源站：https://wiki.biligame.com/' + site.slug + '/';
    }
    const lines = ['【' + game + '】搜「' + keyword + '」命中 ' + hits.length + ' 条：'];
    for (const [index, hit] of hits.entries()) {
        lines.push(String(index + 1) + '. ' + hit.title + (hit.snippet === '' ? '' : ' —— ' + hit.snippet));
    }
    lines.push('来源站：https://wiki.biligame.com/' + site.slug + '/');
    lines.push('要正文就调 game_wiki_read（game=' + game + ', title=上面的标题）。');
    return lines.join('\n');
}
/** 正文结果的文本（带来源，方便模型引用） */
export function pageText(result, game) {
    return [
        '【' + game + '】wiki 条目：' + result.title,
        '来源：' + result.url,
        '',
        result.text,
        result.truncated ? '（已截断）' : '',
    ].filter(part => part !== '').join('\n');
}
export function registerTools(ctx, deps) {
    const { registry, wiki, log } = deps;
    ctx.tools.register(defineTool({
        name: 'game_list',
        description: '列出当前已收录的游戏（按最近被聊到的顺序）。用于确认某个游戏现在能不能查 wiki。',
        parameters: {},
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async () => {
            const games = registry.list();
            const lines = games.length === 0 ? ['游戏表是空的。'] : ['已收录 ' + games.length + ' 个游戏：'];
            if (games.length > 0) {
                lines.push(...games.map((entry, index) => String(index + 1) + '. ' + entryLine(entry, deps.reverifyDays)));
            }
            lines.push('注册表：' + registry.path + (registry.lastSaveError === '' ? '' : '（写入失败：' + registry.lastSaveError + '）'));
            return lines.join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_resolve',
        description: '把游戏名（可带别名）解析成可查询的 wiki 站点。已收录直接返回；未收录时给 slug 或 BWIKI 子站地址即可探测并登记（一次探测，之后落盘复用）。',
        parameters: {
            name: { type: 'string', required: true, description: '游戏名或别名，如「影之刃零」「影零」' },
            slug: { type: 'string', description: 'BWIKI 子站 slug（如 yingzhiren）' },
            url: { type: 'string', description: 'BWIKI 子站地址（如 https://wiki.biligame.com/yingzhiren/），会自动取出 slug' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            const existing = registry.resolve(input.name);
            const requested = (input.slug ?? '').trim() !== '' ? (input.slug ?? '') : (input.url ?? '');
            if (existing !== undefined && requested === '') {
                return '已收录：' + entryLine(existing, deps.reverifyDays) + '\n可直接 game_wiki_search(game=' + existing.name + ', keyword=…)。';
            }
            const slug = parseBwikiUrl(requested);
            if (slug === undefined) {
                return '「' + input.name + '」不在游戏表里，而且没有可用的 BWIKI 子站信息。\n'
                    + 'BWIKI 的子站地址形如 https://wiki.biligame.com/<slug>/（slug 是拼音缩写，不等于游戏名）。\n'
                    + '做法：先用 web_search 搜「' + input.name + ' BWIKI」拿到子站地址，再把 url 传进来。';
            }
            try {
                const { probeSite } = await import('./wiki.js');
                const { PoliteFetcher } = await import('./throttle.js');
                const fetcher = new PoliteFetcher({
                    minIntervalMs: deps.minIntervalMs,
                    maxRetries: 1,
                    timeoutMs: 20000,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
                    log,
                });
                const probe = await probeSite(fetcher, slug);
                if (!probe.ok) {
                    registry.upsert({ name: input.name, site: { kind: 'biligame', slug }, status: 'unresolved', source: 'url' });
                    return 'https://wiki.biligame.com/' + slug + '/ 不像一个可用的 BWIKI 站点（没有返回站点信息），已记为"未找到"，不会反复探测。';
                }
                const entry = registry.upsert({
                    name: input.name,
                    site: { kind: 'biligame', slug },
                    source: input.url !== undefined && input.url.trim() !== '' ? 'url' : 'manual',
                });
                return '已登记：' + entry.name + ' → ' + probe.name + '（https://wiki.biligame.com/' + slug + '/）'
                    + '\n以后直接用 game_wiki_search(game=' + entry.name + ', keyword=…)。';
            }
            catch (error) {
                log('warn', '探测 ' + slug + ' 失败: ' + (error instanceof Error ? error.message : String(error)));
                return '探测 ' + slug + ' 失败（可能 slug 不对，或 BWIKI 正在限流）。可以稍后重试。';
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_verify',
        description: '复验某个游戏登记的 wiki 地址是否还能用（wiki 可能改地址/改版）。失败会把该游戏标成 stale，提示重新登记。',
        parameters: {
            game: { type: 'string', required: true, description: '游戏名' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            let site;
            try {
                site = registry.site(input.game);
            }
            catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
            try {
                const { probeSite } = await import('./wiki.js');
                const { PoliteFetcher } = await import('./throttle.js');
                const fetcher = new PoliteFetcher({
                    minIntervalMs: deps.minIntervalMs,
                    maxRetries: 1,
                    timeoutMs: 20000,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
                    log,
                });
                const probe = await probeSite(fetcher, site.slug);
                if (!probe.ok) {
                    registry.markStale(input.game);
                    return '复验失败：https://wiki.biligame.com/' + site.slug + '/ 已取不到站点信息，已标记为 stale。'
                        + '\n请重新找该游戏的 BWIKI 地址，再用 game_resolve(game=…, url=…)。';
                }
                registry.markVerified(input.game, site);
                return '复验通过：' + input.game + ' → ' + probe.name + '（https://wiki.biligame.com/' + site.slug + '/）';
            }
            catch (error) {
                return '复验失败（可能限流，稍后重试）：' + (error instanceof Error ? error.message : String(error));
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_wiki_search',
        description: '在某个游戏的 BWIKI 里搜条目（Boss/道具/玩法/任务都行），返回标题+摘要+来源。',
        parameters: {
            game: { type: 'string', required: true, description: '游戏名（需在游戏表里，或先 game_resolve）' },
            keyword: { type: 'string', required: true, description: '搜索词，如「Boss」「魔渊」「弹反」' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            let site;
            try {
                site = registry.site(input.game);
            }
            catch (error) {
                return (error instanceof Error ? error.message : String(error)) + '\n先调 game_list 看看有哪些游戏。';
            }
            try {
                const hits = await wiki.search(site, input.keyword, 6);
                return searchText(input.game, input.keyword, hits, site);
            }
            catch (error) {
                const { humanError } = await import('./wiki.js');
                const message = humanError(error);
                if (/404|没有这个页面|no page|不存在/i.test(message)) {
                    registry.markStale(input.game);
                    return '查「' + input.game + '」wiki 失败：' + message + '\n（已标记为 stale；地址可能变了，先 game_verify 或重新 game_resolve）';
                }
                return '查「' + input.game + '」wiki 失败：' + message;
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_wiki_outline',
        description: '列出一个 wiki 条目的章节大纲（章节号 + 标题）。长条目先看大纲，再用 game_wiki_read 的 section 只读需要的那节，省上下文。',
        parameters: {
            game: { type: 'string', required: true, description: '游戏名' },
            title: { type: 'string', required: true, description: '条目名' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            let site;
            try {
                site = registry.site(input.game);
            }
            catch (error) {
                return error instanceof Error ? error.message : String(error);
            }
            try {
                const sections = await wiki.sections(site, input.title);
                if (sections.length === 0) {
                    return '「' + input.title + '」没有可用的章节（可能是很短的重定向页或列表页），直接 game_wiki_read 读全文。';
                }
                const lines = ['【' + input.game + '】' + input.title + ' 章节大纲：'];
                for (const section of sections) {
                    lines.push(String(section.index) + '. ' + '  '.repeat(Math.max(0, section.level - 1)) + section.title);
                }
                lines.push('用法：game_wiki_read(game=…, title=…, section=上面的编号)');
                return lines.join('\n');
            }
            catch (error) {
                const { humanError } = await import('./wiki.js');
                return '取章节失败：' + humanError(error);
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_wiki_read',
        description: '读某个游戏 BWIKI 条目的正文（纯文本，带来源链接）。这是"真的知道"内容的关键：先 search 拿标题，再 read 正文。',
        parameters: {
            game: { type: 'string', required: true, description: '游戏名' },
            title: { type: 'string', required: true, description: '条目名（game_wiki_search 返回的标题）' },
            section: { type: 'number', description: '只读某一节（先用 game_wiki_outline 拿章节号）' },
            max_chars: { type: 'number', description: '最多返回多少字符（默认按配置）' },
        },
        output: textOutput(),
        isConcurrencySafe: () => true,
        execute: async (args) => {
            const input = args;
            let site;
            try {
                site = registry.site(input.game);
            }
            catch (error) {
                return (error instanceof Error ? error.message : String(error));
            }
            const maxChars = Number.isFinite(Number(input.max_chars)) ? Number(input.max_chars) : deps.maxChars;
            try {
                const page = await wiki.read(site, input.title, { maxChars, section: Number.isFinite(Number(input.section)) ? Number(input.section) : undefined });
                return pageText(page, input.game);
            }
            catch (error) {
                const { humanError } = await import('./wiki.js');
                return '读「' + input.title + '」失败：' + humanError(error);
            }
        },
    }));
}

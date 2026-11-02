import { defineTool } from '@deepseek-ai/dsh-tools';
function textOutput() {
    return {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: value }],
    };
}
function entryLine(entry) {
    return entry.name + '（' + entry.site.slug + '）'
        + (entry.status === 'unresolved' ? ' [未找到 wiki]' : '');
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
            if (games.length === 0)
                return '游戏表是空的。';
            return ['已收录 ' + games.length + ' 个游戏：', ...games.map((entry, index) => String(index + 1) + '. ' + entryLine(entry))].join('\n');
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_resolve',
        description: '把群聊里提到的游戏名（可带别名）解析成可查询的 wiki 站点；已收录的直接返回，未收录的尝试按 BWIKI 约定探测并注册。',
        parameters: {
            name: { type: 'string', required: true, description: '游戏名或别名，如「影之刃零」「影零」' },
            slug: { type: 'string', description: '已知 BWIKI 子站 slug 时可直接给（如 yingzhiren），省一次探测' },
        },
        output: textOutput(),
        isConcurrencySafe: () => false,
        execute: async (args) => {
            const input = args;
            const existing = registry.resolve(input.name);
            if (existing !== undefined) {
                return '已收录：' + entryLine(existing) + '\n可直接 game_wiki_search(game=' + existing.name + ', keyword=…)。';
            }
            const slug = (input.slug ?? '').trim();
            if (slug === '') {
                return '「' + input.name + '」不在游戏表里，而且没有给 BWIKI 子站 slug。\n'
                    + 'BWIKI 的子站地址是 https://wiki.biligame.com/<slug>/ ，slug 不等于游戏名；'
                    + '可以先在浏览器/搜索里找到该游戏的 BWIKI 首页，再把 slug 传进来（或直接告诉我子站地址）。';
            }
            try {
                const { probeSite } = await import('./wiki.js');
                const { PoliteFetcher } = await import('./throttle.js');
                const fetcher = new PoliteFetcher({
                    minIntervalMs: 6000,
                    maxRetries: 1,
                    timeoutMs: 20000,
                    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36',
                    log,
                });
                const probe = await probeSite(fetcher, slug);
                if (!probe.ok)
                    return 'https://wiki.biligame.com/' + slug + '/ 不像一个可用的 BWIKI 站点（没有返回站点信息）。';
                const entry = registry.upsert({ name: input.name, site: { kind: 'biligame', slug } });
                return '已注册：' + entry.name + ' → ' + probe.name + '（https://wiki.biligame.com/' + slug + '/）';
            }
            catch (error) {
                log('warn', '探测 ' + slug + ' 失败: ' + (error instanceof Error ? error.message : String(error)));
                return '探测 ' + slug + ' 失败（可能 slug 不对，或 BWIKI 正在限流）。';
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
                return '查「' + input.game + '」wiki 失败：' + humanError(error);
            }
        },
    }));
    ctx.tools.register(defineTool({
        name: 'game_wiki_read',
        description: '读某个游戏 BWIKI 条目的正文（纯文本，带来源链接）。这是"真的知道"内容的关键：先 search 拿标题，再 read 正文。',
        parameters: {
            game: { type: 'string', required: true, description: '游戏名' },
            title: { type: 'string', required: true, description: '条目名（game_wiki_search 返回的标题）' },
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
                const page = await wiki.read(site, input.title, maxChars);
                return pageText(page, input.game);
            }
            catch (error) {
                const { humanError } = await import('./wiki.js');
                return '读「' + input.title + '」失败：' + humanError(error);
            }
        },
    }));
}

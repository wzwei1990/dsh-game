/**
 * 游戏注册表：谁在被聊，谁就排前面；新游戏只在第一次被提到时探测一次。
 * 落盘 ~/.dsh/dsh-game/games.json（跨会话复用，重启不丢）。
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
/** 归一化：去空白/标点、全角转半角、小写 */
export function normalizeName(value) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[《》「」『』【】()（）\[\]{}<>·・、,，.。:：;；!！?？"'“”‘’\s_-]/g, '');
}
/** 内置种子：已实测跑通的游戏（新游戏由 discover 注册，这里只放确定能用的） */
export const SEED_GAMES = [
    {
        name: '影之刃零',
        aliases: ['影之刃零', '影之刃', '影零', 'phantom blade zero', 'pbz'],
        site: { kind: 'biligame', slug: 'yingzhiren' },
        hits: 0,
        firstSeen: 0,
        lastHit: 0,
        status: 'active',
    },
];
export class GameRegistry {
    file;
    log;
    games;
    constructor(options = {}) {
        this.file = options.file ?? join(homedir(), '.dsh', 'dsh-game', 'games.json');
        this.log = options.log ?? (() => undefined);
        this.games = this.load();
    }
    load() {
        try {
            const raw = JSON.parse(readFileSync(this.file, 'utf8'));
            const games = (raw.games ?? []).filter(entry => typeof entry?.name === 'string' && entry.site?.slug !== undefined);
            if (games.length > 0)
                return mergeSeeds(games);
        }
        catch (error) {
            this.log('debug', '读取注册表失败（用内置种子）: ' + (error instanceof Error ? error.message : String(error)));
        }
        return mergeSeeds([]);
    }
    save() {
        try {
            mkdirSync(dirname(this.file), { recursive: true });
            writeFileSync(this.file, JSON.stringify({ version: 1, games: this.games }, null, 2), 'utf8');
        }
        catch (error) {
            this.log('warn', '写注册表失败: ' + (error instanceof Error ? error.message : String(error)));
        }
    }
    size() {
        return this.games.length;
    }
    /** 按最近命中排序（活跃游戏在前） */
    list() {
        return [...this.games].sort((a, b) => {
            if (a.status !== b.status)
                return a.status === 'active' ? -1 : 1;
            return b.lastHit - a.lastHit || b.hits - a.hits;
        });
    }
    /** 找游戏（支持别名/模糊），命中即 hits++ */
    resolve(name) {
        const needle = normalizeName(name);
        if (needle === '')
            return undefined;
        const exact = this.games.find(entry => normalizeName(entry.name) === needle)
            ?? this.games.find(entry => entry.aliases.some(alias => normalizeName(alias) === needle));
        const hit = exact ?? this.games.find(entry => {
            const hay = [entry.name, ...entry.aliases].map(normalizeName);
            return hay.some(value => value.includes(needle) || (needle.length >= 3 && needle.includes(value)));
        });
        if (hit === undefined)
            return undefined;
        hit.hits += 1;
        hit.lastHit = Date.now();
        this.save();
        return hit;
    }
    /** 取站点（找不到就抛错，让工具层给模型一句人话） */
    site(name) {
        const entry = this.resolve(name);
        if (entry === undefined)
            throw new Error('游戏表里没有「' + name + '」；先用 game_resolve 探测，或确认名字');
        return entry.site;
    }
    /** 注册/更新（discover 成功后调用） */
    upsert(input) {
        const needle = normalizeName(input.name);
        const existing = this.games.find(entry => normalizeName(entry.name) === needle);
        if (existing !== undefined) {
            existing.site = input.site;
            existing.aliases = dedupe([...(input.aliases ?? []), ...existing.aliases, input.name]);
            existing.status = input.status ?? 'active';
            existing.lastHit = Date.now();
            this.save();
            return existing;
        }
        const entry = {
            name: input.name,
            aliases: dedupe([input.name, ...(input.aliases ?? [])]),
            site: input.site,
            hits: 1,
            firstSeen: Date.now(),
            lastHit: Date.now(),
            status: input.status ?? 'active',
        };
        this.games.push(entry);
        this.save();
        return entry;
    }
}
function dedupe(values) {
    const seen = new Set();
    const out = [];
    for (const value of values) {
        const trimmed = value.trim();
        const key = normalizeName(trimmed);
        if (key === '' || seen.has(key))
            continue;
        seen.add(key);
        out.push(trimmed);
    }
    return out;
}
/** 种子合并：磁盘上已有的保留命中统计，缺失的补进来 */
export function mergeSeeds(games) {
    const out = [...games];
    for (const seed of SEED_GAMES) {
        const key = normalizeName(seed.name);
        if (out.some(entry => normalizeName(entry.name) === key))
            continue;
        out.push({ ...seed, aliases: [...seed.aliases] });
    }
    return out;
}

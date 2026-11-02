# dsh-game

给 DeepSeek Harness 装上**"真的知道游戏内容"**的能力：查游戏 Wiki 的正文，把事实交给模型——这样机器人聊游戏时才有东西支撑"观点"，而不是只会综合别人说的话。

> 定位：**能力插件**（和 dsh-meme / dsh-bili 一样各做各的）。通道（dsh-napcat 等）按需消费 `ctx.get('dshGame')`。

## 现在能做什么（v0.1，只做**实测跑通**的源）

| 工具 | 作用 |
|---|---|
| `game_list` | 列出已收录的游戏（按最近被聊到的顺序） |
| `game_resolve` | 游戏名 → wiki 站点（已收录直接返回；给了 slug 就探测并注册） |
| `game_wiki_search` | 站内搜条目（Boss / 道具 / 玩法 / 任务） |
| `game_verify` | 复验登记的 wiki 地址是否还能用（失败标 stale，提示重新登记） |
| `game_wiki_outline` | 列条目的章节大纲（长条目先看大纲，再只读需要的节） |
| `game_wiki_read` | 读条目正文/某一节（纯文本，带来源链接；自动跟随重定向；表格转成行） |

实测（影之刃零，`wiki.biligame.com/yingzhiren`）：

```
game_wiki_search(game=影之刃零, keyword=Boss)
game_verify(game=影之刃零)
→ BOSS图鉴 | BOSS攻略 | 隐藏BOSS | 魔渊BOSS攻略 | 魔渊BOSS

game_wiki_read(game=影之刃零, title=BOSS图鉴)     # 重定向页自动跟随
→ 《影之刃零》头目图鉴，共75个图鉴条目…
game_wiki_read(game=影之刃零, title=魔渊BOSS攻略)
→ 魔渊是《影之刃零》中的高难度副本区域… ### 通用技巧 - 熟练掌握 弹反 技巧…
```

## 为什么只做 BWIKI

| 来源 | 判定 |
|---|---|
| **BWIKI（wiki.biligame.com）** | ✅ **唯一主源**：MediaWiki Action API，搜索 + 正文都可取，中文游戏覆盖广 |
| 游民星空 / 游侠 / 3DM | ❌ 无公开 API、反爬、攻略是分页图集，抓下来也难摘要 |
| 灰机wiki | ❌ 实测 `api.php` 返回 403（未通） |
| Fandom / wiki.gg | ⏸ 有 API 但中文游戏少，以后再评估 |

**BWIKI 的限流很凶（实测）**：连续几个请求就 `HTTP 567`（非标准状态=被限），冷却 ~25 秒后单个请求恢复。所以本插件：

- **单主机串行**，默认最小间隔 **6 秒**
- 403/429/503/567 走**指数退避**（2×、4×…），不立刻重试
- 搜索/正文**内存缓存**（默认 24 小时 TTL）

## 游戏表：随聊天自动插拔

`~/.dsh/games.json`（可配 `registryFile`）保存游戏表：

```json
{
  "version": 1,
  "games": [
    {
      "name": "影之刃零",
      "aliases": ["影之刃零", "影之刃", "影零", "phantom blade zero", "pbz"],
      "site": { "kind": "biligame", "slug": "yingzhiren" },
      "hits": 12,
      "firstSeen": 1762000000000,
      "lastHit": 1762100000000,
      "status": "active"
    }
  ]
}
```

| 行为 | 说明 |
|---|---|
| 命中别名 | `hits++` / `lastHit` 更新，排序靠前 |
| 没收录的游戏 | `game_resolve` 需要 BWIKI 子站 slug（`https://wiki.biligame.com/<slug>/`，slug ≠ 游戏名），探测通过后注册 |
| 没找到 | `status: "unresolved"`，不反复探测 |
| 排序 | 按 `lastHit` / `hits`，热门游戏排前面 |

> 为什么不让插件自己猜 slug：BWIKI 的 slug 是拼音缩写（影之刃零 = `yingzhiren`，不是 `yjsl0`），**必须由外部确认**。目前的做法是模型/用户给出子站地址或 slug，插件负责验证 + 落盘。

## 地址会变，所以有"复验"

BWIKI 子站会改地址/改版，所以游戏表里每条都记 `verifiedAt` + `status`：

| 状态 | 含义 | 怎么变 |
|---|---|---|
| `active` | 可用 | `game_resolve` / `game_verify` 成功时刷新 `verifiedAt` |
| `stale` | 以前能用，现在访问失败 | 查页面失败/复验失败时自动标记 |
| `unresolved` | 探测过但没找到 | 不反复探测 |

- `reverifyDays`（默认 30）：超过 N 天没校验，`game_list` 会提示"已 N 天未校验"
- 用户/模型随时可以 `game_verify(game)` 复验；失败就重新找地址 → `game_resolve(game, url=…)` 覆盖登记
- **hits 历史保留**，不会因为改地址丢掉"这个游戏多热"的信息

## 配置

| 字段 | 默认 | 说明 |
|---|---|---|
| `registryFile` | 空 | 游戏表路径（空 = `~/.dsh/dsh-game/games.json`） |
| `minIntervalMs` | `6000` | 同主机请求最小间隔；BWIKI 很凶，不建议低于 3000 |
| `cacheTtlMinutes` | `1440` | 页面/搜索缓存（0 = 不缓存） |
| `timeoutMs` | `20000` | 单次请求超时 |
| `maxRetries` | `2` | 限流/网络错误重试次数 |
| `reverifyDays` | `1` | 超过多少天未校验就提示复验（0=不提示）；默认 1 天，避免长期用死链 |
| `maxReplyChars` | `6000` | 工具单次返回字符上限（超出截断并标注） |
| `userAgent` | 浏览器 UA | BWIKI 对默认 UA 更苛刻 |
| `logLevel` | `info` | `debug` 会打每次请求与命中 |

## 设置面板

装好后在「设置 → 插件」左侧会多一个 **游戏 Wiki** 页（`client/index.js`，手写客户端模块、免构建），可动态改：

| 组 | 字段 |
|---|---|
| 抓取 | 请求间隔（`minIntervalMs`）、超时（`timeoutMs`）、重试次数（`maxRetries`） |
| 缓存 | 缓存时长（`cacheTtlMinutes`）、复验天数（`reverifyDays`，默认 1） |
| 输出与日志 | 返回字符上限（`maxReplyChars`）、日志级别（`logLevel`） |

`registryFile` / `userAgent` 属于排障项，不上 UI；游戏表真实路径用 `game_list` 查看。

## 安装

```bash
dsh plugin --profile web add github:wzwei1990/dsh-game
# 重启 DSH 后生效
```

## 对外契约（给通道用）

```ts
const game = ctx.get('dshGame')   // 可能 undefined
await game.list()
await game.resolve('影之刃零')                       // GameEntry | undefined
await game.search('影之刃零', 'Boss')                // SearchHit[]
await game.read('影之刃零', '魔渊BOSS攻略')          // PageResult（含 url）
```

**通道不负责抓取**，只负责把结果变成人话/卡片。

## 路线图

- [x] **G0** BWIKI 适配器（搜索 / 正文 / 重定向）+ 游戏表 + 限速缓存 + 工具
- [x] **G1** 地址登记 + 复验（game_resolve(url) / game_verify / stale 标记 / reverifyDays）
- [ ] **G2** 免手填发现：总站搜索/web_search 自动拿到子站地址（省一次人工）
- [x] **G2.5** 正文整形：章节大纲 + 按节读取、表格转行、目录剔除、**等级表压缩**（50 行 → 5 行区间）
- [ ] **G3** 与 dsh-napcat 联动：群里出现游戏名 → 预取摘要 → 带来源回答
- [ ] **G4** 第二数据源（先验证可用性再接）：如 Fandom / wiki.gg / Steam 元数据
- [ ] **G5** 观点档案：结合本插件查到的事实 + 机器人自己的历史发言，支撑"有立场"

## 已知限制

| 限制 | 说明 |
|---|---|
| 影之刃零 wiki 内容还很少 | 游戏 2026-10-29 才发售，很多页面是「待补充」 |
| slug 需外部确认 | BWIKI 子站 slug 是拼音缩写，不能从中文名推出 |
| 567 限流 | 短时间多问几个词就会被限，退避后恢复；已做串行+缓存 |
| 只有中文 | 外文游戏覆盖依赖后续数据源 |

## License

MIT

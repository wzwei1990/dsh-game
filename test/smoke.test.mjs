import assert from 'node:assert/strict'
import test from 'node:test'

const { htmlToText, decodeEntities, trimPage } = await import('../lib/wiki.js')
const { normalizeName, mergeSeeds, GameRegistry, SEED_GAMES, parseBwikiUrl, needsVerify } = await import('../lib/registry.js')
const { backoffMs, hostOf } = await import('../lib/throttle.js')
const { searchText, pageText } = await import('../lib/tools.js')

test('HTML → 纯文本：保留标题层级、去掉脚本与导航噪声', () => {
  const html = [
    '<script>var x = 1</script>',
    '<style>.a{}</style>',
    '<div>阅 编 刷 历</div>',
    '<p>如果是第一次来，按"Ctrl+D"可以收藏</p>',
    '<h2><span>BOSS列表</span></h2>',
    '<p>魔渊&nbsp;高&nbsp;多阶段战斗</p>',
    '<ul><li>弹反</li><li>闪避</li></ul>',
  ].join('')
  const text = htmlToText(html)
  assert.ok(text.includes('## BOSS列表'), text)
  assert.ok(text.includes('魔渊 高 多阶段战斗'))
  assert.ok(text.includes('- 弹反'))
  assert.ok(!text.includes('阅 编 刷 历'))
  assert.ok(!text.includes('第一次来'))
  assert.ok(!text.includes('<'))
})

test('实体解码：nbsp / 数字 / 十六进制', () => {
  assert.equal(decodeEntities('a&nbsp;b'), 'a b')
  assert.equal(decodeEntities('&#65;&#x42;'), 'AB')
  assert.equal(decodeEntities('&amp;&lt;&gt;'), '&<>')
})

test('页面截断：超出上限就标注', () => {
  const page = { title: 'T', url: 'u', text: 'x'.repeat(100), chars: 100, truncated: false }
  assert.equal(trimPage(page, 10).truncated, true)
  assert.ok(trimPage(page, 10).text.includes('已截断'))
  assert.equal(trimPage(page, 1000).truncated, false)
})

test('游戏名归一化：全角/空白/书名号都能对上', () => {
  assert.equal(normalizeName('《影之刃零》'), '影之刃零')
  assert.equal(normalizeName(' Phantom Blade Zero '), 'phantombladezero')
  assert.equal(normalizeName('影 之 刃 零'), '影之刃零')
})

test('注册表：种子合并不重复、别名能命中、命中计数递增', () => {
  const merged = mergeSeeds([])
  assert.equal(merged.filter(entry => entry.name === '影之刃零').length, 1)
  const seeded = mergeSeeds([{ name: '影之刃零', aliases: ['影零'], site: { kind: 'biligame', slug: 'yingzhiren' }, hits: 5, firstSeen: 1, lastHit: 2, status: 'active' }])
  assert.equal(seeded.length, 1)
  assert.equal(seeded[0].hits, 5)

  const registry = new GameRegistry({ file: 'Z:\\definitely-not-writable\\games.json' })
  const hit = registry.resolve('影零')
  assert.ok(hit !== undefined)
  assert.equal(hit.site.slug, 'yingzhiren')
  registry.resolve('影之刃')
  assert.ok((registry.resolve('影之刃零')?.hits ?? 0) >= 3)
  assert.equal(registry.size() >= SEED_GAMES.length, true)
})

test('退避：重试次数越多等得越久', () => {
  assert.ok(backoffMs(1, 6000) > backoffMs(0, 6000))
  assert.ok(backoffMs(2, 6000) > backoffMs(1, 6000))
})

test('hostOf：取主机名', () => {
  assert.equal(hostOf('https://wiki.biligame.com/yingzhiren/api.php'), 'wiki.biligame.com')
})

test('工具输出：搜索结果与正文都带来源', () => {
  const site = { kind: 'biligame', slug: 'yingzhiren' }
  const text = searchText('影之刃零', 'Boss', [{ title: 'BOSS攻略', snippet: '总览', url: 'https://x' }], site)
  assert.ok(text.includes('BOSS攻略'))
  assert.ok(text.includes('wiki.biligame.com/yingzhiren'))
  const page = pageText({ title: 'BOSS攻略', url: 'https://wiki.biligame.com/yingzhiren/BOSS攻略', text: '正文', truncated: false }, '影之刃零')
  assert.ok(page.includes('来源：https://wiki.biligame.com/yingzhiren/BOSS攻略'))
})
test('BWIKI 地址解析：URL / 纯 slug / 非法输入', () => {
  assert.equal(parseBwikiUrl('https://wiki.biligame.com/yingzhiren/首页'), 'yingzhiren')
  assert.equal(parseBwikiUrl('wiki.biligame.com/ys/api.php'), 'ys')
  assert.equal(parseBwikiUrl('yingzhiren'), 'yingzhiren')
  assert.equal(parseBwikiUrl('影之刃零'), undefined)
  assert.equal(parseBwikiUrl(''), undefined)
})

test('复验判定：从未校验 / 超过 ttl / 未过期 / ttl=0', () => {
  const base = { name: 'A', aliases: [], site: { kind: 'biligame', slug: 'a' }, hits: 1, firstSeen: 1, lastHit: 2, status: 'active' }
  assert.equal(needsVerify({ ...base }, 30, 1000), true)
  assert.equal(needsVerify({ ...base, verifiedAt: 0 }, 30, 1000), true)
  const old = 1000 - 40 * 24 * 60 * 60_000
  assert.equal(needsVerify({ ...base, verifiedAt: old }, 30, 1000), true)
  assert.equal(needsVerify({ ...base, verifiedAt: 999 }, 30, 1000), false)
  assert.equal(needsVerify({ ...base }, 0, 1000), false)
})

test('注册表：markStale / markVerified 改状态且保留 hits', () => {
  const registry = new GameRegistry({ file: 'Z:\\definitely-not-writable\\games2.json' })
  const before = registry.resolve('影之刃零')
  assert.ok(before !== undefined)
  const hits = before.hits
  registry.markStale('影之刃零')
  const stale = registry.list().find(entry => entry.name === '影之刃零')
  assert.equal(stale.status, 'stale')
  assert.equal(stale.hits, hits)
  registry.markVerified('影之刃零', { kind: 'biligame', slug: 'yingzhiren' })
  const fresh = registry.list().find(entry => entry.name === '影之刃零')
  assert.equal(fresh.status, 'active')
  assert.ok((fresh.verifiedAt ?? 0) > 0)
})
test('表格转行：每个 tr 一行，单元格用 / 分隔', () => {
  const html = '<table><tr><th>BOSS</th><th>难度</th></tr><tr><td>魔渊</td><td>高</td></tr></table>'
  const text = htmlToText(html)
  assert.ok(text.includes('BOSS / 难度'), text)
  assert.ok(text.includes('魔渊 / 高'), text)
})

test('目录区块整块剔除', () => {
  const html = '<div id="toc" class="toc"><ul><li>1 BOSS列表</li><li>2 通用技巧</li></ul></div><p>正文在这里</p>'
  const text = htmlToText(html)
  assert.ok(text.includes('正文在这里'))
  assert.ok(!text.includes('BOSS列表'), text)
})
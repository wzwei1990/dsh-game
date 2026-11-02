/**
 * dsh-game 设置页（浏览器半边，手写客户端模块，免构建）。
 *
 * 形态照抄宿主自带的客户端包：
 *   window.__ModuleLoader__.load({ id, factory })
 *   factory(require) 里 `var module = { exports: {} }; var exports = module.exports`
 *   末尾 `exports.apply = apply; exports.inject = inject`
 * 少了这批样板会在浏览器里报 `ReferenceError: exports is not defined`。
 *
 * 挂在「设置 → 插件」页（settings.section 槽），读写配置走宿主已有的 settings Remote：
 *   describe() → 当前值 + revision
 *   update(ns, patch, revision) → 写入 profile 的 cordis.patch.yml 并热重载
 *
 * 只暴露"用户真的会调"的 7 个开关；registryFile / userAgent 属于排障项，不上 UI。
 */

const moduleLoader = typeof window === 'undefined' ? undefined : window.__ModuleLoader__

if (moduleLoader !== undefined && moduleLoader !== null) {
  moduleLoader.load({
    id: 'dsh-game',
    factory: (require) => {
      var module = { exports: {} }
      var exports = module.exports

      const react = require('react')

      const NS = 'dsh-game'

      /** 设置项（与 src/config.ts 的 Config 一一对应，只列必要项）。 */
      const FIELDS = [
        { section: '抓取' },
        {
          key: 'minIntervalMs',
          label: '同一站点请求间隔（毫秒）',
          kind: 'number',
          hint: 'BWIKI 限流很凶：连续几次请求就 567。不建议低于 3000，默认 6000。',
        },
        { key: 'timeoutMs', label: '单次请求超时（毫秒）', kind: 'number', hint: '默认 20000' },
        { key: 'maxRetries', label: '失败重试次数', kind: 'number', hint: '限流/网络错误时按指数退避重试，默认 2' },

        { section: '缓存' },
        {
          key: 'cacheTtlMinutes',
          label: '页面/搜索缓存有效期（分钟，0=不缓存）',
          kind: 'number',
          hint: '默认 1440（一天）。wiki 页面不会天天变，缓存能省很多请求。',
        },
        {
          key: 'reverifyDays',
          label: '多少天未校验就提示复验（0=不提示）',
          kind: 'number',
          hint: '默认 1：wiki 偶尔会改地址/改版，一天没校验就提醒一下，避免长期用死链。',
        },

        { section: '输出与日志' },
        {
          key: 'maxReplyChars',
          label: '单次返回最大字符数',
          kind: 'number',
          hint: '默认 6000，超出截断并标注。调小更省上下文，调大更完整。',
        },
        {
          key: 'logLevel',
          label: '日志级别',
          kind: 'select',
          options: [
            ['info', 'info：只记关键事件'],
            ['debug', 'debug：每次请求/命中都打（排障用）'],
            ['warn', 'warn：只记问题'],
          ],
        },
      ]

      const style = {
        wrap: { display: 'flex', flexDirection: 'column', gap: '12px', padding: '4px 2px', maxWidth: '720px' },
        hint: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        row: { display: 'flex', flexDirection: 'column', gap: '4px' },
        label: { fontSize: '13px', fontWeight: 600 },
        sub: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary, #666)', margin: 0 },
        input: {
          font: 'inherit', fontSize: '13px', padding: '7px 9px', borderRadius: '6px',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)',
          background: 'var(--dsw-alias-bg-l1, #fff)', color: 'inherit', width: '100%', boxSizing: 'border-box',
        },
        bar: { display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap', marginTop: '6px' },
        btn: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid var(--dsw-alias-border-l2, #d0d0d0)', background: 'transparent', color: 'inherit',
        },
        primary: {
          font: 'inherit', fontSize: '13px', padding: '7px 14px', borderRadius: '6px', cursor: 'pointer',
          border: '1px solid transparent', background: 'var(--dsw-alias-state-business-primary, #1677ff)', color: '#fff',
        },
        error: { color: 'var(--dsw-alias-state-error-primary, #d4380d)', fontSize: '12px', margin: 0, whiteSpace: 'pre-wrap' },
        ok: { color: 'var(--dsw-alias-state-success-primary, #389e0d)', fontSize: '12px', margin: 0 },
      }

      /** 解包 Remote 结果：{ ok, value } / { ok:false, error }。 */
      function unwrap(result) {
        if (result !== null && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'ok')) {
          if (result.ok !== true) {
            const code = result.error && result.error.code
            const message = result.error && result.error.message
            throw new Error((code ? code + ': ' : '') + (message || 'remote call failed'))
          }
          return result.value
        }
        return result
      }

      /** 取 settings Remote 门面（客户端服务名 `remote.settings`）。 */
      function remoteOf(ctx) {
        try {
          const viaNamespace = ctx.remote && ctx.remote.settings
          if (viaNamespace && typeof viaNamespace.describe === 'function') return { settings: viaNamespace }
          const viaService = typeof ctx.get === 'function' ? ctx.get('remote.settings') : undefined
          if (viaService && typeof viaService.describe === 'function') return { settings: viaService }
          return null
        } catch (error) {
          return null
        }
      }

      function renderField(field, value, onChange) {
        const id = NS + '-' + field.key
        let control
        if (field.kind === 'select') {
          control = react.createElement('select', {
            id, style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          }, field.options.map((pair) => react.createElement('option', { key: pair[0], value: pair[0] }, pair[1])))
        } else if (field.kind === 'number') {
          control = react.createElement('input', {
            id, type: 'number', style: style.input, value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value === '' ? undefined : Number(event.target.value)),
          })
        } else {
          control = react.createElement('input', {
            id, type: 'text', style: style.input, placeholder: field.placeholder,
            value: value == null ? '' : String(value),
            onChange: (event) => onChange(field.key, event.target.value),
          })
        }
        return react.createElement('div', { style: style.row, key: field.key },
          react.createElement('label', { style: style.label, htmlFor: id }, field.label),
          field.hint === undefined ? null : react.createElement('p', { style: style.sub }, field.hint),
          control)
      }

      function GameSettingsPage(props) {
        const ctx = props.ctx
        const [state, setState] = react.useState({ phase: 'loading' })
        const [draft, setDraft] = react.useState({})
        const [revision, setRevision] = react.useState(undefined)
        const [message, setMessage] = react.useState(undefined)

        const load = react.useCallback(async () => {
          const remote = remoteOf(ctx)
          if (remote === null) {
            setState({ phase: 'unsupported' })
            return
          }
          setState({ phase: 'loading' })
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            if (!Array.isArray(described && described.namespaces)) {
              throw new Error('describe 返回的形状不对：' + JSON.stringify(described).slice(0, 200))
            }
            const row = list.find((item) => item && item.ns === NS)
            if (row === undefined) {
              setState({ phase: 'missing' })
              return
            }
            setDraft(Object.assign({}, row.value || {}))
            setRevision(row.revision)
            setState({ phase: 'ready' })
          } catch (error) {
            setState({ phase: 'error', error: String(error && error.message ? error.message : error) })
          }
        }, [ctx])

        react.useEffect(() => { void load() }, [load])

        const save = async () => {
          const remote = remoteOf(ctx)
          if (remote === null) return
          setMessage(undefined)
          try {
            const described = unwrap(await remote.settings.describe())
            const list = described && Array.isArray(described.namespaces) ? described.namespaces : []
            const row = list.find((item) => item && item.ns === NS)
            const next = {}
            for (const field of FIELDS) {
              if (!Object.prototype.hasOwnProperty.call(draft, field.key)) continue
              const value = draft[field.key]
              if (value === undefined || value === '') continue
              next[field.key] = field.kind === 'number' ? Number(value) : value
            }
            await unwrap(await remote.settings.update(NS, next, row ? row.revision : revision))
            setMessage({ ok: true, text: '已保存（写入 profile 的 cordis.patch.yml，插件会热重载）' })
            await load()
          } catch (error) {
            setMessage({ ok: false, text: '保存失败：' + String(error && error.message ? error.message : error) })
          }
        }

        if (state.phase === 'loading') return react.createElement('p', { style: style.hint }, '读取配置中…')

        if (state.phase === 'unsupported') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '当前宿主没有暴露 settings Remote 域，无法在本页读写配置。可以手动在 profile 的 cordis.patch.yml 追加：'),
            react.createElement('pre', { style: style.hint },
              '- id: ' + NS + '\n  name: ' + NS + '\n  config:\n    minIntervalMs: 6000\n    cacheTtlMinutes: 1440\n    reverifyDays: 1'))
        }

        if (state.phase === 'missing') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.hint }, '宿主里没找到 dsh-game 的配置条目。确认插件已安装并启用，再点重试。'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        if (state.phase === 'error') {
          return react.createElement('div', { style: style.wrap },
            react.createElement('p', { style: style.error }, '读取配置失败：' + state.error),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重试'))
        }

        return react.createElement('div', { style: style.wrap },
          react.createElement('p', { style: style.hint },
            '游戏表路径与写入状态用 game_list 查看（它会打印真实路径）。' +
            (revision === undefined ? '' : ' 当前 revision：' + revision)),
          FIELDS.map((field) => {
            if (field.section !== undefined) {
              return react.createElement('div', {
                key: 'section:' + field.section,
                style: { marginTop: '18px', paddingTop: '10px', borderTop: '1px solid var(--dsw-alias-border-l1, #e5e5e5)' },
              },
                react.createElement('div', {
                  style: { fontWeight: 600, fontSize: '13px', color: 'var(--dsw-alias-label-secondary, #555)' },
                }, field.section))
            }
            return renderField(field, draft[field.key], (key, value) => {
              setDraft((previous) => {
                const nextDraft = Object.assign({}, previous)
                nextDraft[key] = value
                return nextDraft
              })
            })
          }),
          react.createElement('div', { style: style.bar },
            react.createElement('button', { style: style.primary, onClick: () => void save() }, '保存'),
            react.createElement('button', { style: style.btn, onClick: () => void load() }, '重新读取'),
            message === undefined ? null
              : react.createElement('p', { style: message.ok ? style.ok : style.error }, message.text)))
      }

      const inject = ['slots', 'remote', 'remote.settings']

      /** 注册成「设置」左侧菜单里的一个独立页面。 */
      function apply(ctx) {
        const Page = (props) => react.createElement(GameSettingsPage, Object.assign({}, props, { ctx: ctx }))
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section',
          id: 'game',
          order: 62,
          label: () => '游戏 Wiki',
        }, Page))
      }

      exports.apply = apply
      exports.inject = inject
      return module.exports
    },
  })
}

/**
 * dsh-allinstar — Client half.
 *
 * A tab beside "Installed" that lists every installed plugin with its GitHub
 * home and a star you can click, plus the same control on a detail page. All
 * network and credential work lives in the Host half; this file only reads
 * `/dsh-allinstar/*` and renders.
 */

window.__ModuleLoader__.load({
  id: 'dsh-allinstar',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const STYLE_ID = 'dsh-allinstar-style'

    const CSS = `
.ghs-root { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 24px; }
.ghs-head { display: flex; flex-direction: column; gap: 8px; }
.ghs-title { font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.ghs-intro { font-size: 13px; line-height: 1.5; color: var(--dsw-alias-label-secondary); margin: 0; }
.ghs-row { display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1); }
.ghs-row + .ghs-row { margin-top: 8px; }
.ghs-main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.ghs-name { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ghs-meta { font-size: 12px; color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ghs-repo { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.ghs-side { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
.ghs-star { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px;
  border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary);
  font-size: 12px; cursor: pointer; white-space: nowrap; }
.ghs-star:hover:not(:disabled) { background: var(--dsw-alias-bg-layer-1); border-color: var(--dsw-alias-border-l2); }
.ghs-star:disabled { opacity: 0.55; cursor: default; }
.ghs-star[data-on="true"] { border-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-brand-primary); }
.ghs-link { font-size: 12px; color: var(--dsw-alias-label-secondary); text-decoration: none; }
.ghs-link:hover { color: var(--dsw-alias-brand-primary); }
.ghs-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ghs-btn { height: 28px; padding: 0 12px; border-radius: 8px; font-size: 12px; cursor: pointer;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-primary); }
.ghs-btn:hover:not(:disabled) { border-color: var(--dsw-alias-border-l2); }
.ghs-btn.primary { background: var(--dsw-alias-button-primary-fill);
  color: var(--dsw-alias-label-primary-foreground); border-color: transparent; }
.ghs-btn:disabled { opacity: 0.5; cursor: default; }
.ghs-note { font-size: 12px; line-height: 1.5; padding: 8px 10px; border-radius: 8px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary); }
.ghs-note.warn { color: var(--dsw-alias-state-warn-primary); }
.ghs-note.error { color: var(--dsw-alias-state-error-primary); }
.ghs-token { display: flex; flex-direction: column; gap: 8px; padding: 12px;
  border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px;
  background: var(--dsw-alias-bg-layer-2); }
.ghs-input { height: 30px; padding: 0 10px; border-radius: 8px; font-size: 13px;
  border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary); font-family: ui-monospace, monospace; }
.ghs-label { font-size: 12px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.ghs-hint { font-size: 12px; line-height: 1.5; color: var(--dsw-alias-label-secondary); margin: 0; }
.ghs-badge { font-size: 11px; padding: 1px 6px; border-radius: 999px;
  border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); }
`

    /** Absolute path for one Host route under the app's own mount point. */
    function api(pathname) {
      const relative = pathname.replace(/^\/+/, '')
      if (typeof document === 'undefined') return `/${relative}`
      return new URL(relative, document.baseURI).pathname
    }

    async function readJson(response) {
      let body
      try {
        body = await response.json()
      } catch {
        throw new Error(`HTTP ${response.status}`)
      }
      if (!response.ok) throw new Error(body && body.error ? body.error : `HTTP ${response.status}`)
      return body
    }

    function post(pathname, payload, method) {
      return fetch(api(pathname), {
        method: method || 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      }).then(readJson)
    }

    const STAR_GLYPH = h(
      'svg',
      { viewBox: '0 0 24 24', width: 14, height: 14, 'aria-hidden': true, focusable: false },
      h('path', {
        fill: 'currentColor',
        d: 'M12 17.3l-6.2 3.7 1.6-7.1-5.4-4.7 7.2-.6L12 1.7l2.8 6.9 7.2.6-5.4 4.7 1.6 7.1z',
      })
    )

    /** Locally remembered "the public-star notice was acknowledged". */
    function useStarDialogText() {
      return {
        title: 'A star is public · star 是公开的',
        body: "Starring shows on your GitHub profile and in your followers' feeds, under your own account name. You can unstar at any time by clicking again. · 点星会出现在你的 GitHub 主页和关注者动态里，署名是你自己的账号；随时可以再点一次撤销。",
        accept: "Got it, don't ask again · 知道了，不再提示",
        cancel: 'Cancel · 取消',
      }
    }

    /**
     * One confirm step, only the first time; starring is public. The notice is
     * re-shown when the Host could not report that it was already seen, so it
     * appears once per fresh profile rather than once per click.
     */
    function useStarConfirm(dialogs) {
      const [acknowledged, setAcknowledged] = React.useState(false)
      const [ready, setReady] = React.useState(false)
      const [pending, setPending] = React.useState(null)

      React.useEffect(() => {
        let live = true
        fetch(api('/dsh-allinstar/state'), { cache: 'no-store' })
          .then(readJson)
          .then((body) => {
            if (!live) return
            setAcknowledged(body.firstStarNotice === true)
            setReady(true)
          })
          .catch(() => {
            if (live) setReady(true)
          })
        return () => {
          live = false
        }
      }, [])

      const ask = React.useCallback(
        (label, run) => {
          if (acknowledged) {
            run()
            return
          }
          setPending({ label, run })
        },
        [acknowledged]
      )

      const accept = React.useCallback(() => {
        const next = pending
        setPending(null)
        setAcknowledged(true)
        post('/dsh-allinstar/preferences', { firstStarNoticeAcknowledged: true }).catch(() => undefined)
        if (next) next.run()
      }, [pending])

      const cancel = React.useCallback(() => setPending(null), [])

      const dialog = pending
        ? h(
            'div',
            { className: 'ghs-token', role: 'group', 'aria-label': dialogs.title },
            h('div', { className: 'ghs-label' }, dialogs.title),
            h('p', { className: 'ghs-hint' }, dialogs.body),
            h(
              'div',
              { className: 'ghs-actions' },
              h('button', { className: 'ghs-btn primary', onClick: accept }, dialogs.accept),
              h('button', { className: 'ghs-btn', onClick: cancel }, dialogs.cancel)
            )
          )
        : null

      // Until the stored acknowledgement is known, hold clicks rather than
      // flash the notice at someone who already dismissed it.
      return [ask, dialog, ready && !acknowledged]
    }

    function useState() {
      const [data, setData] = React.useState(null)
      const [error, setError] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const load = React.useCallback(() => {
        setLoading(true)
        setError(null)
        fetch(api('/dsh-allinstar/state'), { cache: 'no-store' })
          .then(readJson)
          .then((body) => {
            setData(body)
            setLoading(false)
          })
          .catch((cause) => {
            setError(cause instanceof Error ? cause.message : String(cause))
            setLoading(false)
          })
      }, [])
      React.useEffect(() => {
        load()
      }, [load])
      return { data, error, loading, load, setData }
    }

    /** Per-row star toggle, shared by the tab and the detail button. */
    function useStarToggle(data, setData, load, confirm) {
      const [busy, setBusy] = React.useState({})
      const toggle = React.useCallback(
        (plugin) => {
          if (!plugin || !plugin.repo) return
          const target = plugin.starred === true ? false : true
          const run = () => {
            setBusy((current) => ({ ...current, [plugin.packageName]: true }))
            post('/dsh-allinstar/star', { packageName: plugin.packageName, starred: target })
              .then(() => {
                if (setData && data) {
                  setData({
                    ...data,
                    plugins: data.plugins.map((entry) =>
                      entry.packageName === plugin.packageName ? { ...entry, starred: target } : entry
                    ),
                  })
                }
                return load ? load() : undefined
              })
              .catch((cause) => {
                window.alert(cause instanceof Error ? cause.message : String(cause))
              })
              .finally(() => {
                setBusy((current) => {
                  const next = { ...current }
                  delete next[plugin.packageName]
                  return next
                })
              })
          }
          // Unstarring is reversible and private in effect; only starring needs
          // the heads-up, and only once.
          if (target === false) run()
          else confirm(plugin.title || plugin.packageName, run)
        },
        [data, setData, load, confirm]
      )
      return [toggle, busy]
    }

    function TokenPanel({ data, onSaved, onCleared }) {
      const [value, setValue] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [note, setNote] = React.useState(null)
      const save = () => {
        if (value.trim() === '') return
        setBusy(true)
        setNote(null)
        post('/dsh-allinstar/token', { token: value })
          .then(() => {
            setValue('')
            setNote({ kind: 'ok', text: 'Token saved. / 令牌已保存。' })
            if (onSaved) onSaved()
          })
          .catch((cause) => {
            setNote({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) })
          })
          .finally(() => setBusy(false))
      }
      const clear = () => {
        setBusy(true)
        setNote(null)
        post('/dsh-allinstar/token', {}, 'DELETE')
          .then(() => {
            setNote({ kind: 'ok', text: 'Token removed. / 令牌已移除。' })
            if (onCleared) onCleared()
          })
          .catch((cause) => setNote({ kind: 'error', text: cause instanceof Error ? cause.message : String(cause) }))
          .finally(() => setBusy(false))
      }
      return h(
        'div',
        { className: 'ghs-token' },
        h('div', { className: 'ghs-label' }, 'GitHub token / GitHub 访问令牌'),
        h(
          'p',
          { className: 'ghs-hint' },
          data && data.authenticated
            ? `Configured (source: ${data.tokenSource}). / 已配置（来源：${data.tokenSource}）。`
            : 'Required to star. Browsing works without one. / 点星需要它，不填也能浏览。'
        ),
        h(
          'div',
          { className: 'ghs-actions' },
          h('input', {
            className: 'ghs-input',
            type: 'password',
            value,
            placeholder: 'ghp_… or github_pat_…',
            spellCheck: false,
            autoComplete: 'off',
            onChange: (event) => setValue(event.target.value),
          }),
          h(
            'button',
            { className: 'ghs-btn primary', disabled: busy || value.trim() === '', onClick: save },
            'Save / 保存'
          ),
          data && data.authenticated
            ? h('button', { className: 'ghs-btn', disabled: busy, onClick: clear }, 'Remove / 移除')
            : null
        ),
        note ? h('p', { className: 'ghs-hint ' + (note.kind === 'error' ? 'error' : '') }, note.text) : null
      )
    }

    function Row({ plugin, onToggle, busy }) {
      const repo = plugin.repo || ''
      const starred = plugin.starred === true
      return h(
        'div',
        { className: 'ghs-row' },
        h(
          'div',
          { className: 'ghs-main' },
          h('div', { className: 'ghs-name' }, plugin.title || plugin.packageName),
          h(
            'div',
            { className: 'ghs-meta' },
            repo
              ? h('a', { className: 'ghs-link ghs-repo', href: plugin.repoUrl, target: '_blank', rel: 'noreferrer' }, repo)
              : '— no GitHub repository / 没有声明 GitHub 仓库'
          )
        ),
        h(
          'div',
          { className: 'ghs-side' },
          repo
            ? h(
                'button',
                {
                  className: 'ghs-star',
                  'data-on': starred ? 'true' : 'false',
                  title: starred ? 'Unstar / 取消星标' : 'Star / 点星',
                  disabled: busy === true,
                  onClick: () => onToggle(plugin),
                },
                STAR_GLYPH,
                starred ? 'Starred' : 'Star'
              )
            : null
        )
      )
    }

    function StarTab() {
      const { data, error, loading, load, setData } = useState()
      const dialogs = useStarDialogText()
      const [confirm, dialog] = useStarConfirm(dialogs)
      const [toggle, busy] = useStarToggle(data, setData, load, confirm)

      if (loading && !data) return h('div', { className: 'ghs-root' }, h('p', { className: 'ghs-hint' }, 'Loading… / 读取中…'))
      if (error && !data) {
        return h(
          'div',
          { className: 'ghs-root' },
          h('p', { className: 'ghs-note error' }, 'Could not read installed plugins: ' + error),
          h('button', { className: 'ghs-btn', onClick: load }, 'Retry / 重试')
        )
      }
      if (!data) return null

      const known = data.plugins.filter((plugin) => plugin.repo)
      const missing = data.plugins.filter((plugin) => !plugin.repo)
      const starredCount = known.filter((plugin) => plugin.starred === true).length

      return h(
        'div',
        { className: 'ghs-root' },
        h(
          'div',
          { className: 'ghs-head' },
          h(
            'div',
            { className: 'ghs-title' },
            'GitHub stars / GitHub 星标',
            h('span', { className: 'ghs-badge', style: { marginLeft: 8 } }, `${starredCount}/${known.length}`)
          ),
          h(
            'p',
            { className: 'ghs-intro' },
            'Every installed plugin that declares a GitHub home. A star is public: it shows on your GitHub profile and in your followers\' feeds. / 下面是你装过、在 GitHub 上有家的插件。star 是公开行为，会出现在你的主页和关注者动态里。'
          )
        ),
        dialog,
        data.authenticated
          ? null
          : h(
              'p',
              { className: 'ghs-note warn' },
              'No GitHub token yet — add one below to star things. / 还没有 GitHub 令牌，先在下面添加，才能点星。'
            ),
        h(
          'div',
          { className: 'ghs-actions' },
          h('button', { className: 'ghs-btn', onClick: load, disabled: loading }, 'Refresh / 刷新'),
          h(
            'button',
            {
              className: 'ghs-btn primary',
              disabled: !data.authenticated || known.length === 0 || known.every((p) => p.starred === true),
              onClick: () => {
                const targets = known.filter((plugin) => plugin.starred !== true)
                const run = () => {
                  let chain = Promise.resolve()
                  for (const plugin of targets) {
                    chain = chain.then(() =>
                      post('/dsh-allinstar/star', { packageName: plugin.packageName, starred: true }).catch(() => undefined)
                    )
                  }
                  chain.then(() => load())
                }
                confirm(`${targets.length} repositories / 个仓库`, run)
              },
            },
            `Star all / 全部点星`
          )
        ),
        h(
          'div',
          null,
          known.map((plugin) =>
            h(Row, { key: plugin.packageName, plugin, onToggle: toggle, busy: busy[plugin.packageName] === true })
          )
        ),
        missing.length > 0
          ? h(
              'div',
              null,
              h('p', { className: 'ghs-hint', style: { marginTop: 16 } }, 'No GitHub repository / 没有 GitHub 仓库'),
              missing.map((plugin) =>
                h(Row, { key: plugin.packageName, plugin, onToggle: toggle, busy: false })
              )
            )
          : null,
        h(TokenPanel, { data, onSaved: load, onCleared: load })
      )
    }

    /** The same control on a plugin's own page. */
    function DetailStar(props) {
      const subject = props && props.subject
      let packageName
      if (subject && typeof subject === 'object') {
        const pkg = subject.pkg
        if (pkg && typeof pkg === 'object' && typeof pkg.name === 'string') packageName = pkg.name
      }
      const dialogs = useStarDialogText()
      const [plugin, setPlugin] = React.useState(null)
      const [confirm, dialog] = useStarConfirm(dialogs)
      const [toggle, busy] = useStarToggle(null, null, null, confirm)

      React.useEffect(() => {
        if (!packageName) return undefined
        let live = true
        fetch(api('/dsh-allinstar/state'), { cache: 'no-store' })
          .then(readJson)
          .then((body) => {
            if (!live) return
            setPlugin((body.plugins || []).find((entry) => entry.packageName === packageName) || null)
          })
          .catch(() => undefined)
        return () => {
          live = false
        }
      }, [packageName])

      if (!plugin || !plugin.repo) return null
      const starred = plugin.starred === true
      return h(
        React.Fragment,
        null,
        dialog,
        h(
          'button',
          {
            className: 'ghs-star',
            'data-on': starred ? 'true' : 'false',
            disabled: busy[plugin.packageName] === true,
            title: plugin.repo,
            onClick: () => toggle(plugin),
          },
          STAR_GLYPH,
          starred ? 'Starred · 已 star' : 'Star · 点星'
        )
      )
    }

    function StyleOnce() {
      return h('style', { 'data-dsh-plugin': 'dsh-allinstar', dangerouslySetInnerHTML: { __html: CSS } })
    }

    function withStyle(Component) {
      return function Styled(props) {
        return h(React.Fragment, null, h(StyleOnce), h(Component, props))
      }
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        ctx.slots.inject('plugins.tab', () => {
          return ctx.slots.register(
            { name: 'plugins.tab', id: 'dsh-allinstar', order: 10, label: 'GitHub stars / 星标' },
            withStyle(StarTab)
          )
        })
        ctx.slots.inject('plugins.detail.actions', () => {
          return ctx.slots.register(
            { name: 'plugins.detail.actions', id: 'dsh-allinstar-action', order: 40 },
            withStyle(DetailStar)
          )
        })
      },
    }
  },
})

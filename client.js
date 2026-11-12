window.__ModuleLoader__.load({
  id: '@local/online-model-discovery',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']
    const INITIAL_LEVELS = ['off', 'low', 'medium', 'high']

    const S = {
      section: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        marginTop: '12px',
        paddingTop: '12px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      headerButton: {
        position: 'absolute',
        top: '-52px',
        right: '112px',
        zIndex: 2,
        height: '28px',
        padding: '0 10px',
        fontSize: '12px',
        lineHeight: '18px',
        borderRadius: 'var(--dsw-radius-sm, 6px)',
      },
      left: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 },
      title: { fontSize: '13px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)' },
      hint: { fontSize: '12px', lineHeight: '1.4', color: 'var(--dsw-alias-label-secondary)' },
      error: { fontSize: '12px', lineHeight: '1.4', color: 'var(--dsw-alias-state-error-primary)' },
      button: {
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '36px',
        font: 'inherit',
        fontSize: '14px',
        lineHeight: '22px',
        padding: '0 14px',
        borderRadius: 'var(--dsw-radius-md, 8px)',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      buttonDisabled: { opacity: '0.5', cursor: 'not-allowed' },
      overlay: {
        position: 'fixed',
        inset: 0,
        zIndex: 2147483000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(0,0,0,0.45)',
        padding: '24px',
      },
      modal: {
        display: 'flex',
        flexDirection: 'column',
        width: 'min(680px, 100%)',
        maxHeight: '80vh',
        borderRadius: '12px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        boxShadow: '0 24px 64px rgba(0,0,0,0.4)',
        overflow: 'hidden',
        fontFamily: 'inherit',
        fontSize: '14px',
        lineHeight: '1.5',
      },
      modalHead: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
        padding: '16px 18px',
        borderBottom: '1px solid var(--dsw-alias-border-l1)',
      },
      modalTitle: { fontSize: '16px', fontWeight: 600 },
      modalBody: { padding: '14px 18px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' },
      modalFoot: {
        display: 'flex',
        justifyContent: 'flex-end',
        gap: '8px',
        padding: '14px 18px',
        borderTop: '1px solid var(--dsw-alias-border-l1)',
      },
      modelGroup: { display: 'flex', flexDirection: 'column', gap: '6px', padding: '6px 0' },
      row: { display: 'flex', alignItems: 'center', gap: '10px', minHeight: '32px' },
      model: {
        flex: '1 1 auto',
        minWidth: 0,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        fontSize: '13px',
        fontFamily: 'var(--ds-font-family-code, ui-monospace, SFMono-Regular, Menlo, monospace)',
        color: 'var(--dsw-alias-label-primary)',
      },
      summary: { flex: '0 0 auto', fontSize: '13px', color: 'var(--dsw-alias-label-secondary)' },
      link: {
        font: 'inherit',
        fontSize: '13px',
        padding: 0,
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-brand-primary)',
        cursor: 'pointer',
      },
      switch: {
        position: 'relative',
        flex: 'none',
        width: '36px',
        height: '20px',
        borderRadius: '999px',
        border: 'none',
        padding: 0,
        cursor: 'pointer',
        background: 'var(--dsw-alias-state-idle-primary)',
      },
      switchOn: { background: 'var(--dsw-alias-brand-primary)' },
      knob: {
        position: 'absolute',
        top: '2px',
        left: '2px',
        width: '16px',
        height: '16px',
        borderRadius: '999px',
        background: '#fff',
        transition: 'left 120ms ease',
      },
      knobOn: { left: '18px' },
      editor: { display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '2px' },
      colHead: {
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 28px',
        gap: '8px',
        fontSize: '13px',
        color: 'var(--dsw-alias-label-secondary)',
      },
      grid: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr) 28px', gap: '8px', alignItems: 'center' },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        font: 'inherit',
        fontSize: '14px',
        padding: '8px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l1)',
        background: 'var(--dsw-alias-bg-layer-2)',
        color: 'var(--dsw-alias-label-primary)',
        outline: 'none',
      },
      icon: {
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '28px',
        height: '28px',
        padding: 0,
        border: 'none',
        borderRadius: '6px',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        fontSize: '15px',
        lineHeight: '1',
      },
      add: {
        alignSelf: 'flex-start',
        font: 'inherit',
        fontSize: '14px',
        padding: '2px 0',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        cursor: 'pointer',
      },
      notice: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginTop: '8px',
        padding: '8px 12px',
        borderRadius: '8px',
        fontSize: '13px',
        lineHeight: '1.4',
        background: 'color-mix(in srgb, var(--dsw-alias-state-warn-primary) 16%, transparent)',
        border: '1px solid color-mix(in srgb, var(--dsw-alias-state-warn-primary) 55%, transparent)',
        color: 'var(--dsw-alias-state-warn-primary)',
      },
    }

    const levelName = (level) => (level === 'off' ? 'Off' : `${level.charAt(0).toUpperCase()}${level.slice(1)}`)
    const refreshListeners = new Set()

    const effortsToEntries = (efforts) => {
      if (!efforts || typeof efforts !== 'object') return undefined
      return LEVELS.filter((level) => Object.hasOwn(efforts, level)).map((level) => [
        level,
        typeof efforts[level] === 'string' ? efforts[level] : '',
      ])
    }

    const entriesToEfforts = (entries) => {
      if (entries === undefined) return false
      const efforts = {}
      for (const [level, wire] of entries) {
        efforts[level] = level === 'off' ? null : wire.trim() === '' ? level : wire.trim()
      }
      return efforts
    }

    const sameEntries = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

    function Switch({ checked, label, disabled, onChange }) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          style: checked ? { ...S.switch, ...S.switchOn } : S.switch,
          onClick: () => onChange(!checked),
        },
        h('span', { style: checked ? { ...S.knob, ...S.knobOn } : S.knob }),
      )
    }

    function LevelEditor({ entries, disabled, onChange }) {
      const used = new Set(entries.map(([level]) => level))
      const addable = LEVELS.filter((level) => !used.has(level))
      return h(
        'div',
        { style: S.editor },
        entries.length > 0
          ? h('div', { style: S.colHead }, h('span', null, '档位'), h('span', null, 'API 参数值'), h('span'))
          : null,
        ...entries.map(([level, wire], index) =>
          h(
            'div',
            { key: `${level}-${String(index)}`, style: S.grid },
            h(
              'select',
              {
                style: S.input,
                value: level,
                disabled,
                'aria-label': `档位 ${String(index + 1)}`,
                onChange: (event) => {
                  const next = event.target.value
                  onChange(entries.map((entry, at) => (at === index ? [next, next === 'off' ? '' : next] : entry)))
                },
              },
              h('option', { value: level }, level),
              ...addable.map((choice) => h('option', { key: choice, value: choice }, choice)),
            ),
            h('input', {
              style: S.input,
              type: 'text',
              value: level === 'off' ? '' : wire,
              placeholder: level === 'off' ? '关闭思考' : level,
              disabled: disabled || level === 'off',
              'aria-label': `${levelName(level)} API 参数值`,
              onChange: (event) =>
                onChange(entries.map((entry, at) => (at === index ? [level, event.target.value] : entry))),
            }),
            h(
              'button',
              {
                type: 'button',
                style: S.icon,
                title: '删除档位',
                'aria-label': `删除档位 ${level}`,
                disabled,
                onClick: () => onChange(entries.filter((_entry, at) => at !== index)),
              },
              '×',
            ),
          ),
        ),
        h(
          'button',
          {
            type: 'button',
            style: S.add,
            disabled: disabled || addable.length === 0,
            onClick: () => onChange([...entries, [addable[0], addable[0]]]),
          },
          '+ 添加档位',
        ),
      )
    }

    function ProviderReasoning({ provider, configured, declared }) {
      const sectionRef = React.useRef(null)
      const buttonRef = React.useRef(null)
      const [rows, setRows] = React.useState(null)
      const [draft, setDraft] = React.useState(null)
      const [editing, setEditing] = React.useState(undefined)
      const [open, setOpen] = React.useState(false)
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState('')
      const [notice, setNotice] = React.useState(null)

      const load = React.useCallback(async () => {
        if (typeof provider !== 'string' || provider.length === 0) return
        try {
          const response = await fetch(
            `/online-model-discovery/reasoning?provider=${encodeURIComponent(provider)}`,
            { headers: { accept: 'application/json' } },
          )
          const payload = await response.json()
          if (!payload?.ok) throw new Error(payload?.message ?? '加载失败')
          setRows(payload.models)
          setDraft(new Map(payload.models.map((model) => [model.id, effortsToEntries(model.reasoningEfforts)])))
          setMessage('')
        } catch (error) {
          setMessage(`读取失败：${error instanceof Error ? error.message : String(error)}`)
        }
      }, [provider])

      React.useEffect(() => {
        load()
      }, [load])

      React.useEffect(() => {
        const timer = window.setInterval(() => {
          if (!open) load()
        }, 2000)
        return () => window.clearInterval(timer)
      }, [load, open])

      React.useEffect(() => {
        const listener = () => {
          if (!open) load()
        }
        refreshListeners.add(listener)
        return () => refreshListeners.delete(listener)
      }, [load, open])

      React.useEffect(() => {
        if (typeof provider !== 'string' || provider.length === 0) return undefined
        let alive = true
        const tick = async () => {
          try {
            const response = await fetch(
              `/online-model-discovery/status?provider=${encodeURIComponent(provider)}&ui=1`,
              { headers: { accept: 'application/json' } },
            )
            const payload = await response.json()
            if (!alive) return
            setNotice(Array.isArray(payload?.fallbacks) && payload.fallbacks.length > 0 ? payload.fallbacks[0] : null)
          } catch {
            /* best effort */
          }
        }
        tick()
        const timer = window.setInterval(tick, 1500)
        return () => {
          alive = false
          window.clearInterval(timer)
        }
      }, [provider])

      const dirty = React.useMemo(() => {
        if (rows === null || draft === null) return []
        return rows
          .filter((model) => !sameEntries(draft.get(model.id), effortsToEntries(model.reasoningEfforts)))
          .map((model) => model.id)
      }, [rows, draft])

      React.useLayoutEffect(() => {
        const align = () => {
          const section = sectionRef.current
          const button = buttonRef.current
          if (section === null || button === null) return
          const sectionRect = section.getBoundingClientRect()
          let card = section.parentElement
          let target
          let best = Number.POSITIVE_INFINITY
          for (let depth = 0; depth < 8 && card !== null; depth += 1, card = card.parentElement) {
            for (const candidate of card.querySelectorAll('button')) {
              if (candidate === button || section.contains(candidate)) continue
              if (candidate.closest('[role="dialog"]') !== null) continue
              const label = `${candidate.getAttribute('aria-label') ?? ''} ${candidate.textContent ?? ''}`
              if (!/编辑|Edit/.test(label)) continue
              const rect = candidate.getBoundingClientRect()
              const distance = Math.abs(rect.bottom - sectionRect.top)
              if (distance < best) {
                best = distance
                target = candidate
              }
            }
          }
          if (target === undefined) return
          const targetRect = target.getBoundingClientRect()
          const buttonRect = button.getBoundingClientRect()
          button.style.top = `${targetRect.bottom - sectionRect.top - buttonRect.height}px`
        }
        align()
        window.addEventListener('resize', align)
        const timer = window.setInterval(align, 1000)
        return () => {
          window.removeEventListener('resize', align)
          window.clearInterval(timer)
        }
      }, [rows])

      const save = async () => {
        if (rows === null || draft === null || dirty.length === 0) return
        setBusy(true)
        setMessage('')
        try {
          const updates = {}
          for (const id of dirty) updates[id] = entriesToEfforts(draft.get(id))
          const response = await fetch(
            `/online-model-discovery/reasoning?provider=${encodeURIComponent(provider)}`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ updates }),
            },
          )
          const payload = await response.json()
          if (!payload?.ok) throw new Error(payload?.message ?? '保存失败')
          setRows(payload.models)
          setDraft(new Map(payload.models.map((model) => [model.id, effortsToEntries(model.reasoningEfforts)])))
          setEditing(undefined)
          setMessage('已保存')
        } catch (error) {
          setMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`)
        } finally {
          setBusy(false)
        }
      }

      if (configured !== true || declared === true || typeof provider !== 'string' || provider.length === 0) return null

      const available = rows !== null && rows.length > 0
      const configuredCount = (rows ?? []).filter((model) => effortsToEntries(model.reasoningEfforts) !== undefined).length

      const modal = open
        ? h(
            'div',
            {
              style: S.overlay,
              role: 'presentation',
              onMouseDown: (event) => {
                if (event.target === event.currentTarget) {
                  setOpen(false)
                  setEditing(undefined)
                }
              },
            },
            h(
              'div',
              { style: S.modal, role: 'dialog', 'aria-modal': 'true', 'aria-label': '思考强度设置' },
              h(
                'div',
                { style: S.modalHead },
                h('span', { style: S.modalTitle }, '思考强度设置'),
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.icon,
                    'aria-label': '关闭',
                    onClick: () => {
                      setOpen(false)
                      setEditing(undefined)
                    },
                  },
                  '×',
                ),
              ),
              h(
                'div',
                { style: S.modalBody },
                ...rows.map((model) => {
                  const entries = draft?.get(model.id)
                  const active = editing === model.id
                  return h(
                    'div',
                    { key: model.id, style: S.modelGroup },
                    h(
                      'div',
                      { style: S.row },
                      h('span', { style: S.model, title: model.id }, model.id),
                      active
                        ? null
                        : h(
                            'span',
                            { style: S.summary },
                            entries === undefined
                              ? '未设置'
                              : entries.map(([level]) => levelName(level)).join(' / '),
                          ),
                      h(Switch, {
                        checked: entries !== undefined,
                        disabled: busy,
                        label: `${model.id} 思考强度`,
                        onChange: (on) =>
                          setDraft((current) => {
                            const next = new Map(current)
                            next.set(
                              model.id,
                              on ? INITIAL_LEVELS.map((level) => [level, level === 'off' ? '' : level]) : undefined,
                            )
                            return next
                          }),
                      }),
                      h(
                        'button',
                        {
                          type: 'button',
                          style: S.link,
                          onClick: () => {
                            if (active) {
                              setEditing(undefined)
                              return
                            }
                            setEditing(model.id)
                            setDraft((current) => {
                              const next = new Map(current)
                              if (!next.has(model.id) || next.get(model.id) === undefined) {
                                next.set(model.id, INITIAL_LEVELS.map((level) => [level, level === 'off' ? '' : level]))
                              }
                              return next
                            })
                            setMessage('')
                          },
                        },
                        active ? '收起' : '编辑',
                      ),
                    ),
                    active
                      ? h(LevelEditor, {
                          entries: draft?.get(model.id) ?? [],
                          disabled: busy,
                          onChange: (next) =>
                            setDraft((current) => {
                              const map = new Map(current)
                              map.set(model.id, next)
                              return map
                            }),
                        })
                      : null,
                  )
                }),
              ),
              h(
                'div',
                { style: S.modalFoot },
                h(
                  'button',
                  {
                    type: 'button',
                    style: S.button,
                    disabled: busy,
                    onClick: () => {
                      setDraft(new Map((rows ?? []).map((model) => [model.id, effortsToEntries(model.reasoningEfforts)])))
                      setEditing(undefined)
                      setOpen(false)
                      setMessage('')
                    },
                  },
                  '取消',
                ),
                h(
                  'button',
                  { type: 'button', style: S.button, disabled: busy || dirty.length === 0, onClick: save },
                  busy ? '保存中…' : '保存',
                ),
              ),
            ),
          )
        : null

      return h(
        React.Fragment,
        null,
        h(
          'div',
          { ref: sectionRef, style: S.section },
          h(
            'div',
            { style: S.left },
            h('span', { style: S.title }, '思考强度'),
            h(
              'span',
              { style: S.hint },
              rows === null ? '读取中…' : available ? `${String(configuredCount)}/${String(rows.length)} 已配置` : '尚未获取模型列表',
            ),
          ),
          h(
            'button',
            {
              ref: buttonRef,
              type: 'button',
              style: {
                ...S.button,
                ...S.headerButton,
                ...(available ? {} : S.buttonDisabled),
              },
              disabled: !available || busy,
              title: available ? undefined : '请先点“获取可用模型”并保存模型列表',
              onClick: () => {
                if (!available) return
                setOpen(true)
                setEditing(undefined)
                load()
              },
            },
            '设置思考强度',
          ),
        ),
        notice === null
          ? null
          : h(
              'div',
              { style: S.notice, role: 'status' },
              h('span', { 'aria-hidden': true }, '⚠'),
              h('span', null, '网络获取失败，已回退到 pi-ai 元数据获取'),
            ),
        message === ''
          ? null
          : h(
              'div',
              { style: message.startsWith('保存失败') || message.startsWith('读取失败') ? S.error : S.hint },
              message,
            ),
        modal,
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        const remote = ctx.get('remote')
        if (remote !== undefined && typeof remote.$on === 'function') {
          ctx.effect(() =>
            remote.$on('settings/document-updated', () => {
              for (const listener of refreshListeners) listener()
            }),
          )
        }
        for (const key of ['llm-pi-ai', 'include:llm-pi-ai', '@deepseek-ai/dsh-llm-pi-ai']) {
          ctx.slots.inject('settings.models.provider-card', () =>
            ctx.slots.register({ name: 'settings.models.provider-card', key }, ({ provider, configured }) =>
              h(ProviderReasoning, {
                provider: provider?.provider ?? provider?.id,
                configured,
                declared: provider?.declared === true,
              }),
            ),
          )
        }
      },
    }
  },
})

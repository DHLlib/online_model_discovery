/**
 * Online-first model discovery for every pi-ai provider in `llm-pi-ai`.
 *
 * The Models page asks `llm.discoverModels(...)`. pi-ai answers it from the
 * bundled catalog whenever the provider ships one, so newly released models
 * never show up. This plugin wraps that call: ask the provider endpoint first,
 * fall back to the original catalog answer on failure, and expose the last
 * fallback so the page can show a friendly notice.
 */

export const name = 'online-model-discovery'
export const inject = ['webServer', 'llm', 'connection']

const TARGET_NS = 'llm-pi-ai'
const TARGET_PKG = '@deepseek-ai/dsh-llm-pi-ai'
const CACHE_TTL_MS = 60_000
const NOTICE_TTL_MS = 8_000
const ANTHROPIC_VERSION = '2023-06-01'
const PROBE_ROUTE = '/online-model-discovery/probe'
const STATUS_ROUTE = '/online-model-discovery/status'
const REASONING_ROUTE = '/online-model-discovery/reasoning'
const PROVIDERS_ROUTE = '/online-model-discovery/providers'

const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']

const cache = new Map()
const detections = new Map()
const fallbacks = []
const lastSuccessAt = new Map()
let uiLastHitAt = 0
let uiInjected = -1

const isPlain = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

/** Raised when a provider cannot be asked online at all; never shown as a failure. */
class NotApplicable extends Error {}

function deepMerge(base, patch) {
  if (!isPlain(base) || !isPlain(patch)) return patch === undefined ? base : patch
  const out = { ...base }
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlain(value) && isPlain(base[key]) ? deepMerge(base[key], value) : value
  }
  return out
}

function targetRow(ctx) {
  const rows = ctx.get('configEditor')?.configuration?.() ?? []
  return (
    rows.find((candidate) => candidate?.entry?.name === TARGET_PKG) ??
    rows.find((candidate) => String(candidate?.entry?.id ?? '').endsWith('llm-pi-ai'))
  )
}

function providerConfig(ctx, provider) {
  const row = targetRow(ctx)
  if (row === undefined) return { provider }
  const effective = deepMerge(row.inherited ?? {}, row.override ?? {})
  return { provider, ...(effective?.providers?.[provider] ?? {}) }
}

function isTargetSettingsNamespace(ns) {
  return ns === TARGET_NS || ns === `include:${TARGET_NS}` || String(ns).endsWith(`:${TARGET_NS}`)
}

/** The adopt flow does not carry reasoningEfforts; preserve existing declarations. */
function preserveReasoningEfforts(ctx, ns, ops) {
  if (!isTargetSettingsNamespace(ns) || !Array.isArray(ops)) return ops
  return ops.map((op) => {
    if (op?.op !== 'set' || !Array.isArray(op.path) || op.path.length !== 3) return op
    if (op.path[0] !== 'providers' || op.path[2] !== 'models' || !Array.isArray(op.value)) return op
    const provider = op.path[1]
    const configured = providerConfig(ctx, provider).models
    const previous = new Map(
      (Array.isArray(configured) ? configured : [])
        .filter((model) => typeof model?.id === 'string')
        .map((model) => [model.id, model]),
    )
    const detected = detections.get(provider)?.models
    let changed = false
    const models = op.value.map((model) => {
      if (!isPlain(model) || typeof model.id !== 'string') return model
      const info = detected?.get(model.id)
      const next = { ...model }
      let touched = false
      if (next.reasoningEfforts === undefined) {
        const efforts = previous.get(model.id)?.reasoningEfforts ?? info?.efforts
        if (efforts !== undefined) {
          next.reasoningEfforts = efforts
          touched = true
        }
      }
      if (next.contextWindow === undefined && info?.contextWindow !== undefined) {
        next.contextWindow = info.contextWindow
        touched = true
      }
      if (next.maxTokens === undefined && info?.maxTokens !== undefined) {
        next.maxTokens = info.maxTokens
        touched = true
      }
      if (
        (next.input === undefined || (Array.isArray(next.input) && next.input.length === 0)) &&
        info?.inputModalities !== undefined
      ) {
        next.input = info.inputModalities
        touched = true
      }
      if (!touched) return model
      changed = true
      return next
    })
    return changed ? { ...op, value: models } : op
  })
}

function defaultBaseURL(ctx, provider) {
  try {
    const entries = ctx.llm.listConfigurableProviders()
    return entries.find((entry) => entry.provider === provider)?.defaultBaseURL
  } catch {
    return undefined
  }
}

function resolveKey(raw) {
  if (typeof raw === 'string') return raw
  if (raw === undefined || raw === null) return undefined
  const value = raw.value ?? raw.secret ?? raw.token
  return typeof value === 'string' ? value : undefined
}

function recordFallback(provider, reason) {
  fallbacks.push({ provider, at: Date.now(), reason })
  while (fallbacks.length > 20) fallbacks.shift()
}

function parseModels(body) {
  const list = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : []
  return list
    .map((entry) => (typeof entry === 'string' ? { id: entry } : entry))
    .filter((entry) => typeof entry?.id === 'string' && entry.id.length > 0)
}

const isLevel = (value) => THINKING_LEVELS.includes(String(value).toLowerCase())

function normalizeEfforts(candidate) {
  const efforts = {}
  if (Array.isArray(candidate)) {
    for (const level of candidate) {
      const normalized = String(level).toLowerCase()
      if (isLevel(normalized)) efforts[normalized] = normalized
    }
    return efforts
  }
  if (!isPlain(candidate)) return efforts
  for (const level of THINKING_LEVELS) {
    const wire = candidate[level]
    if (typeof wire === 'string' && wire.length > 0) efforts[level] = wire
    else if (wire === null && level === 'off') efforts[level] = null
  }
  return efforts
}

function firstNumber(...values) {
  for (const value of values) {
    const number = typeof value === 'string' ? Number(value) : value
    if (typeof number === 'number' && Number.isFinite(number) && number > 0) return number
  }
  return undefined
}

function detectModalities(entry) {
  const declared = entry?.input_modalities ?? entry?.architecture?.input_modalities
  if (Array.isArray(declared) && declared.length > 0) {
    const values = declared
      .map((value) => String(value).toLowerCase())
      .filter((value) => value === 'text' || value === 'image')
    if (values.length > 0) return [...new Set(values)]
  }
  if (entry?.supports_vision === true) return ['text', 'image']
  return undefined
}

/**
 * Read whatever metadata an OpenAI-compatible endpoint advertises. Only
 * explicit values are used; the adapter keeps its own catalog values when the
 * endpoint says nothing.
 */
function detectMetadata(entry) {
  const metadata = {
    contextWindow: firstNumber(
      entry?.context_length,
      entry?.contextWindow,
      entry?.context_window,
      entry?.max_context_length,
      entry?.top_provider?.context_length,
      entry?.limits?.context,
    ),
    maxTokens: firstNumber(
      entry?.max_output_tokens,
      entry?.max_tokens,
      entry?.maxTokens,
      entry?.top_provider?.max_completion_tokens,
      entry?.limits?.output,
    ),
    inputModalities: detectModalities(entry),
  }

  const sources = [
    entry?.reasoningEfforts,
    entry?.reasoning_efforts,
    entry?.reasoning?.efforts,
    entry?.capabilities?.reasoning?.efforts,
    entry?.thinking_levels,
    entry?.thinkingLevels,
  ]
  for (const source of sources) {
    const efforts = normalizeEfforts(source)
    if (Object.keys(efforts).length > 0) {
      return { ...metadata, efforts, declared: true, source: 'endpoint' }
    }
  }
  const parameters = entry?.supported_parameters
  const declared =
    (Array.isArray(parameters) &&
      parameters.some((name) => ['reasoning', 'reasoning_effort', 'thinking'].includes(String(name).toLowerCase()))) ||
    entry?.reasoning === true ||
    entry?.capabilities?.reasoning === true ||
    entry?.supports_reasoning === true
  if (declared) return { ...metadata, declared: true, source: 'endpoint' }
  return Object.values(metadata).some((value) => value !== undefined) ? metadata : undefined
}

function inferApi(provider, baseURL) {
  const haystack = `${provider} ${baseURL}`.toLowerCase()
  if (haystack.includes('anthropic') || haystack.includes('claude')) return 'anthropic-messages'
  return 'openai-completions'
}

async function endpointModels(ctx, provider, explicitKey) {
  const now = Date.now()
  const cached = cache.get(provider)
  if (cached !== undefined && now - cached.at < CACHE_TTL_MS) return cached.models

  const config = providerConfig(ctx, provider)
  const baseURL = (typeof config.baseURL === 'string' && config.baseURL.length > 0 ? config.baseURL : undefined)
    ?? defaultBaseURL(ctx, provider)
  if (baseURL === undefined) throw new NotApplicable('no base URL configured')

  const api = typeof config.api === 'string' ? config.api : inferApi(provider, baseURL)
  const credentialRef = config.apiKeyEnv
  const apiKey = explicitKey ?? (typeof credentialRef === 'string'
    ? resolveKey(await ctx.get('credentials')?.resolve?.(credentialRef))
    : undefined)

  const url = api === 'anthropic-messages' ? `${baseURL.replace(/\/+$/, '')}/v1/models` : `${baseURL.replace(/\/+$/, '')}/models`
  const headers = { accept: 'application/json' }
  if (apiKey !== undefined) {
    if (api === 'anthropic-messages') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = ANTHROPIC_VERSION
    } else {
      headers.authorization = `Bearer ${apiKey}`
    }
  }

  const response = await fetch(url, { headers, signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`endpoint answered ${response.status}`)
  const entries = parseModels(await response.json())
  if (entries.length === 0) throw new Error('endpoint returned no models')
  const detected = new Map()
  const models = entries.map((entry) => {
    const detection = detectMetadata(entry)
    if (detection !== undefined) detected.set(entry.id, detection)
    return {
      id: entry.id,
      name: entry.display_name ?? entry.name ?? entry.id,
      ...(detection?.contextWindow === undefined ? {} : { contextWindow: detection.contextWindow }),
      ...(detection?.maxTokens === undefined ? {} : { maxTokens: detection.maxTokens }),
      ...(detection?.inputModalities === undefined ? {} : { inputModalities: detection.inputModalities }),
    }
  })
  cache.set(provider, { at: now, models })
  detections.set(provider, { at: now, models: detected })
  return models
}

/** Catalog metadata wins for known ids; the endpoint fills the gaps. */
function mergeCatalog(network, catalog) {
  const meta = new Map((catalog ?? []).map((model) => [model.id, model]))
  return network.map((model) => {
    const known = meta.get(model.id)
    if (known === undefined) return model
    return {
      ...model,
      ...known,
      id: model.id,
      name: known.name ?? model.name,
      contextWindow: known.contextWindow ?? model.contextWindow,
      maxTokens: known.maxTokens ?? model.maxTokens,
      inputModalities: known.inputModalities ?? model.inputModalities,
    }
  })
}

function json(res, status, payload) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.end(JSON.stringify(payload))
}

/**
 * Apply DSH Connection's Host/Origin and browser-authentication checks to a
 * plain `webServer` route. `webServer.register` routes are outside the shared
 * connection handler, so without this any page open in the browser could call
 * them through loopback.
 */
function rejectUntrusted(ctx, req, res) {
  const connection = ctx.get('connection')
  if (connection === undefined || typeof connection.requestRejection !== 'function') return false
  const rejection = connection.requestRejection({ headers: req.headers })
  if (rejection === undefined) return false
  json(res, rejection, { ok: false, message: rejection === 401 ? 'unauthorized' : 'forbidden' })
  return true
}

async function readJsonBody(req) {
  const chunks = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 200_000) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? {} : JSON.parse(text)
}

function settingsNamespace(settings) {
  try {
    const rows = settings.describe?.() ?? []
    return rows.find((row) => String(row?.ns ?? '').endsWith(TARGET_NS))?.ns ?? TARGET_NS
  } catch {
    return TARGET_NS
  }
}

function reasoningRows(ctx, provider) {
  const models = providerConfig(ctx, provider).models
  const detected = detections.get(provider)?.models
  return (Array.isArray(models) ? models : []).map((model) => ({
    id: model.id,
    name: model.name ?? model.id,
    reasoningEfforts: model.reasoningEfforts ?? null,
    detected: detected?.get(model.id) ?? null,
  }))
}

export function apply(ctx) {
  const llm = ctx.llm
  const original = llm.discoverModels.bind(llm)

  llm.discoverModels = async (settingsNs, request, signal) => {
    const provider = request?.provider
    if (settingsNs !== TARGET_NS || typeof provider !== 'string' || provider.length === 0) {
      return original(settingsNs, request, signal)
    }
    try {
      const network = await endpointModels(ctx, provider, request.apiKey)
      let catalog = []
      try {
        catalog = await original(settingsNs, { provider }, signal)
      } catch {
        catalog = []
      }
      for (let index = fallbacks.length - 1; index >= 0; index -= 1) {
        if (fallbacks[index].provider === provider) fallbacks.splice(index, 1)
      }
      lastSuccessAt.set(provider, Date.now())
      return mergeCatalog(network, catalog)
    } catch (error) {
      if (!(error instanceof NotApplicable)) {
        const succeeded = lastSuccessAt.get(provider)
        // Only warn when this provider was reachable before this attempt: a page
        // opened while offline should fall back silently instead of flashing a banner.
        if (succeeded !== undefined && Date.now() - succeeded < 10 * 60_000) {
          recordFallback(provider, error instanceof Error ? error.message : String(error))
        }
      }
      return original(settingsNs, request, signal)
    }
  }

  ctx.effect(() => () => {
    llm.discoverModels = original
  })

  const originalResolveModelInfo = llm.resolveModelInfo.bind(llm)
  llm.resolveModelInfo = async (provider, model, signal) => {
    const info = await originalResolveModelInfo(provider, model, signal)
    const detection = detections.get(provider)?.models.get(model)
    if (detection === undefined) return info
    const patch = {}
    if (info.context === undefined && detection.contextWindow !== undefined) {
      patch.context = { contextWindow: detection.contextWindow }
    }
    if (info.defaultMaxTokens === undefined && detection.maxTokens !== undefined) {
      patch.defaultMaxTokens = detection.maxTokens
    }
    if ((info.inputModalities === undefined || info.inputModalities.length === 0) && detection.inputModalities !== undefined) {
      patch.inputModalities = detection.inputModalities
    }
    if (info.reasoning === undefined && detection.efforts !== undefined) {
      const efforts = THINKING_LEVELS.filter((level) => detection.efforts[level] !== undefined).map((level) => ({
        id: level,
        name: `${level.charAt(0).toUpperCase()}${level.slice(1)}`,
      }))
      if (efforts.length > 0) patch.reasoning = { efforts }
    }
    return Object.keys(patch).length === 0 ? info : { ...info, ...patch }
  }
  ctx.effect(() => () => {
    llm.resolveModelInfo = originalResolveModelInfo
  })

  const settings = ctx.get('settings')
  const originalMutate = settings?.mutate
  if (settings !== undefined && typeof originalMutate === 'function') {
    settings.mutate = async (ns, ops, expectedRevision) =>
      originalMutate.call(settings, ns, preserveReasoningEfforts(ctx, ns, ops), expectedRevision)
    ctx.effect(() => () => {
      settings.mutate = originalMutate
    })
  }

  ctx.effect(() => {
    const disposeProbe = ctx.webServer.register({
      kind: 'exact',
      path: PROBE_ROUTE,
      async handler(req, res) {
        if (rejectUntrusted(ctx, req, res)) return
        const url = new URL(req.url ?? PROBE_ROUTE, 'http://localhost')
        const provider = url.searchParams.get('provider') ?? 'kimi-coding'
        try {
          const models = await llm.discoverModels(TARGET_NS, { provider })
          json(res, 200, { ok: true, provider, models })
        } catch (error) {
          json(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    const disposeStatus = ctx.webServer.register({
      kind: 'exact',
      path: STATUS_ROUTE,
      async handler(req, res) {
        if (rejectUntrusted(ctx, req, res)) return
        const url = new URL(req.url ?? STATUS_ROUTE, 'http://localhost')
        if (url.searchParams.get('ui') === '1') uiLastHitAt = Date.now()
        if (url.searchParams.has('injected')) {
          const injected = Number(url.searchParams.get('injected'))
          if (Number.isFinite(injected)) uiInjected = injected
        }
        const provider = url.searchParams.get('provider')
        const notices = [...fallbacks]
          .reverse()
          .filter((entry) => provider === null || entry.provider === provider)
          .filter((entry) => Date.now() - entry.at <= NOTICE_TTL_MS)
          .map((entry) => ({ provider: entry.provider, at: entry.at, reason: entry.reason }))
        json(res, 200, { fallbacks: notices, uiLastHitAt, uiInjected })
      },
    })
    const disposeProviders = ctx.webServer.register({
      kind: 'exact',
      path: PROVIDERS_ROUTE,
      async handler(req, res) {
        if (rejectUntrusted(ctx, req, res)) return
        try {
          const providers = ctx.llm.listConfigurableProviders().map((entry) => ({
            provider: entry.provider,
            settingsNs: entry.settingsNs,
            displayName: entry.displayName,
            defaultBaseURL: entry.defaultBaseURL,
            declared: entry.declared,
            modelCount: (() => {
              const models = providerConfig(ctx, entry.provider).models
              return Array.isArray(models) ? models.length : 0
            })(),
          }))
          const modules = ctx.get('clientModules')
          const graph = modules?.graph?.()
          const id = '@local/online-model-discovery'
          const clientEntry = graph?.entries?.find((entry) => entry.id === id)
          const clientBatches = (graph?.batches ?? []).filter((batch) => batch.entries.includes(id))
          json(res, 200, {
            ok: true,
            providers,
            client: {
              graphRev: graph?.rev,
              release: graph?.release,
              modulePath: modules?.clientPath?.(id),
              entry: clientEntry ?? null,
              batches: clientBatches,
            },
          })
        } catch (error) {
          json(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    const disposeReasoning = ctx.webServer.register({
      kind: 'exact',
      path: REASONING_ROUTE,
      async handler(req, res) {
        if (rejectUntrusted(ctx, req, res)) return
        const url = new URL(req.url ?? REASONING_ROUTE, 'http://localhost')
        const provider = url.searchParams.get('provider')
        if (typeof provider !== 'string' || provider.length === 0) {
          json(res, 400, { ok: false, message: 'provider is required' })
          return
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          json(res, 200, { ok: true, provider, models: reasoningRows(ctx, provider) })
          return
        }
        if (req.method !== 'POST') {
          json(res, 405, { ok: false, message: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(req)
          const updates = isPlain(body?.updates) ? body.updates : {}
          const settings = ctx.get('settings')
          if (settings === undefined) throw new Error('settings service is unavailable')
          const current = providerConfig(ctx, provider).models
          if (!Array.isArray(current)) throw new Error(`provider "${provider}" has no configured models`)
          const next = current.map((model) => {
            if (!Object.hasOwn(updates, model.id)) return model
            const value = updates[model.id]
            if (value === null || value === false) {
              return { ...model, reasoningEfforts: false }
            }
            if (value === false) return { ...model, reasoningEfforts: false }
            if (!isPlain(value)) throw new Error(`reasoningEfforts for "${model.id}" must be an object, false, or null`)
            const efforts = normalizeEfforts(value)
            if (Object.keys(efforts).length === 0) throw new Error(`reasoningEfforts for "${model.id}" declares no level`)
            return { ...model, reasoningEfforts: efforts }
          })
          await settings.mutate(settingsNamespace(settings), [
            { op: 'set', path: ['providers', provider, 'models'], value: next },
          ])
          json(res, 200, { ok: true, provider, models: reasoningRows(ctx, provider) })
        } catch (error) {
          json(res, 500, { ok: false, message: error instanceof Error ? error.message : String(error) })
        }
      },
    })
    return () => {
      disposeProbe()
      disposeStatus()
      disposeProviders()
      disposeReasoning()
    }
  })
}

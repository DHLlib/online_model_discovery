/**
 * Online-first model discovery for every pi-ai provider in `llm-pi-ai`.
 *
 * The Models page asks `llm.discoverModels(...)`. pi-ai answers it from the
 * bundled catalog whenever the provider ships one, so newly released models
 * never show up. This plugin wraps that call: ask the provider endpoint first,
 * fall back to the original catalog answer on failure, and expose the last
 * fallback so the page can show a friendly notice.
 *
 * It also wraps `settings.mutate(...)`: a hand-declared model inherits the
 * pi-ai catalog's wire-compatibility switches only when the catalog knows its
 * id, so the plugin carries the provider-wide ones over. See `stampCompat`.
 */

import { appendFileSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'

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
const catalogs = new Map()
let catalogRoot
let lastCompatFailure = null
let settingsService

const DIAG_FILE = join(tmpdir(), 'online-model-discovery-diag.jsonl')

/** Append one diagnostic record; never throw, never block the host. */
function diag(stage, data = {}) {
  try {
    appendFileSync(DIAG_FILE, `${JSON.stringify({ at: new Date().toISOString(), stage, ...data })}\n`)
  } catch {
    // Diagnostics are best-effort.
  }
}
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

/**
 * The compat switches a profile may set, per wire protocol.
 *
 * `dsh-llm-pi-ai` refuses every name outside this list — a field pi-ai's
 * installed catalog sets for a named vendor is withheld from configuration —
 * so the plugin only ever writes these. Mirrors the `offer` dispositions of its
 * `COMPAT_GATES`; a DSH upgrade that narrows one is caught by the retry in the
 * `settings.mutate` wrapper instead of failing the user's save.
 */
const RESPONSES_COMPAT = [
  'supportsDeveloperRole',
  'supportsMaxOutputTokens',
  'supportsStrictMode',
  'supportsLongCacheRetention',
]
const OFFERED_COMPAT = new Map([
  [
    'openai-completions',
    new Set([
      'supportsStore',
      'supportsDeveloperRole',
      'supportsReasoningEffort',
      'supportsUsageInStreaming',
      'supportsFinishReason',
      'maxTokensField',
      'requiresToolResultName',
      'requiresAssistantAfterToolResult',
      'requiresThinkingAsText',
      'requiresReasoningContentOnAssistantMessages',
      'thinkingFormat',
      'chatTemplateKwargs',
      'chatTemplateArgs',
      'supportsThinkingTokenBudget',
      'thinkingTokenBudgetField',
      'vllmPriority',
      'supportsStrictMode',
      'cacheControlFormat',
      'supportsLongCacheRetention',
    ]),
  ],
  ['openai-responses', new Set(RESPONSES_COMPAT)],
  ['azure-openai-responses', new Set(RESPONSES_COMPAT)],
  ['openai-codex-responses', new Set(RESPONSES_COMPAT)],
  [
    'anthropic-messages',
    new Set([
      'supportsEagerToolInputStreaming',
      'supportsLongCacheRetention',
      'supportsCacheControlOnTools',
      'supportsTemperature',
      'forceAdaptiveThinking',
      'allowEmptySignature',
      'supportsStrictTools',
    ]),
  ],
  ['bedrock-converse-stream', new Set(['supportsStrictMode'])],
])

/**
 * Where pi-ai keeps its per-provider catalog data.
 *
 * The host process does not receive `DSH_INSTALL_DIR` (that variable is set for
 * tool subprocesses), so the install has to be found from the runtime itself:
 * an Electron host knows `process.resourcesPath`, and `process.execPath` covers
 * the same layout when `resourcesPath` is absent. The env override exists for
 * tests and unusual layouts.
 */
function catalogCandidates() {
  const candidates = []
  const explicit = process.env.ONLINE_MODEL_DISCOVERY_CATALOG_DIR
  if (typeof explicit === 'string' && explicit.length > 0) candidates.push(explicit)
  const resources = process.resourcesPath
  if (typeof resources === 'string' && resources.length > 0) {
    candidates.push(join(resources, 'app.asar', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'))
    candidates.push(join(resources, 'app', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'))
  }
  const install = process.env.DSH_INSTALL_DIR
  if (typeof install === 'string' && install.length > 0) {
    candidates.push(join(install, '..', '..', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'))
  }
  const executable = process.execPath
  if (typeof executable === 'string' && executable.length > 0) {
    candidates.push(join(dirname(executable), 'resources', 'app.asar', 'dsh', 'node_modules', '@earendil-works', 'pi-ai', 'dist', 'providers', 'data'))
  }
  return candidates
}

function catalogDirectory() {
  if (catalogRoot !== undefined) return catalogRoot
  catalogRoot = null
  for (const candidate of catalogCandidates()) {
    try {
      if (statSync(candidate).isDirectory()) {
        catalogRoot = candidate
        break
      }
    } catch {
      // Missing candidate: try the next one.
    }
  }
  diag('catalog-dir', { dir: catalogRoot, resources: process.resourcesPath ?? null })
  return catalogRoot
}

/**
 * One provider's installed catalog, grouped by wire protocol.
 *
 * `dsh-llm-pi-ai` merges this catalog under the configured models by id, so a
 * model id pi-ai ships already inherits everything here. The plugin reads it for
 * the ids it does *not* ship: those are the ones that fall through to pi-ai's
 * baseURL detection.
 */
function catalogFor(provider) {
  if (catalogs.has(provider)) return catalogs.get(provider)
  let entry
  const directory = catalogDirectory()
  if (directory !== null && /^[\w.-]+$/.test(provider)) {
    try {
      const raw = JSON.parse(readFileSync(join(directory, `${provider}.json`), 'utf8'))
      const byApi = new Map()
      for (const [api, models] of Object.entries(raw)) {
        if (!OFFERED_COMPAT.has(api) || !isPlain(models)) continue
        const list = Object.values(models).filter(isPlain)
        if (list.length > 0) byApi.set(api, list)
      }
      const apis = [...byApi.keys()]
      if (apis.length > 0) entry = { byApi, api: apis.length === 1 ? apis[0] : undefined }
    } catch {
      // No catalog for this provider, or a pi-ai layout this build cannot read.
    }
  }
  catalogs.set(provider, entry)
  return entry
}

function sameValue(left, right) {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) && Array.isArray(right)) return JSON.stringify(left) === JSON.stringify(right)
  if (isPlain(left) && isPlain(right)) return JSON.stringify(left) === JSON.stringify(right)
  return false
}

/** The switches every model on one protocol declares the same way. */
function consensusCompat(models, offered) {
  const agreed = {}
  for (const field of offered) {
    let value
    let unanimous = true
    for (const model of models) {
      const compat = isPlain(model.compat) ? model.compat : {}
      if (!Object.hasOwn(compat, field)) {
        unanimous = false
        break
      }
      if (value === undefined) value = compat[field]
      else if (!sameValue(value, compat[field])) {
        unanimous = false
        break
      }
    }
    if (unanimous && value !== undefined) agreed[field] = value
  }
  return agreed
}

/**
 * Give hand-declared models the switches their provider's catalog agrees on.
 *
 * pi-ai detects compat from the provider id and baseURL, and for an endpoint it
 * does not recognize it answers as though it were OpenAI itself — which is how
 * a hand-declared Kimi model ended up sending the system prompt as the
 * `developer` role and drawing a 400. What every model of that provider's wire
 * protocol declares stays true for an unknown model of the same endpoint, so it
 * is safe to carry over; anything the catalog's own models disagree about is a
 * model-family choice and is left to pi-ai.
 *
 * A route-level switch already wins for every model, so it is not repeated on
 * the entries; a switch the entry already states is the user's and is kept.
 */
function stampCompat(ctx, provider, models, routeOverride) {
  const catalog = catalogFor(provider)
  if (catalog === undefined) return models
  const route = routeOverride ?? providerConfig(ctx, provider)
  const api = typeof route.api === 'string' && route.api.length > 0 ? route.api : catalog.api
  if (api === undefined) return models
  const offered = OFFERED_COMPAT.get(api)
  const group = catalog.byApi.get(api)
  if (offered === undefined || group === undefined) return models
  const known = new Set(group.map((model) => model.id))
  const agreed = consensusCompat(group, offered)
  const routeCompat = isPlain(route.compat) ? route.compat : {}
  const fields = Object.keys(agreed).filter((field) => !Object.hasOwn(routeCompat, field))
  if (fields.length === 0) return models
  let changed = false
  const next = models.map((model) => {
    if (!isPlain(model) || typeof model.id !== 'string' || known.has(model.id)) return model
    const current = isPlain(model.compat) ? model.compat : {}
    const patch = {}
    for (const field of fields) {
      if (!Object.hasOwn(current, field)) patch[field] = agreed[field]
    }
    if (Object.keys(patch).length === 0) return model
    changed = true
    return { ...model, compat: { ...current, ...patch } }
  })
  return changed ? next : models
}

/** The adopt flow does not carry metadata; fill it from detection and catalog. */
function enrichModels(ctx, provider, value, route) {
  const configured = providerConfig(ctx, provider).models
  const previous = new Map(
    (Array.isArray(configured) ? configured : [])
      .filter((model) => typeof model?.id === 'string')
      .map((model) => [model.id, model]),
  )
  const detected = detections.get(provider)?.models
  const enriched = value.map((model) => {
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
    return next
  })
  const models = enriched.some((model, index) => model !== value[index]) ? enriched : value
  return stampCompat(ctx, provider, models, route)
}

/**
 * Enrich every write that replaces a provider's model list: both the models
 * write the Models page sends after a discovery and the whole-profile write the
 * provider card commits.
 */
function enrichModelWrites(ctx, ns, ops) {
  if (!isTargetSettingsNamespace(ns) || !Array.isArray(ops)) return ops
  let changed = false
  const next = ops.map((op) => {
    if (op?.op !== 'set' || !Array.isArray(op.path) || op.path[0] !== 'providers') return op
    const provider = op.path[1]
    if (typeof provider !== 'string' || provider.length === 0) return op
    if (op.path.length === 3 && op.path[2] === 'models' && Array.isArray(op.value)) {
      const models = enrichModels(ctx, provider, op.value)
      if (models === op.value) return op
      changed = true
      return { ...op, value: models }
    }
    if (op.path.length === 2 && isPlain(op.value) && Array.isArray(op.value.models)) {
      const models = enrichModels(ctx, provider, op.value.models, op.value)
      if (models === op.value.models) return op
      changed = true
      return { ...op, value: { ...op.value, models } }
    }
    return op
  })
  return changed ? next : ops
}

/**
 * Install the write hook and the one-shot backfill on the settings service.
 *
 * `scope` supplies the lifecycle (`ctx`, or an injected child context): both
 * are undone when the plugin is disposed, so a reload never leaves a wrapper
 * chained on the shared service.
 */
function attachSettingsHook(ctx, scope, settings, via) {
  diag('attach', {
    via,
    hasSettings: settings !== undefined,
    hasMutate: typeof settings?.mutate === 'function',
  })
  if (settings === undefined || settingsService === settings) return
  settingsService = settings
  const originalMutate = settings.mutate
  if (typeof originalMutate !== 'function') return
  settings.mutate = async (ns, ops, expectedRevision) => {
    const enriched = enrichModelWrites(ctx, ns, ops)
    if (enriched === ops) return originalMutate.call(settings, ns, ops, expectedRevision)
    try {
      return await originalMutate.call(settings, ns, enriched, expectedRevision)
    } catch (error) {
      // A switch this DSH build refuses must never cost the caller its write:
      // retry with the ops it sent, and remember why for diagnostics.
      lastCompatFailure = {
        at: Date.now(),
        message: error instanceof Error ? error.message : String(error),
      }
      return originalMutate.call(settings, ns, ops, expectedRevision)
    }
  }
  scope.effect(() => () => {
    settings.mutate = originalMutate
    if (settingsService === settings) settingsService = undefined
  })
  // Lists saved before this version carry no compat, and waiting for the user
  // to open the Models page again would leave the first request broken.
  scope.effect(() => {
    const timer = setTimeout(() => {
      void backfillModels(ctx, settings)
    }, 0)
    return () => clearTimeout(timer)
  })
}

/**
 * Backfill the model lists saved before this version carried compat.
 *
 * Reads the user layer only: a list the user never wrote has nothing to
 * enrich, and writing inherited values back into the profile would freeze the
 * catalog into it. Best-effort — a failed migration must never keep the host
 * from starting.
 */
/** The provider config declarations of this profile, or `undefined` while the
 * config tree has not been described yet. */
function configuredProviders(ctx) {
  const row = targetRow(ctx)
  if (row === undefined) return undefined
  const effective = deepMerge(row.inherited ?? {}, row.override ?? {})
  return isPlain(effective?.providers) ? effective.providers : {}
}

async function backfillModels(ctx, settings, attempt = 0) {
  const providers = configuredProviders(ctx)
  const entries = Object.entries(providers ?? {}).filter(
    ([, profile]) => isPlain(profile) && Array.isArray(profile.models) && profile.models.length > 0,
  )
  diag('backfill', {
    attempt,
    described: providers !== undefined,
    providers: Object.keys(providers ?? {}),
    entries: entries.map(([provider]) => provider),
  })
  let wrote = 0
  const ns = settingsNamespace(settings)
  for (const [provider, profile] of entries) {
    try {
      const models = enrichModels(ctx, provider, profile.models, profile)
      diag('backfill-provider', {
        provider,
        models: profile.models.length,
        changed: models !== profile.models,
        catalog: catalogDirectory(),
      })
      if (models === profile.models) continue
      await settings.mutate(ns, [{ op: 'set', path: ['providers', provider, 'models'], value: models }])
      wrote += 1
      diag('backfill-write', { provider, ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      diag('backfill-write', { provider, ok: false, message })
      lastCompatFailure = { at: Date.now(), message }
    }
  }
  // The config tree may still be settling when the service mounts: keep looking
  // for a while, then give up quietly so a profile with no configured models
  // does not poll forever.
  const waiting = providers === undefined || (entries.length === 0 && attempt < 10)
  if (wrote === 0 && waiting && attempt < 40) {
    const timer = setTimeout(() => {
      void backfillModels(ctx, settings, attempt + 1)
    }, 1_500)
    timer.unref?.()
  }
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
  diag('apply', {
    inject: typeof ctx.inject,
    hasSettings: ctx.get('settings') !== undefined,
    hasConfigEditor: ctx.get('configEditor') !== undefined,
    installDir: process.env.DSH_INSTALL_DIR ?? null,
  })
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

  // `settings` is mounted after this plugin applies, so wait for it instead of
  // reading the service once: `ctx.get('settings')` here would be undefined and
  // the write hook would silently never install. `dsh-llm-pi-ai` waits the same
  // way for the service it configures. A context without `inject` keeps the old
  // direct read so the plugin still loads.
  if (typeof ctx.inject === 'function') {
    ctx.inject(['settings'], (child) => {
      diag('inject-fired')
      attachSettingsHook(ctx, child, child.settings, 'inject')
    })
  } else {
    attachSettingsHook(ctx, ctx, ctx.get('settings'), 'direct')
  }

  // `inject` is the supported wait, but if this context never fires it the hook
  // must still install: poll the service for a minute as a fallback.
  ctx.effect(() => {
    let attempts = 0
    let stopped = false
    const look = () => {
      if (stopped || settingsService !== undefined) return
      const settings = ctx.get('settings')
      if (settings !== undefined) {
        attachSettingsHook(ctx, ctx, settings, 'poll')
        return
      }
      attempts += 1
      if (attempts < 60) {
        const next = setTimeout(look, 1_000)
        next.unref?.()
      } else {
        diag('poll-exhausted', { attempts })
      }
    }
    const timer = setTimeout(look, 1_000)
    timer.unref?.()
    return () => {
      stopped = true
      clearTimeout(timer)
    }
  })

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
            catalog: {
              readable: catalogDirectory() !== null,
              covered: providers.filter((entry) => catalogFor(entry.provider) !== undefined).length,
              lastCompatFailure,
            },
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
          const settings = settingsService ?? ctx.get('settings')
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

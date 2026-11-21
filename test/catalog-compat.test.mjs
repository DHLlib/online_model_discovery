import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

// The plugin reads pi-ai's per-provider catalog data from the install directory.
// A fixture keeps these tests independent of the machine and of Electron's asar.
const catalogDir = mkdtempSync(join(tmpdir(), 'online-model-discovery-'))
const kimiCompat = {
  supportsDeveloperRole: false,
  supportsStore: false,
  maxTokensField: 'max_tokens',
  supportsStrictMode: false,
  requiresReasoningContentOnAssistantMessages: true,
  thinkingFormat: 'openai',
}
writeFileSync(
  join(catalogDir, 'kimi-coding.json'),
  JSON.stringify({
    'openai-completions': {
      'chat:k3': { id: 'k3', api: 'openai-completions', compat: kimiCompat },
      'chat:k3-256k': { id: 'k3-256k', api: 'openai-completions', compat: kimiCompat },
      'chat:kimi-for-coding-highspeed': {
        id: 'kimi-for-coding-highspeed',
        api: 'openai-completions',
        compat: { ...kimiCompat, requiresReasoningContentOnAssistantMessages: undefined, thinkingFormat: 'deepseek' },
      },
    },
  }),
)
process.env.ONLINE_MODEL_DISCOVERY_CATALOG_DIR = catalogDir

const { apply } = await import('../index.js')

function makeCtx({ providers = {}, failFirst = false, userProviders = {}, legacy = false } = {}) {
  const calls = []
  const settings = {
    describe: () => [{ ns: 'llm-pi-ai', revision: 0, user: { providers: userProviders } }],
    mutate: async (ns, ops) => {
      calls.push({ ns, ops })
      if (failFirst && calls.length === 1) throw new Error('compat "bogus" is not configurable')
      return { kind: 'written' }
    },
  }
  const ctx = {
    llm: { discoverModels: async () => [], resolveModelInfo: async () => ({}), listConfigurableProviders: () => [] },
    get(name) {
      if (name === 'settings') return settings
      if (name === 'configEditor') {
        return {
          configuration: () => [
            { entry: { id: 'llm-pi-ai', name: '@deepseek-ai/dsh-llm-pi-ai' }, inherited: { providers }, override: {} },
          ],
        }
      }
      return undefined
    },
    effect(fn) {
      fn()
    },
    inject(deps, callback) {
      assert.deepEqual(deps, ['settings'])
      callback({ settings, effect: (fn) => fn(), get: (name) => ctx.get(name) })
    },
    webServer: { register: () => () => {} },
  }
  if (legacy) delete ctx.inject
  apply(ctx)
  return { settings, calls }
}

const modelsWrite = (provider, value) => [{ op: 'set', path: ['providers', provider, 'models'], value }]

test('a model the catalog does not describe inherits the provider-wide switches', async () => {
  const { settings, calls } = makeCtx()
  await settings.mutate(
    'llm-pi-ai',
    modelsWrite('kimi-coding', [{ id: 'k3.1-pro', name: 'K3.1 Pro' }]),
  )
  assert.deepEqual(calls[0].ops[0].value[0].compat, {
    supportsDeveloperRole: false,
    supportsStore: false,
    maxTokensField: 'max_tokens',
    supportsStrictMode: false,
  })
})

test('a model the catalog describes is left for dsh-llm-pi-ai to inherit', async () => {
  const { settings, calls } = makeCtx()
  await settings.mutate('llm-pi-ai', modelsWrite('kimi-coding', [{ id: 'k3', name: 'K3' }]))
  assert.equal(calls[0].ops[0].value[0].compat, undefined)
})

test('a route-level switch is not repeated on the entry', async () => {
  const { settings, calls } = makeCtx({ providers: { 'kimi-coding': { compat: { supportsDeveloperRole: true } } } })
  await settings.mutate('llm-pi-ai', modelsWrite('kimi-coding', [{ id: 'k3.1-pro', name: 'K3.1 Pro' }]))
  const compat = calls[0].ops[0].value[0].compat
  assert.equal(compat.supportsDeveloperRole, undefined)
  assert.equal(compat.maxTokensField, 'max_tokens')
})

test('an entry switch the user wrote wins', async () => {
  const { settings, calls } = makeCtx()
  await settings.mutate(
    'llm-pi-ai',
    modelsWrite('kimi-coding', [{ id: 'k3.1-pro', name: 'K3.1 Pro', compat: { supportsStrictMode: true } }]),
  )
  assert.equal(calls[0].ops[0].value[0].compat.supportsStrictMode, true)
})

test('a provider pi-ai does not catalogue is untouched', async () => {
  const { settings, calls } = makeCtx()
  const ops = modelsWrite('magpie', [{ id: 'kimi-code/k3.1-pro', name: 'K3.1 Pro' }])
  await settings.mutate('llm-pi-ai', ops)
  assert.equal(calls[0].ops, ops)
})

test('a refused switch costs the save nothing', async () => {
  const { settings, calls } = makeCtx({ failFirst: true })
  const ops = modelsWrite('kimi-coding', [{ id: 'k3.1-pro', name: 'K3.1 Pro' }])
  assert.deepEqual(await settings.mutate('llm-pi-ai', ops), { kind: 'written' })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].ops, ops)
})

test('a list saved before this version is backfilled on start', async () => {
  const models = [{ id: 'k3.1-pro', name: 'K3.1 Pro' }]
  const { calls } = makeCtx({
    providers: { 'kimi-coding': { models } },
    userProviders: { 'kimi-coding': { models } },
  })
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].ops[0].path, ['providers', 'kimi-coding', 'models'])
  assert.equal(calls[0].ops[0].value[0].compat.supportsDeveloperRole, false)
})

test('a context without inject still gets the write hook', async () => {
  const { settings, calls } = makeCtx({ legacy: true })
  await settings.mutate('llm-pi-ai', modelsWrite('kimi-coding', [{ id: 'k3.1-pro', name: 'K3.1 Pro' }]))
  assert.equal(calls[0].ops[0].value[0].compat.supportsDeveloperRole, false)
})

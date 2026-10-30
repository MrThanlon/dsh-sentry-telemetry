/**
 * Client half of dsh-sentry-telemetry.
 *
 * - Reads and edits `sentry-telemetry` settings live via `ctx.configForms`.
 * - Initializes `@sentry/browser` (`BrowserClient`) dynamically when DSN is configured.
 * - Resolves same-origin Source Map v3 (including DSH's Indexed Combo Source Maps) in-browser
 *   so every Error frame and Trace Span sent to Sentry carries original `.ts`/`.tsx` file paths,
 *   exact line numbers, and `pre_context`/`context_line`/`post_context` source code snippets.
 * - Captures React Slot/Factory crashes contained by `SlotErrorBoundary` (`ctx.slots.onEntryError`).
 * - Captures Client Cordis `ctx.logger.error` records and browser unhandled errors/rejections.
 * - Wraps `ctx.connection.rpc.call` to record `rpc.client` spans, propagate `sentry-trace` and
 *   `baggage` headers to Host `/api` endpoints, and report `gateway/internal` RPC errors.
 * - Registers the DSN configuration UI in `plugins.bundle.config` and `plugins.row.config`.
 */

import type { Context, LoggerLevel } from '@deepseek-ai/cordis'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  BrowserClient,
  breadcrumbsIntegration,
  browserApiErrorsIntegration,
  captureException,
  dedupeIntegration,
  defaultStackParser,
  functionToStringIntegration,
  getTraceData,
  globalHandlersIntegration,
  httpContextIntegration,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  makeFetchTransport,
  setCurrentClient,
  startSpan,
  withScope,
  type Event,
} from '@sentry/browser'
import {
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
  dsnFromString,
  type Span,
} from '@sentry/core'
import {
  applyResolvedToFrame,
  collectEventFrames,
  compileSourceMap,
  type CompiledSourceMap,
  type ResolvedOriginalPosition,
} from '../sourcemap.ts'
import {
  DEFAULT_SENTRY_CONFIG,
  ENTRY_ID,
  LOCALE_NS,
  PACKAGE_NAME,
  readConfigValues,
  type SentryConfigValues,
} from '../types.ts'
import { dicts } from './locales.ts'
import { SentrySettings, type SentrySettingsInjected } from './SentrySettings.tsx'

export const inject = ['slots', 'locale', 'configForms', 'connection']

function isValidDsn(dsn: string): boolean {
  if (!dsn) return false
  try {
    return dsnFromString(dsn) !== undefined
  } catch {
    return false
  }
}

function safe(step: () => void): void {
  try {
    step()
  } catch {
    // Never allow telemetry errors to disrupt Client rendering or RPC.
  }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string') {
    return new Error((value as { message: string }).message)
  }
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

/** Derive the `.map` endpoint URL for a DSH `/plugins/...` or Vite `/assets/...` script URL. */
function toSourceMapUrl(scriptUrl: string): string | undefined {
  try {
    const baseOrigin = typeof location !== 'undefined' ? location.origin : 'http://127.0.0.1'
    const parsed = new URL(scriptUrl, baseOrigin)
    if (typeof location !== 'undefined' && parsed.origin !== location.origin) return undefined
    if (!parsed.pathname.endsWith('.js')) return undefined
    parsed.pathname = `${parsed.pathname}.map`
    return parsed.href
  } catch {
    return undefined
  }
}

export function apply(ctx: Context): void {
  const { slots, locale, configForms } = ctx
  const connection = ctx.get('connection') as unknown as ConnectionHandle

  const formScope = configForms.get<SentryConfigValues>(ENTRY_ID)
  const rawFetch = globalThis.fetch.bind(globalThis)

  const sourceMapPromises = new Map<string, Promise<CompiledSourceMap | null>>()
  const sourceMapSyncCache = new Map<string, CompiledSourceMap | null>()

  const loadClientSourceMap = (scriptUrl: string): Promise<CompiledSourceMap | null> => {
    const mapUrl = toSourceMapUrl(scriptUrl)
    if (mapUrl === undefined) return Promise.resolve(null)
    const existing = sourceMapPromises.get(mapUrl)
    if (existing !== undefined) return existing
    const task = (async (): Promise<CompiledSourceMap | null> => {
      try {
        const res = await rawFetch(mapUrl)
        if (!res.ok) {
          sourceMapSyncCache.set(mapUrl, null)
          return null
        }
        const json: unknown = await res.json()
        const compiled = compileSourceMap(json) ?? null
        sourceMapSyncCache.set(mapUrl, compiled)
        return compiled
      } catch {
        sourceMapSyncCache.set(mapUrl, null)
        return null
      }
    })()
    sourceMapPromises.set(mapUrl, task)
    return task
  }

  /** Enrich all exception frames on a Client Sentry Event using same-origin `.map` files. */
  const enrichClientEvent = async (event: Event): Promise<Event> => {
    const frames = collectEventFrames(event)
    if (frames.length === 0) return event
    await Promise.all(
      frames.map(async (frame) => {
        if (!frame.filename || typeof frame.lineno !== 'number') return
        const map = await loadClientSourceMap(frame.filename)
        if (map === null) return
        const resolved = map.lookup(frame.lineno, frame.colno ?? 1)
        if (resolved !== undefined) {
          applyResolvedToFrame(frame, resolved)
        }
      }),
    )
    return event
  }

  /** Capture and resolve the caller's original TypeScript source position for a Trace Span. */
  const attachCallerSourceToSpan = async (span: Span, stack: string | undefined): Promise<void> => {
    if (!stack) return
    const parsedFrames = defaultStackParser(stack)
    const callerFrame = parsedFrames.find((f) => {
      const fn = f.function ?? ''
      const file = f.filename ?? ''
      if (!file || typeof f.lineno !== 'number') return false
      if (fn.includes('connection.rpc.call') || fn.includes('attachCallerSourceToSpan')) return false
      if (file.includes('@sentry')) return false
      return true
    }) ?? parsedFrames[0]

    if (!callerFrame?.filename || typeof callerFrame.lineno !== 'number') return

    const mapUrl = toSourceMapUrl(callerFrame.filename)
    let map = mapUrl !== undefined ? sourceMapSyncCache.get(mapUrl) : null
    if (map === undefined) {
      map = await loadClientSourceMap(callerFrame.filename)
    }
    const resolved: ResolvedOriginalPosition | undefined = map?.lookup(
      callerFrame.lineno,
      callerFrame.colno ?? 1,
    )
    if (resolved !== undefined) {
      span.setAttribute('code.filepath', resolved.source)
      span.setAttribute('code.lineno', resolved.line)
      span.setAttribute('code.column', resolved.column)
      if (resolved.name || callerFrame.function) {
        span.setAttribute('code.function', resolved.name ?? callerFrame.function!)
      }
      if (resolved.contextLine) {
        span.setAttribute('code.snippet', resolved.contextLine.trim())
      }
    } else {
      span.setAttribute('code.filepath', callerFrame.filename)
      span.setAttribute('code.lineno', callerFrame.lineno)
      if (callerFrame.function) span.setAttribute('code.function', callerFrame.function)
    }
  }

  let activeClient: BrowserClient | undefined
  let activeSignature = ''
  let currentSettings: SentryConfigValues = { ...DEFAULT_SENTRY_CONFIG }

  const isCollecting = (): boolean => activeClient !== undefined && currentSettings.enabled

  const syncBrowserClient = (): void => {
    safe(() => {
      const snapshot: ConfigFormSnapshot<SentryConfigValues> = formScope.getSnapshot()
      currentSettings = readConfigValues(snapshot.value)
      const effectiveDsn = currentSettings.clientDsn || currentSettings.dsn
      const enabled = currentSettings.enabled && isValidDsn(effectiveDsn)
      const nextSignature = enabled
        ? `${effectiveDsn}|${currentSettings.environment}|${String(currentSettings.tracesSampleRate)}`
        : ''

      if (nextSignature === activeSignature) return
      const previous = activeClient
      activeSignature = nextSignature
      activeClient = undefined

      if (previous !== undefined) {
        void Promise.resolve(previous.flush(1000)).catch(() => {})
      }

      if (!enabled) return

      const client = new BrowserClient({
        dsn: effectiveDsn,
        environment: currentSettings.environment,
        tracesSampleRate: currentSettings.tracesSampleRate,
        transport: makeFetchTransport,
        stackParser: defaultStackParser,
        integrations: [
          inboundFiltersIntegration(),
          functionToStringIntegration(),
          linkedErrorsIntegration(),
          dedupeIntegration(),
          breadcrumbsIntegration(),
          globalHandlersIntegration({ onerror: true, onunhandledrejection: true }),
          browserApiErrorsIntegration(),
          httpContextIntegration(),
        ],
      })
      client.addEventProcessor(event => enrichClientEvent(event))
      setCurrentClient(client)
      client.init()
      activeClient = client
    })
  }

  syncBrowserClient()
  ctx.effect(() => formScope.subscribe(syncBrowserClient), 'sentry: watch client config form')

  // 1. Register locale dictionaries for the settings UI.
  ctx.effect(() => locale.register(LOCALE_NS, dicts), 'sentry: register locale dictionaries')

  // 2. Capture React SlotErrorBoundary and FactoryErrorBoundary crashes via `ctx.slots.onEntryError`.
  ctx.effect(
    () =>
      slots.onEntryError((slotKey, registration, error, info) => {
        if (!isCollecting()) return
        safe(() => {
          withScope((scope) => {
            scope.setTag('dsh.side', 'client')
            scope.setTag('dsh.source', 'slots.onEntryError')
            scope.setTag('ui.slot', slotKey)
            scope.setTag('ui.registrant', registration.registrant ?? 'unknown')
            scope.setTag('ui.abdicated', String(info.abdicated))
            captureException(toError(error))
          })
        })
      }),
    'sentry: slot error boundary observer',
  )

  // 3. Capture Client Cordis logger.error records.
  ctx.logger.exporter({
    levels: { default: 0 as LoggerLevel.ERROR },
    export(message) {
      if (message.type !== 'error' || !isCollecting()) return
      if (message.name.includes('sentry')) return
      safe(() => {
        const errorArg = message.args.find((arg): arg is Error => arg instanceof Error)
        const error = errorArg ?? new Error(message.args.map(arg => (typeof arg === 'string' ? arg : String(arg))).join(' '))
        withScope((scope) => {
          scope.setTag('dsh.side', 'client')
          scope.setTag('dsh.source', 'cordis.client.logger')
          scope.setTag('cordis.logger', message.name)
          captureException(error)
        })
      })
    },
  })

  // 4. Propagate `sentry-trace` and `baggage` headers on same-origin `/api/` fetch requests
  //    and wrap `ctx.connection.rpc.call` to record `rpc.client` spans and capture RPC errors.
  ctx.effect(() => {
    const originalFetch = globalThis.fetch
    const originalRpcCall = connection.rpc.call.bind(connection.rpc)

    if (typeof originalFetch === 'function') {
      globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        if (isCollecting()) {
          const urlStr = typeof input === 'string' ? input : input instanceof URL ? input.pathname : input.url
          if (urlStr.startsWith('api/') || urlStr.startsWith('/api/')) {
            const traceHeaders = getTraceData()
            if (traceHeaders['sentry-trace'] || traceHeaders.baggage) {
              const headers = new Headers(init?.headers)
              if (traceHeaders['sentry-trace'] && !headers.has('sentry-trace')) {
                headers.set('sentry-trace', traceHeaders['sentry-trace'])
              }
              if (traceHeaders.baggage && !headers.has('baggage')) {
                headers.set('baggage', traceHeaders.baggage)
              }
              init = { ...init, headers }
            }
          }
        }
        return await originalFetch(input, init)
      }
    }

    connection.rpc.call = async (channel, endpoint, payload, signal) => {
      if (!isCollecting()) {
        return await originalRpcCall(channel, endpoint, payload, signal)
      }
      const callerStack = new Error().stack
      return await startSpan(
        {
          name: `rpc ${channel}/${endpoint}`,
          op: 'rpc.client',
          attributes: {
            'dsh.side': 'client',
            'rpc.system': 'typert',
            'rpc.channel': channel,
            'rpc.method': endpoint,
          },
        },
        async (span) => {
          await attachCallerSourceToSpan(span, callerStack).catch(() => {})
          try {
            const result = await originalRpcCall(channel, endpoint, payload, signal)
            if (!result.ok) {
              span.setAttribute('rpc.error_code', result.error.code)
              if (result.error.code === 'gateway/internal') {
                span.setStatus({ code: SPAN_STATUS_ERROR, message: result.error.message })
                if (currentSettings.captureRpcErrors) {
                  safe(() => {
                    withScope((scope) => {
                      scope.setTag('dsh.side', 'client')
                      scope.setTag('dsh.source', 'connection.rpc.call')
                      scope.setTag('rpc.endpoint', endpoint)
                      scope.setTag('rpc.code', result.error.code)
                      const err = new Error(`RPC ${endpoint} failed (${result.error.code}): ${result.error.message}`)
                      err.name = 'RemoteInternalError'
                      captureException(err)
                    })
                  })
                }
              } else {
                span.setStatus({ code: SPAN_STATUS_OK })
              }
            } else {
              span.setStatus({ code: SPAN_STATUS_OK })
            }
            return result
          } catch (error) {
            span.setStatus({ code: SPAN_STATUS_ERROR, message: toError(error).message })
            if (currentSettings.captureRpcErrors && !signal?.aborted) {
              safe(() => {
                withScope((scope) => {
                  scope.setTag('dsh.side', 'client')
                  scope.setTag('dsh.source', 'connection.rpc.transport')
                  scope.setTag('rpc.endpoint', endpoint)
                  captureException(toError(error))
                })
              })
            }
            throw error
          }
        },
      )
    }

    return () => {
      if (typeof originalFetch === 'function') {
        globalThis.fetch = originalFetch
      }
      connection.rpc.call = originalRpcCall
      const client = activeClient
      activeClient = undefined
      activeSignature = ''
      if (client !== undefined) {
        void Promise.resolve(client.flush(1000)).catch(() => {})
      }
    }
  }, 'sentry: client rpc and fetch instrumentation')

  // Helper to send a test error and distributed trace from the Settings UI.
  const sendTestTelemetry = (): void => {
    if (!isCollecting()) return
    safe(() => {
      const callerStack = new Error().stack
      void startSpan(
        {
          name: 'dsh.sentry.test_trace',
          op: 'dsh.test',
          attributes: {
            'dsh.side': 'client',
            'dsh.plugin': PACKAGE_NAME,
          },
        },
        async (span) => {
          await attachCallerSourceToSpan(span, callerStack).catch(() => {})
          withScope((scope) => {
            scope.setTag('dsh.side', 'client')
            scope.setTag('dsh.source', 'settings.test_button')
            const testErr = new Error(`Sentry test error from DeepSeek Harness (${PACKAGE_NAME})`)
            testErr.name = 'SentryTelemetryTestError'
            captureException(testErr)
          })
          // Also trigger a lightweight RPC call inside the active span so the Host continues the trace!
          await connection.rpc.call('/api', 'settings/describe', { args: {} }).catch(() => {})
        },
      )
    })
  }

  const injectSettingsProps = (): SentrySettingsInjected => ({
    hooks: {
      sentryConfig: formScope,
    },
    mutateConfig: (ops, revision) => formScope.mutate(ops, revision),
    sendTestTelemetry,
  })

  // 5. Register Settings UI on both the Bundle detail page and the Row configure page.
  slots.inject('plugins.bundle.config', () =>
    slots.register(
      {
        name: 'plugins.bundle.config',
        key: PACKAGE_NAME,
        locale: LOCALE_NS,
        inject: injectSettingsProps,
      },
      SentrySettings,
    ),
  )

  slots.inject('plugins.row.config', () =>
    slots.register(
      {
        name: 'plugins.row.config',
        key: `${PACKAGE_NAME}#${ENTRY_ID}`,
        locale: LOCALE_NS,
        inject: injectSettingsProps,
      },
      SentrySettings,
    ),
  )
}

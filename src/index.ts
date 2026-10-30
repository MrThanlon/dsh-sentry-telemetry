/**
 * Host half of dsh-sentry-telemetry.
 *
 * Captures Host-side errors across DSH's containment boundaries (Cordis logger,
 * Agent Loop, LLM streaming, Tool pipeline, Typert Gateway RPC, and fatal
 * process exits) and records distributed traces (HTTP/RPC -> Turn -> Step ->
 * LLM / Tool spans) into Sentry.
 */

import { AsyncLocalStorage } from 'node:async_hooks'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { hostname } from 'node:os'
import type { Context, LoggerLevel } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-loop'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-api-session-controller/types'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-settings'
import type {} from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import {
  Scope,
  ServerRuntimeClient,
  SPAN_STATUS_ERROR,
  SPAN_STATUS_OK,
  addBreadcrumb,
  captureException,
  captureMessage,
  continueTrace,
  createStackParser,
  createTransport,
  dedupeIntegration,
  dsnFromString,
  extraErrorDataIntegration,
  functionToStringIntegration,
  inboundFiltersIntegration,
  linkedErrorsIntegration,
  nodeStackLineParser,
  setAsyncContextStrategy,
  setCurrentClient,
  startInactiveSpan,
  startSpan,
  withActiveSpan,
  withScope,
  type BaseTransportOptions,
  type Span,
  type Transport,
} from '@sentry/core'
import {
  DEFAULT_SENTRY_CONFIG,
  readConfigValues,
  type ResolvedSentryConfig,
  type SentryConfigValues,
} from './types.ts'

/** Live editable configuration exposed to the Plugins page via SettingsForms. */
export const Config: z<Partial<SentryConfigValues>, ResolvedSentryConfig> = z.object({
  enabled: z.boolean().default(DEFAULT_SENTRY_CONFIG.enabled).volatile(),
  dsn: z.string().default(DEFAULT_SENTRY_CONFIG.dsn).volatile(),
  clientDsn: z.string().default(DEFAULT_SENTRY_CONFIG.clientDsn).volatile(),
  environment: z.string().default(DEFAULT_SENTRY_CONFIG.environment).volatile(),
  tracesSampleRate: z.number().min(0).max(1).default(DEFAULT_SENTRY_CONFIG.tracesSampleRate).volatile(),
  captureToolErrors: z.boolean().default(DEFAULT_SENTRY_CONFIG.captureToolErrors).volatile(),
  captureRpcErrors: z.boolean().default(DEFAULT_SENTRY_CONFIG.captureRpcErrors).volatile(),
})

interface AsyncStore {
  scope: Scope
  isolationScope: Scope
}

let asyncStrategyInstalled = false

/** Install Node AsyncLocalStorage strategy so concurrent sessions/requests isolate scopes and spans. */
function ensureNodeAsyncContextStrategy(): void {
  if (asyncStrategyInstalled) return
  asyncStrategyInstalled = true
  const storage = new AsyncLocalStorage<AsyncStore>()
  const defaultScope = new Scope()
  const defaultIsolationScope = new Scope()

  const getStore = (): AsyncStore =>
    storage.getStore() ?? {
      scope: defaultScope,
      isolationScope: defaultIsolationScope,
    }

  setAsyncContextStrategy({
    getCurrentScope: () => getStore().scope,
    getIsolationScope: () => getStore().isolationScope,
    withScope: <T>(callback: (scope: Scope) => T): T => {
      const current = getStore()
      const nextScope = current.scope.clone()
      return storage.run({ scope: nextScope, isolationScope: current.isolationScope }, () => callback(nextScope))
    },
    withSetScope: <T>(scope: Scope, callback: (scope: Scope) => T): T => {
      const current = getStore()
      return storage.run({ scope, isolationScope: current.isolationScope }, () => callback(scope))
    },
    withIsolationScope: <T>(callback: (isolationScope: Scope) => T): T => {
      const current = getStore()
      const nextIsolation = current.isolationScope.clone()
      const nextScope = current.scope.clone()
      return storage.run({ scope: nextScope, isolationScope: nextIsolation }, () => callback(nextIsolation))
    },
    withSetIsolationScope: <T>(isolationScope: Scope, callback: (isolationScope: Scope) => T): T => {
      const current = getStore()
      return storage.run({ scope: current.scope, isolationScope }, () => callback(isolationScope))
    },
  })
}

/** Create a Sentry transport using Node's global fetch (which honors DSH's HTTP proxy dispatcher). */
function makeNodeFetchTransport(options: BaseTransportOptions): Transport {
  return createTransport(options, async (request) => {
    const response = await globalThis.fetch(options.url, {
      method: 'POST',
      body: request.body as BodyInit,
    })
    return {
      statusCode: response.status,
      headers: {
        'x-sentry-rate-limits': response.headers.get('x-sentry-rate-limits'),
        'retry-after': response.headers.get('retry-after'),
      },
    }
  })
}

/** Validate whether a string is a parseable Sentry DSN. */
function isValidDsn(dsn: string): boolean {
  if (!dsn) return false
  try {
    return dsnFromString(dsn) !== undefined
  } catch {
    return false
  }
}

/** Never allow telemetry callbacks to throw into Cordis synchronous emit chains. */
function safe(step: () => void): void {
  try {
    step()
  } catch {
    // Telemetry must never disrupt Host operations.
  }
}

/** Normalize an unknown thrown value into an Error instance while preserving stack/cause. */
function toError(value: unknown): Error {
  if (value instanceof Error) return value
  if (typeof value === 'object' && value !== null && 'message' in value && typeof (value as { message: unknown }).message === 'string') {
    const err = new Error((value as { message: string }).message)
    if ('name' in value && typeof (value as { name: unknown }).name === 'string') {
      err.name = (value as { name: string }).name
    }
    return err
  }
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

export function apply(ctx: Context, rawConfig: ResolvedSentryConfig): void {
  ensureNodeAsyncContextStrategy()

  let activeClient: ServerRuntimeClient | undefined
  let activeSignature = ''
  let currentSettings: SentryConfigValues = readConfigValues(rawConfig)

  const turnSpans = new Map<string, Span>()
  const stepSpans = new Map<string, Span>()
  const latestStepSpanBySession = new Map<string, Span>()

  const isCollecting = (): boolean => activeClient !== undefined && currentSettings.enabled

  const syncClient = (): void => {
    safe(() => {
      currentSettings = readConfigValues(rawConfig)
      const dsn = currentSettings.dsn
      const enabled = currentSettings.enabled && isValidDsn(dsn)
      const nextSignature = enabled
        ? `${dsn}|${currentSettings.environment}|${String(currentSettings.tracesSampleRate)}`
        : ''

      if (nextSignature === activeSignature) return
      const previous = activeClient
      activeSignature = nextSignature
      activeClient = undefined

      if (previous !== undefined) {
        void Promise.resolve(previous.flush(1000)).catch(() => {})
      }

      if (!enabled) return

      const client = new ServerRuntimeClient({
        dsn,
        environment: currentSettings.environment,
        tracesSampleRate: currentSettings.tracesSampleRate,
        platform: 'node',
        serverName: hostname(),
        runtime: { name: 'node', version: process.versions.node },
        stackParser: createStackParser(nodeStackLineParser()),
        transport: makeNodeFetchTransport,
        integrations: [
          inboundFiltersIntegration(),
          functionToStringIntegration(),
          linkedErrorsIntegration(),
          dedupeIntegration(),
          extraErrorDataIntegration(),
        ],
      })
      setCurrentClient(client)
      client.init()
      activeClient = client
    })
  }

  syncClient()

  // Register with Settings so the entry's volatile Config is editable on the Plugins page.
  ctx.inject(['settings'], (child) => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })

  // Live update when DSN or options are edited in the Plugins UI.
  ctx.on('loader/volatile-update', () => {
    syncClient()
  })

  // 1. Capture Cordis logger.error across all Host plugins (fiber load/unload/effect/webserver failures).
  ctx.logger.exporter({
    levels: { default: 0 as LoggerLevel.ERROR },
    export(message) {
      if (message.type !== 'error' || !isCollecting()) return
      // Avoid feedback loops from our own logger namespace.
      if (message.name.includes('sentry')) return
      safe(() => {
        const errorArg = message.args.find((arg): arg is Error => arg instanceof Error)
        const error = errorArg ?? new Error(message.args.map(arg => (typeof arg === 'string' ? arg : String(arg))).join(' '))
        withScope((scope) => {
          scope.setTag('dsh.side', 'host')
          scope.setTag('dsh.source', 'cordis.logger')
          scope.setTag('cordis.logger', message.name)
          scope.setExtra('log.timestamp', message.ts)
          captureException(error)
        })
      })
    },
  })

  // 2. Capture Agent Loop errors swallowed by driver containment (`agent/error`).
  ctx.on('agent/error', ({ agent, turn, step, error }) => {
    if (!isCollecting()) return
    safe(() => {
      const sessionId = String(agent.session.id)
      const parentSpan = stepSpans.get(`${sessionId}:${String(turn)}:${String(step)}`)
        ?? turnSpans.get(`${sessionId}:${String(turn)}`)
      const record = (): void => {
        withScope((scope) => {
          scope.setTag('dsh.side', 'host')
          scope.setTag('dsh.source', 'agent/error')
          scope.setTag('session.id', sessionId)
          scope.setTag('agent.id', agent.id)
          scope.setExtra('turn', turn)
          scope.setExtra('step', step)
          captureException(toError(error))
        })
      }
      if (parentSpan !== undefined) withActiveSpan(parentSpan, record)
      else record()
    })
  })

  // Capture session/config-level Agent startup failures.
  ctx.on('api-session/error', (sessionId, message) => {
    if (!isCollecting()) return
    safe(() => {
      withScope((scope) => {
        scope.setTag('dsh.side', 'host')
        scope.setTag('dsh.source', 'api-session/error')
        scope.setTag('session.id', String(sessionId))
        captureMessage(`Session error: ${message}`, 'error')
      })
    })
  })

  ctx.on('agent-loop/config-start-failed', ({ sessionId, error }) => {
    if (!isCollecting()) return
    safe(() => {
      withScope((scope) => {
        scope.setTag('dsh.side', 'host')
        scope.setTag('dsh.source', 'agent-loop/config-start-failed')
        scope.setTag('session.id', String(sessionId))
        captureException(toError(error))
      })
    })
  })

  // 3. Observe transient model request errors before retry (`agent/request-error` waterfall).
  ctx.on('agent/request-error', (payload, next) => {
    if (isCollecting()) {
      safe(() => {
        addBreadcrumb({
          category: 'gen_ai.request',
          level: 'warning',
          message: `LLM request error (${payload.provider}): ${payload.failure.message}`,
          data: {
            provider: payload.provider,
            code: payload.failure.code,
            turn: payload.turn,
            step: payload.step,
          },
        })
      })
    }
    return next()
  })

  // 4. Hierarchical Agent Turn & Step spans from canonical Session events.
  ctx.on('session/event', (session, event) => {
    if (!isCollecting()) return
    safe(() => {
      const sessionId = String(session.id)
      const data = event.data as Record<string, unknown>
      switch (event.type) {
        case 'turn/start': {
          const turn = Number(data.turn ?? 0)
          const key = `${sessionId}:${String(turn)}`
          turnSpans.get(key)?.end()
          const span = startInactiveSpan({
            name: `agent.turn #${String(turn)}`,
            op: 'gen_ai.turn',
            forceTransaction: true,
            attributes: {
              'dsh.side': 'host',
              'session.id': sessionId,
              'turn.number': turn,
            },
          })
          turnSpans.set(key, span)
          break
        }
        case 'step/start': {
          const turn = Number(data.turn ?? 0)
          const step = Number(data.step ?? 0)
          const turnSpan = turnSpans.get(`${sessionId}:${String(turn)}`)
          const stepKey = `${sessionId}:${String(turn)}:${String(step)}`
          stepSpans.get(stepKey)?.end()
          const createStep = (): Span =>
            startInactiveSpan({
              name: `agent.step #${String(turn)}.${String(step)}`,
              op: 'gen_ai.step',
              attributes: {
                'dsh.side': 'host',
                'session.id': sessionId,
                'turn.number': turn,
                'step.number': step,
              },
            })
          const span = turnSpan !== undefined ? withActiveSpan(turnSpan, createStep) : createStep()
          stepSpans.set(stepKey, span)
          latestStepSpanBySession.set(sessionId, span)
          break
        }
        case 'assistant/message': {
          const turn = Number(data.turn ?? 0)
          const step = Number(data.step ?? 0)
          const stepSpan = stepSpans.get(`${sessionId}:${String(turn)}:${String(step)}`)
          const usage = data.usage as { inputTokens?: number; outputTokens?: number; totalTokens?: number } | undefined
          const messageObj = data.message as { source?: { provider?: string; model?: string } } | undefined
          const source = messageObj?.source
          if (stepSpan !== undefined) {
            if (source?.provider) stepSpan.setAttribute('gen_ai.system', source.provider)
            if (source?.model) stepSpan.setAttribute('gen_ai.response.model', source.model)
            if (typeof usage?.inputTokens === 'number') stepSpan.setAttribute('gen_ai.usage.input_tokens', usage.inputTokens)
            if (typeof usage?.outputTokens === 'number') stepSpan.setAttribute('gen_ai.usage.output_tokens', usage.outputTokens)
          }
          break
        }
        case 'step/end': {
          const turn = Number(data.turn ?? 0)
          const step = Number(data.step ?? 0)
          const stepKey = `${sessionId}:${String(turn)}:${String(step)}`
          const span = stepSpans.get(stepKey)
          if (span !== undefined) {
            stepSpans.delete(stepKey)
            if (latestStepSpanBySession.get(sessionId) === span) {
              latestStepSpanBySession.delete(sessionId)
            }
            span.setStatus({ code: SPAN_STATUS_OK })
            span.end()
          }
          break
        }
        case 'turn/end': {
          const turn = Number(data.turn ?? 0)
          const key = `${sessionId}:${String(turn)}`
          const span = turnSpans.get(key)
          if (span !== undefined) {
            turnSpans.delete(key)
            const reason = data.reason as { kind?: string; error?: { message?: string; code?: string } } | undefined
            if (reason?.kind === 'error') {
              span.setStatus({ code: SPAN_STATUS_ERROR, message: reason.error?.message ?? 'turn_error' })
            } else {
              span.setStatus({ code: SPAN_STATUS_OK })
            }
            span.end()
          }
          break
        }
        default:
          break
      }
    })
  })

  ctx.on('session/disposed', (session) => {
    safe(() => {
      const prefix = `${String(session.id)}:`
      latestStepSpanBySession.delete(String(session.id))
      for (const [key, span] of stepSpans) {
        if (key.startsWith(prefix)) {
          stepSpans.delete(key)
          span.end()
        }
      }
      for (const [key, span] of turnSpans) {
        if (key.startsWith(prefix)) {
          turnSpans.delete(key)
          span.end()
        }
      }
    })
  })

  // 5. LLM streaming call spans (`llm/stream` waterfall).
  ctx.on('llm/stream', (options, next) => {
    if (!isCollecting()) return next()
    const sessionId = options.sessionId !== undefined ? String(options.sessionId) : undefined
    const parentSpan = sessionId !== undefined ? latestStepSpanBySession.get(sessionId) : undefined
    const openLlmSpan = (): Span =>
      startInactiveSpan({
        name: `chat ${options.provider}/${options.model}`,
        op: 'gen_ai.chat',
        attributes: {
          'dsh.side': 'host',
          'gen_ai.system': options.provider,
          'gen_ai.request.model': options.model,
          ...(sessionId === undefined ? {} : { 'session.id': sessionId }),
        },
      })
    const span = parentSpan !== undefined ? withActiveSpan(parentSpan, openLlmSpan) : openLlmSpan()
    const downstream = next()

    return {
      [Symbol.asyncIterator]: async function* () {
        try {
          for await (const chunk of downstream) {
            yield chunk
          }
          span.setStatus({ code: SPAN_STATUS_OK })
        } catch (error) {
          span.setStatus({ code: SPAN_STATUS_ERROR, message: toError(error).message })
          throw error
        } finally {
          span.end()
        }
      },
    }
  })

  // 6. Tool execution spans & contained tool error capture (`tools/execute` waterfall).
  ctx.on('tools/execute', async (exec, next) => {
    if (!isCollecting()) return await next()
    const sessionId = exec.agent !== undefined ? String(exec.agent.session.id) : undefined
    const agentId = exec.agent?.id
    const parentSpan = sessionId !== undefined ? latestStepSpanBySession.get(sessionId) : undefined
    const runTool = async () =>
      await startSpan(
        {
          name: `tool ${exec.name}`,
          op: 'gen_ai.tool',
          attributes: {
            'dsh.side': 'host',
            'gen_ai.tool.name': exec.name,
            'gen_ai.tool.call_id': String(exec.callId),
            ...(sessionId === undefined ? {} : { 'session.id': sessionId }),
            ...(agentId === undefined ? {} : { 'agent.id': agentId }),
          },
        },
        async (span) => {
          try {
            const result = await next()
            if (result.isError) {
              const message = result.error?.message ?? 'tool_error'
              span.setStatus({ code: SPAN_STATUS_ERROR, message })
              if (currentSettings.captureToolErrors) {
                safe(() => {
                  withScope((scope) => {
                    scope.setTag('dsh.side', 'host')
                    scope.setTag('dsh.source', 'tools/execute')
                    scope.setTag('tool.name', exec.name)
                    if (sessionId !== undefined) scope.setTag('session.id', sessionId)
                    if (agentId !== undefined) scope.setTag('agent.id', agentId)
                    scope.setExtra('tool.call_id', exec.callId)
                    const err = new Error(`Tool "${exec.name}" failed: ${message}`)
                    err.name = 'ToolExecutionError'
                    captureException(err)
                  })
                })
              }
            } else {
              span.setStatus({ code: SPAN_STATUS_OK })
            }
            return result
          } catch (error) {
            span.setStatus({ code: SPAN_STATUS_ERROR, message: toError(error).message })
            throw error
          }
        },
      )
    return parentSpan !== undefined ? await withActiveSpan(parentSpan, runTool) : await runTool()
  })

  // 7. Distributed trace continuation from Client HTTP/RPC requests (`connection/request` waterfall).
  ctx.on('connection/request', async (request: IncomingMessage, response: ServerResponse, next: () => Promise<void>) => {
    if (!isCollecting()) return await next()
    const sentryTraceHeader = request.headers['sentry-trace']
    const baggageHeader = request.headers['baggage']
    const sentryTrace = Array.isArray(sentryTraceHeader) ? sentryTraceHeader[0] : sentryTraceHeader
    const baggage = Array.isArray(baggageHeader) ? baggageHeader.join(',') : baggageHeader
    const method = request.method ?? 'POST'
    const urlPath = (request.url ?? '/api').split('?')[0] ?? '/api'

    return await continueTrace({ sentryTrace, baggage }, async () =>
      await startSpan(
        {
          name: `${method} ${urlPath}`,
          op: 'http.server',
          forceTransaction: true,
          attributes: {
            'dsh.side': 'host',
            'http.request.method': method,
            'url.path': urlPath,
          },
        },
        async (span) => {
          try {
            await next()
            span.setAttribute('http.response.status_code', response.statusCode)
            if (response.statusCode >= 500) {
              span.setStatus({ code: SPAN_STATUS_ERROR, message: `HTTP ${String(response.statusCode)}` })
            } else {
              span.setStatus({ code: SPAN_STATUS_OK })
            }
          } catch (error) {
            span.setStatus({ code: SPAN_STATUS_ERROR, message: toError(error).message })
            safe(() => {
              withScope((scope) => {
                scope.setTag('dsh.side', 'host')
                scope.setTag('dsh.source', 'connection/request')
                scope.setTag('http.url', urlPath)
                captureException(toError(error))
              })
            })
            throw error
          }
        },
      ),
    )
  })

  // 8. Hook Typert Gateway to capture unexpected non-RemoteError throws before `invokeRpc` folds them into `gateway/internal`.
  ctx.inject(['typertGateway'], (gatewayCtx) => {
    gatewayCtx.effect(() => {
      const gateway: unknown = gatewayCtx.typertGateway
      if (typeof gateway !== 'object' || gateway === null) return () => {}
      const proto = Object.getPrototypeOf(gateway) as Record<string, unknown> | null
      const originalInvokePrepared = proto !== null && typeof proto.invokePrepared === 'function'
        ? (proto.invokePrepared as (this: unknown, prepared: { endpoint?: string }) => Promise<unknown>)
        : undefined
      if (!originalInvokePrepared || proto === null) return () => {}

      const wrappedInvokePrepared = async function (this: unknown, prepared: { endpoint?: string }): Promise<unknown> {
        try {
          return await originalInvokePrepared.call(this, prepared)
        } catch (error) {
          if (isCollecting() && currentSettings.captureRpcErrors) {
            safe(() => {
              // Business RemoteError instances carry a string `code` and `details` object;
              // capture unexpected internal Error throws with their full Host stack.
              const isExpectedRemoteError = typeof error === 'object'
                && error !== null
                && 'code' in error
                && 'details' in error
                && (error as { code?: unknown }).code !== 'gateway/internal'
              if (!isExpectedRemoteError) {
                withScope((scope) => {
                  scope.setTag('dsh.side', 'host')
                  scope.setTag('dsh.source', 'typertGateway.invoke')
                  if (prepared?.endpoint) scope.setTag('rpc.endpoint', prepared.endpoint)
                  captureException(toError(error))
                })
              }
            })
          }
          throw error
        }
      }

      proto.invokePrepared = wrappedInvokePrepared
      return () => {
        if (proto.invokePrepared === wrappedInvokePrepared) {
          proto.invokePrepared = originalInvokePrepared
        }
      }
    }, 'sentry: typertGateway error hook')
  })

  // 9. Process-level fatal uncaughtException / unhandledRejection listener + bounded flush on disposal.
  ctx.effect(() => {
    const onUncaughtException = (error: unknown): void => {
      if (!isCollecting()) return
      safe(() => {
        withScope((scope) => {
          scope.setTag('dsh.side', 'host')
          scope.setTag('dsh.source', 'process.uncaughtException')
          scope.setLevel('fatal')
          captureException(toError(error))
        })
      })
    }
    const onUnhandledRejection = (reason: unknown): void => {
      if (!isCollecting()) return
      safe(() => {
        withScope((scope) => {
          scope.setTag('dsh.side', 'host')
          scope.setTag('dsh.source', 'process.unhandledRejection')
          scope.setLevel('fatal')
          captureException(toError(reason))
        })
      })
    }

    process.prependListener('uncaughtException', onUncaughtException)
    process.prependListener('unhandledRejection', onUnhandledRejection)

    return async () => {
      process.off('uncaughtException', onUncaughtException)
      process.off('unhandledRejection', onUnhandledRejection)
      for (const span of stepSpans.values()) span.end()
      for (const span of turnSpans.values()) span.end()
      stepSpans.clear()
      turnSpans.clear()
      latestStepSpanBySession.clear()
      const client = activeClient
      activeClient = undefined
      activeSignature = ''
      if (client !== undefined) {
        // Fit within FAIL_LOUD_RELEASE_TIMEOUT_MS (2000ms).
        await Promise.resolve(client.flush(1500)).catch(() => {})
      }
    }
  }, 'sentry: host lifecycle and flush')
}

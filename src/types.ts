/**
 * Shared constants and configuration types for dsh-sentry-telemetry.
 */

import type { Volatile } from '@deepseek-ai/cordis'

export type { Volatile }

export const PACKAGE_NAME = 'dsh-sentry-telemetry' as const
export const ENTRY_ID = 'sentry-telemetry' as const
export const LOCALE_NS = 'sentryTelemetry' as const

/** Plain JSON configuration values stored in cordis.patch.yml and edited via Settings. */
export interface SentryConfigValues {
  /** Master switch for Sentry error and trace reporting on both Host and Client. */
  enabled: boolean
  /** Primary Sentry DSN (used by Host, and by Client when clientDsn is empty). */
  dsn: string
  /** Optional separate Sentry DSN for the browser Web Client. */
  clientDsn: string
  /** Deployment environment tag sent to Sentry (e.g. production, staging, development). */
  environment: string
  /** Trace sampling rate between 0 and 1. */
  tracesSampleRate: number
  /** Whether tool execution outcomes with `isError: true` are reported to Sentry. */
  captureToolErrors: boolean
  /** Whether internal RPC failures (`gateway/internal`) are reported to Sentry. */
  captureRpcErrors: boolean
}

export const DEFAULT_SENTRY_CONFIG: SentryConfigValues = {
  enabled: true,
  dsn: '',
  clientDsn: '',
  environment: 'production',
  tracesSampleRate: 1,
  captureToolErrors: true,
  captureRpcErrors: true,
}

/** Resolved Host Config object with Cordis Volatile<T> wrappers. */
export interface ResolvedSentryConfig {
  enabled: Volatile<boolean>
  dsn: Volatile<string>
  clientDsn: Volatile<string>
  environment: Volatile<string>
  tracesSampleRate: Volatile<number>
  captureToolErrors: Volatile<boolean>
  captureRpcErrors: Volatile<boolean>
}

export type AnySentryConfigInput =
  | Partial<ResolvedSentryConfig>
  | Partial<SentryConfigValues>
  | undefined

/** Read plain values from either a Volatile-wrapped or plain Config object. */
export function readConfigValues(config: AnySentryConfigInput): SentryConfigValues {
  const unwrap = <T>(val: T | Volatile<T> | undefined, fallback: T): T => {
    if (val === undefined || val === null) return fallback
    if (typeof val === 'object' && 'get' in val && typeof (val as Volatile<T>).get === 'function') {
      return (val as Volatile<T>).get() as T
    }
    return val as T
  }
  return {
    enabled: Boolean(unwrap<boolean>(config?.enabled as boolean | Volatile<boolean> | undefined, DEFAULT_SENTRY_CONFIG.enabled)),
    dsn: String(unwrap<string>(config?.dsn as string | Volatile<string> | undefined, DEFAULT_SENTRY_CONFIG.dsn) ?? '').trim(),
    clientDsn: String(unwrap<string>(config?.clientDsn as string | Volatile<string> | undefined, DEFAULT_SENTRY_CONFIG.clientDsn) ?? '').trim(),
    environment: String(unwrap<string>(config?.environment as string | Volatile<string> | undefined, DEFAULT_SENTRY_CONFIG.environment) || 'production').trim(),
    tracesSampleRate: clampSampleRate(unwrap<number>(config?.tracesSampleRate as number | Volatile<number> | undefined, DEFAULT_SENTRY_CONFIG.tracesSampleRate)),
    captureToolErrors: Boolean(unwrap<boolean>(config?.captureToolErrors as boolean | Volatile<boolean> | undefined, DEFAULT_SENTRY_CONFIG.captureToolErrors)),
    captureRpcErrors: Boolean(unwrap<boolean>(config?.captureRpcErrors as boolean | Volatile<boolean> | undefined, DEFAULT_SENTRY_CONFIG.captureRpcErrors)),
  }
}

export function clampSampleRate(value: unknown): number {
  const num = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(num)) return 1
  return Math.max(0, Math.min(1, num))
}

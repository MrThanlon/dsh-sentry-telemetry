/**
 * React settings component rendered on the Plugins detail page (`plugins.bundle.config`
 * and `plugins.row.config`) for dsh-sentry-telemetry.
 */

import { useEffect, useId, useState, type ReactNode } from 'react'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { dsnFromString } from '@sentry/core'
import { DEFAULT_SENTRY_CONFIG, type LOCALE_NS, type SentryConfigValues } from '../types.ts'
import type { SentryLocaleDict } from './locales.ts'

export type { ConfigForm, ConfigFormSnapshot }
export type SettingsPathOp = Parameters<ConfigForm<SentryConfigValues>['mutate']>[0][number]

export type SentrySettingsInjected = {
  hooks: {
    sentryConfig: HostObservable<ConfigFormSnapshot<SentryConfigValues>>
  }
  mutateConfig: ConfigForm<SentryConfigValues>['mutate']
  sendTestTelemetry: () => void
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    sentryTelemetry: keyof SentryLocaleDict
  }
}

export type SentrySettingsProps =
  PropsRuntime<'plugins.bundle.config'>
  & PropsLocale<typeof LOCALE_NS>
  & InjectFace<SentrySettingsInjected>

interface DraftState {
  enabled: boolean
  dsn: string
  clientDsn: string
  environment: string
  tracesSampleRate: string
  captureToolErrors: boolean
  captureRpcErrors: boolean
}

function isValidDsn(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  try {
    return dsnFromString(trimmed) !== undefined
  } catch {
    return false
  }
}

function toDraft(value: Partial<SentryConfigValues> | undefined): DraftState {
  const merged = { ...DEFAULT_SENTRY_CONFIG, ...value }
  return {
    enabled: Boolean(merged.enabled),
    dsn: String(merged.dsn ?? ''),
    clientDsn: String(merged.clientDsn ?? ''),
    environment: String(merged.environment ?? 'production'),
    tracesSampleRate: String(merged.tracesSampleRate ?? 1),
    captureToolErrors: Boolean(merged.captureToolErrors),
    captureRpcErrors: Boolean(merged.captureRpcErrors),
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

const SENTRY_SETTINGS_CSS = `
.dsh-sentry-form {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.dsh-sentry-status-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 12px;
  margin-bottom: 6px;
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-2);
  border: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-sentry-status-indicator {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsh-sentry-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  flex: none;
}
.dsh-sentry-dot[data-state="active"] {
  background: var(--dsw-alias-state-success-primary);
}
.dsh-sentry-dot[data-state="warn"] {
  background: var(--dsw-alias-state-warn-primary);
}
.dsh-sentry-dot[data-state="idle"] {
  background: var(--dsw-alias-state-idle-primary);
}
.dsh-sentry-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 0;
}
.dsh-sentry-field + .dsh-sentry-field {
  border-top: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-sentry-row-field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.dsh-sentry-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.dsh-sentry-label {
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-sentry-badges {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}
.dsh-sentry-tag {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1.4;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-secondary);
  border: 0.5px solid var(--dsw-alias-border-l1);
}
.dsh-sentry-reset {
  border: none;
  background: none;
  padding: 0;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.dsh-sentry-reset:hover:not(:disabled) {
  color: var(--dsw-alias-label-primary);
}
.dsh-sentry-reset:disabled {
  cursor: default;
  opacity: 0.5;
}
.dsh-sentry-input {
  height: 34px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  color: var(--dsw-alias-label-primary);
}
.dsh-sentry-input:focus-visible {
  outline: none;
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-sentry-input[aria-invalid="true"] {
  border-color: var(--dsw-alias-state-error-primary);
}
.dsh-sentry-input:disabled {
  color: var(--dsw-alias-label-secondary);
  cursor: default;
  opacity: 0.6;
}
.dsh-sentry-hint {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-label-secondary);
}
.dsh-sentry-invalid {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
.dsh-sentry-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  width: 36px;
  height: 20px;
  padding: 2px;
  border-radius: 999px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  background: var(--dsw-alias-bg-layer-2);
  cursor: pointer;
  flex: none;
  transition: background 120ms ease;
}
.dsh-sentry-switch[aria-checked="true"] {
  background: var(--dsw-alias-brand-primary);
  border-color: var(--dsw-alias-brand-primary);
}
.dsh-sentry-switch:disabled {
  opacity: 0.45;
  cursor: default;
}
.dsh-sentry-switch-thumb {
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--dsw-alias-label-primary);
  transform: translateX(0);
  transition: transform 120ms ease;
}
.dsh-sentry-switch[aria-checked="true"] .dsh-sentry-switch-thumb {
  background: var(--dsw-alias-bg-base);
  transform: translateX(16px);
}
.dsh-sentry-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  padding-top: 16px;
  flex-wrap: wrap;
}
.dsh-sentry-btn-primary {
  appearance: none;
  border: 1px solid transparent;
  border-radius: 6px;
  padding: 5px 14px;
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1.5;
  cursor: pointer;
  background: var(--dsw-alias-label-primary);
  color: var(--dsw-alias-bg-base);
}
.dsh-sentry-btn-primary:disabled {
  opacity: 0.4;
  cursor: default;
}
.dsh-sentry-btn-secondary {
  appearance: none;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  padding: 5px 12px;
  font: inherit;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dsh-sentry-btn-secondary:disabled {
  opacity: 0.4;
  cursor: default;
}
.dsh-sentry-feedback {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-success-primary);
}
.dsh-sentry-error {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--dsw-alias-state-error-primary);
}
`

export function SentrySettings(props: SentrySettingsProps): ReactNode {
  const { t, view = 'page', useSentryConfig, mutateConfig, sendTestTelemetry } = props
  const snapshot = useSentryConfig((s: ConfigFormSnapshot<SentryConfigValues>) => s)
  const idPrefix = useId()

  const committed = toDraft(snapshot.value)
  const baseValues = toDraft(isRecord(snapshot.base) ? (snapshot.base as Partial<SentryConfigValues>) : DEFAULT_SENTRY_CONFIG)
  const userLayer = isRecord(snapshot.user) ? snapshot.user : {}

  const [draft, setDraft] = useState<DraftState>(() => committed)
  const [dirtyFields, setDirtyFields] = useState<ReadonlySet<keyof DraftState>>(() => new Set())
  const [unsetFields, setUnsetFields] = useState<ReadonlySet<keyof DraftState>>(() => new Set())
  const [saving, setSaving] = useState(false)
  const [saveFailed, setSaveFailed] = useState(false)
  const [savedToast, setSavedToast] = useState(false)
  const [testNotice, setTestNotice] = useState(false)

  // Synchronize clean fields whenever the Host snapshot advances.
  useEffect(() => {
    if (dirtyFields.size === 0 && unsetFields.size === 0) {
      setDraft(toDraft(snapshot.value))
    }
  }, [snapshot.revision, snapshot.value, dirtyFields.size, unsetFields.size])

  if (view === 'summary') {
    return t('summary')
  }

  if (snapshot.status === 'unavailable') {
    return <p className="dsh-sentry-hint" role="status">{t('unavailable')}</p>
  }

  const editField = <K extends keyof DraftState>(key: K, value: DraftState[K]): void => {
    setDraft(prev => ({ ...prev, [key]: value }))
    setDirtyFields((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setUnsetFields((prev) => {
      if (!prev.has(key)) return prev
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setSaveFailed(false)
    setSavedToast(false)
  }

  const resetField = (key: keyof DraftState): void => {
    setDraft(prev => ({ ...prev, [key]: baseValues[key] }))
    setDirtyFields((prev) => {
      const next = new Set(prev)
      next.delete(key)
      return next
    })
    setUnsetFields((prev) => {
      const next = new Set(prev)
      next.add(key)
      return next
    })
    setSaveFailed(false)
    setSavedToast(false)
  }

  const isFieldOverridden = (key: keyof DraftState): boolean => {
    if (unsetFields.has(key)) return false
    if (dirtyFields.has(key)) return draft[key] !== baseValues[key]
    return Object.hasOwn(userLayer, key)
  }

  const dsnTrimmed = draft.dsn.trim()
  const clientDsnTrimmed = draft.clientDsn.trim()
  const dsnInvalid = dsnTrimmed !== '' && !isValidDsn(dsnTrimmed)
  const clientDsnInvalid = clientDsnTrimmed !== '' && !isValidDsn(clientDsnTrimmed)
  const parsedSampleRate = Number(draft.tracesSampleRate.trim())
  const sampleRateInvalid = draft.tracesSampleRate.trim() === ''
    || !Number.isFinite(parsedSampleRate)
    || parsedSampleRate < 0
    || parsedSampleRate > 1

  const invalid = dsnInvalid || clientDsnInvalid || sampleRateInvalid
  const hasChanges = dirtyFields.size > 0 || unsetFields.size > 0
  const disabled = !snapshot.writable || saving

  const committedDsnValid = isValidDsn(committed.dsn) || isValidDsn(committed.clientDsn)
  const statusState: 'active' | 'warn' | 'idle' = !committed.enabled
    ? 'idle'
    : committedDsnValid
      ? 'active'
      : 'warn'
  const statusLabel = !committed.enabled
    ? t('statusDisabled')
    : committedDsnValid
      ? t('statusActive')
      : t('statusNeedsDsn')

  const onSave = async (): Promise<void> => {
    if (disabled || !hasChanges || invalid) return
    setSaving(true)
    setSaveFailed(false)
    setSavedToast(false)
    const ops: SettingsPathOp[] = []
    for (const key of unsetFields) {
      ops.push({ op: 'unset', path: [key] })
    }
    for (const key of dirtyFields) {
      let value: string | number | boolean = draft[key]
      if (key === 'dsn' || key === 'clientDsn' || key === 'environment') {
        value = String(draft[key]).trim()
      } else if (key === 'tracesSampleRate') {
        value = Number(draft.tracesSampleRate.trim())
      }
      ops.push({ op: 'set', path: [key], value })
    }
    try {
      const ok = await mutateConfig(ops, snapshot.revision)
      if (ok) {
        setDirtyFields(new Set())
        setUnsetFields(new Set())
        setSavedToast(true)
      } else {
        setSaveFailed(true)
      }
    } catch {
      setSaveFailed(true)
    } finally {
      setSaving(false)
    }
  }

  const onTestClick = (): void => {
    sendTestTelemetry()
    setTestNotice(true)
    setTimeout(() => { setTestNotice(false) }, 4000)
  }

  return (
    <div className="dsh-sentry-form">
      <style>{SENTRY_SETTINGS_CSS}</style>
      {!snapshot.writable && snapshot.status === 'ready' ? (
        <p className="dsh-sentry-hint" role="status">{t('readOnly')}</p>
      ) : null}

      <div className="dsh-sentry-status-bar">
        <span className="dsh-sentry-status-indicator">
          <span className="dsh-sentry-dot" data-state={statusState} />
          <span>{statusLabel}</span>
        </span>
        <button
          type="button"
          className="dsh-sentry-btn-secondary"
          disabled={!committed.enabled || !committedDsnValid}
          onClick={onTestClick}
        >
          {t('testButton')}
        </button>
      </div>

      {/* Enable Switch */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-row-field">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-enabled`}>{t('enabledLabel')}</label>
          <button
            id={`${idPrefix}-enabled`}
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            className="dsh-sentry-switch"
            disabled={disabled}
            onClick={() => { editField('enabled', !draft.enabled) }}
          >
            <span className="dsh-sentry-switch-thumb" />
          </button>
        </div>
        <p className="dsh-sentry-hint">{t('enabledHint')}</p>
      </div>

      {/* Primary DSN */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-head">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-dsn`}>{t('dsnLabel')}</label>
          {isFieldOverridden('dsn') ? (
            <span className="dsh-sentry-badges">
              <span className="dsh-sentry-tag">{t('overridden')}</span>
              <button type="button" className="dsh-sentry-reset" disabled={disabled} onClick={() => { resetField('dsn') }}>
                {t('reset')}
              </button>
            </span>
          ) : null}
        </div>
        <input
          id={`${idPrefix}-dsn`}
          type="text"
          className="dsh-sentry-input"
          aria-invalid={dsnInvalid || undefined}
          placeholder={t('dsnPlaceholder')}
          value={draft.dsn}
          disabled={disabled}
          onChange={(e) => { editField('dsn', e.target.value) }}
        />
        <p className={dsnInvalid ? 'dsh-sentry-invalid' : 'dsh-sentry-hint'}>
          {dsnInvalid ? t('dsnInvalid') : t('dsnHint')}
        </p>
      </div>

      {/* Optional Client DSN */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-head">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-client-dsn`}>{t('clientDsnLabel')}</label>
          {isFieldOverridden('clientDsn') ? (
            <span className="dsh-sentry-badges">
              <span className="dsh-sentry-tag">{t('overridden')}</span>
              <button type="button" className="dsh-sentry-reset" disabled={disabled} onClick={() => { resetField('clientDsn') }}>
                {t('reset')}
              </button>
            </span>
          ) : null}
        </div>
        <input
          id={`${idPrefix}-client-dsn`}
          type="text"
          className="dsh-sentry-input"
          aria-invalid={clientDsnInvalid || undefined}
          placeholder={t('clientDsnPlaceholder')}
          value={draft.clientDsn}
          disabled={disabled}
          onChange={(e) => { editField('clientDsn', e.target.value) }}
        />
        <p className={clientDsnInvalid ? 'dsh-sentry-invalid' : 'dsh-sentry-hint'}>
          {clientDsnInvalid ? t('clientDsnInvalid') : t('clientDsnHint')}
        </p>
      </div>

      {/* Environment */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-head">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-environment`}>{t('environmentLabel')}</label>
          {isFieldOverridden('environment') ? (
            <span className="dsh-sentry-badges">
              <span className="dsh-sentry-tag">{t('overridden')}</span>
              <button type="button" className="dsh-sentry-reset" disabled={disabled} onClick={() => { resetField('environment') }}>
                {t('reset')}
              </button>
            </span>
          ) : null}
        </div>
        <input
          id={`${idPrefix}-environment`}
          type="text"
          className="dsh-sentry-input"
          placeholder={t('environmentPlaceholder')}
          value={draft.environment}
          disabled={disabled}
          onChange={(e) => { editField('environment', e.target.value) }}
        />
        <p className="dsh-sentry-hint">{t('environmentHint')}</p>
      </div>

      {/* Traces Sample Rate */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-head">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-sample-rate`}>{t('sampleRateLabel')}</label>
          {isFieldOverridden('tracesSampleRate') ? (
            <span className="dsh-sentry-badges">
              <span className="dsh-sentry-tag">{t('overridden')}</span>
              <button type="button" className="dsh-sentry-reset" disabled={disabled} onClick={() => { resetField('tracesSampleRate') }}>
                {t('reset')}
              </button>
            </span>
          ) : null}
        </div>
        <input
          id={`${idPrefix}-sample-rate`}
          type="text"
          inputMode="decimal"
          className="dsh-sentry-input"
          aria-invalid={sampleRateInvalid || undefined}
          value={draft.tracesSampleRate}
          disabled={disabled}
          onChange={(e) => { editField('tracesSampleRate', e.target.value) }}
        />
        <p className={sampleRateInvalid ? 'dsh-sentry-invalid' : 'dsh-sentry-hint'}>
          {sampleRateInvalid ? t('sampleRateInvalid') : t('sampleRateHint')}
        </p>
      </div>

      {/* Capture Tool Errors */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-row-field">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-tool-errors`}>{t('captureToolErrorsLabel')}</label>
          <button
            id={`${idPrefix}-tool-errors`}
            type="button"
            role="switch"
            aria-checked={draft.captureToolErrors}
            className="dsh-sentry-switch"
            disabled={disabled}
            onClick={() => { editField('captureToolErrors', !draft.captureToolErrors) }}
          >
            <span className="dsh-sentry-switch-thumb" />
          </button>
        </div>
        <p className="dsh-sentry-hint">{t('captureToolErrorsHint')}</p>
      </div>

      {/* Capture Internal RPC Errors */}
      <div className="dsh-sentry-field">
        <div className="dsh-sentry-row-field">
          <label className="dsh-sentry-label" htmlFor={`${idPrefix}-rpc-errors`}>{t('captureRpcErrorsLabel')}</label>
          <button
            id={`${idPrefix}-rpc-errors`}
            type="button"
            role="switch"
            aria-checked={draft.captureRpcErrors}
            className="dsh-sentry-switch"
            disabled={disabled}
            onClick={() => { editField('captureRpcErrors', !draft.captureRpcErrors) }}
          >
            <span className="dsh-sentry-switch-thumb" />
          </button>
        </div>
        <p className="dsh-sentry-hint">{t('captureRpcErrorsHint')}</p>
      </div>

      <div className="dsh-sentry-footer">
        <button
          type="button"
          className="dsh-sentry-btn-primary"
          disabled={disabled || !hasChanges || invalid}
          onClick={() => { void onSave() }}
        >
          {saving ? t('saving') : t('save')}
        </button>
        {savedToast ? <p className="dsh-sentry-feedback" role="status">{t('savedNotice')}</p> : null}
        {saveFailed ? <p className="dsh-sentry-error" role="status">{t('saveFailed')}</p> : null}
        {testNotice ? <p className="dsh-sentry-feedback" role="status">{t('testSent')}</p> : null}
      </div>
    </div>
  )
}

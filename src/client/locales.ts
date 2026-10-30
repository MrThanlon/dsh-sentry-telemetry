/**
 * Client locale dictionaries for @local/dsh-sentry-telemetry settings UI.
 */

export interface SentryLocaleDict {
  summary: string
  statusActive: string
  statusNeedsDsn: string
  statusDisabled: string
  unavailable: string
  readOnly: string
  enabledLabel: string
  enabledHint: string
  dsnLabel: string
  dsnHint: string
  dsnPlaceholder: string
  dsnInvalid: string
  clientDsnLabel: string
  clientDsnHint: string
  clientDsnPlaceholder: string
  clientDsnInvalid: string
  environmentLabel: string
  environmentHint: string
  environmentPlaceholder: string
  sampleRateLabel: string
  sampleRateHint: string
  sampleRateInvalid: string
  captureToolErrorsLabel: string
  captureToolErrorsHint: string
  captureRpcErrorsLabel: string
  captureRpcErrorsHint: string
  overridden: string
  reset: string
  save: string
  saving: string
  savedNotice: string
  saveFailed: string
  testButton: string
  testSent: string
}

export const zh: SentryLocaleDict = {
  summary: '收集 Host 与 Web Client 错误及全链路 Trace 并上报至 Sentry。',
  statusActive: '遥测已激活（Host + Client）',
  statusNeedsDsn: '等待配置有效的 Sentry DSN',
  statusDisabled: '遥测已暂停',
  unavailable: '当前环境未加载配置服务，无法在线编辑配置。',
  readOnly: '当前配置文件为只读状态。',
  enabledLabel: '启用 Sentry 遥测',
  enabledHint: '开启后自动拦截并上报 Host 与 Web Client 被内部兜底的错误及全链路 Trace。',
  dsnLabel: 'Sentry DSN（Host & 默认双端）',
  dsnHint: '必填。用于 Host 端上报；若下方未单独填写 Client DSN，Web 前端也默认共用此 DSN。',
  dsnPlaceholder: 'https://<key>@<org>.ingest.sentry.io/<project>',
  dsnInvalid: '请输入合法的 Sentry DSN（例如 https://public@o0.ingest.sentry.io/1）',
  clientDsnLabel: 'Web Client 独立 DSN（可选）',
  clientDsnHint: '可选。如需将前端浏览器错误和 Trace 发送到单独的 Sentry 项目，请在此填写；留空则复用上方主 DSN。',
  clientDsnPlaceholder: '留空则复用主 DSN',
  clientDsnInvalid: '请输入合法的 Sentry DSN 或留空',
  environmentLabel: '环境标识（Environment）',
  environmentHint: '上报至 Sentry 的 environment 标签（如 production、staging、development）。',
  environmentPlaceholder: 'production',
  sampleRateLabel: 'Trace 采样率（0 ~ 1）',
  sampleRateHint: '全链路 Trace（RPC、Agent Turn/Step、LLM 流、Tool 调用）采样比例，1 表示 100% 采样。',
  sampleRateInvalid: '请输入 0 到 1 之间的数字（例如 1 或 0.25）',
  captureToolErrorsLabel: '上报 Tool 执行失败',
  captureToolErrorsHint: '当工具执行返回 isError: true 时，记录并上报 ToolExecutionError。',
  captureRpcErrorsLabel: '上报 RPC 内部错误',
  captureRpcErrorsHint: '当 Host @Remote 接口抛出未预期内部异常（gateway/internal）时捕获完整堆栈。',
  overridden: '已自定义',
  reset: '重置',
  save: '保存设置',
  saving: '保存中…',
  savedNotice: '已保存并实时生效',
  saveFailed: '保存失败，请检查配置文件权限后重试。',
  testButton: '发送测试错误与 Trace',
  testSent: '已向 Sentry 发送测试异常与 Trace Span！',
}

export const en: SentryLocaleDict = {
  summary: 'Captures Host and Web Client errors and distributed traces into Sentry.',
  statusActive: 'Telemetry active (Host + Client)',
  statusNeedsDsn: 'Waiting for a valid Sentry DSN',
  statusDisabled: 'Telemetry paused',
  unavailable: 'Configuration service is unavailable in this environment.',
  readOnly: 'The current profile configuration is read-only.',
  enabledLabel: 'Enable Sentry Telemetry',
  enabledHint: 'Automatically capture contained Host and Web Client errors and end-to-end traces.',
  dsnLabel: 'Sentry DSN (Host & Default)',
  dsnHint: 'Required. Used by the Host and shared with the Web Client when Client DSN is left blank.',
  dsnPlaceholder: 'https://<key>@<org>.ingest.sentry.io/<project>',
  dsnInvalid: 'Enter a valid Sentry DSN (e.g. https://public@o0.ingest.sentry.io/1)',
  clientDsnLabel: 'Web Client DSN (Optional)',
  clientDsnHint: 'Optional separate Sentry project DSN for browser events. Leave blank to reuse the primary DSN above.',
  clientDsnPlaceholder: 'Leave blank to reuse primary DSN',
  clientDsnInvalid: 'Enter a valid Sentry DSN or leave blank',
  environmentLabel: 'Environment',
  environmentHint: 'Environment tag attached to all Sentry events and traces (e.g. production, staging, development).',
  environmentPlaceholder: 'production',
  sampleRateLabel: 'Traces Sample Rate (0 ~ 1)',
  sampleRateHint: 'Sampling rate between 0 and 1 for RPC, Agent Turn/Step, LLM stream, and Tool spans.',
  sampleRateInvalid: 'Enter a number between 0 and 1 (e.g. 1 or 0.25)',
  captureToolErrorsLabel: 'Capture Tool Execution Errors',
  captureToolErrorsHint: 'Report tool executions that settle with isError: true to Sentry.',
  captureRpcErrorsLabel: 'Capture Internal RPC Errors',
  captureRpcErrorsHint: 'Report unexpected Host @Remote internal exceptions (gateway/internal) with full stack traces.',
  overridden: 'Modified',
  reset: 'Reset',
  save: 'Save',
  saving: 'Saving…',
  savedNotice: 'Saved and applied live',
  saveFailed: 'Could not save settings. Please retry.',
  testButton: 'Send Test Error & Trace',
  testSent: 'Test error and trace span sent to Sentry!',
}

export const dicts = {
  zh,
  en,
  ja: en,
  es: en,
  fr: en,
  de: en,
  ru: en,
  pt: en,
}

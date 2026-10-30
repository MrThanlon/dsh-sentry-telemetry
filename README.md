# dsh-sentry-telemetry

Dual-face (Host + Web Client) Sentry error & distributed trace telemetry plugin for DeepSeek Harness.

## Features

- **Host Error Capture across Containment Boundaries**:
  - Hooks `ctx.logger.exporter` (`ERROR` level) to capture Cordis plugin lifecycle, effect, and server errors with original `Error` stacks.
  - Listens to `agent/error`, `api-session/error`, `agent-loop/config-start-failed`, and `agent/request-error` to capture LLM and Agent Loop failures swallowed by driver boundaries.
  - Observes `tools/result` and `tools/execute` to report tool execution errors (`isError: true`).
  - Hooks `typertGateway` invocation failure path and process-level `uncaughtException` / `unhandledRejection` with bounded flush before exit.
- **Client Error Capture across Containment Boundaries**:
  - Subscribes to `ctx.slots.onEntryError` to capture React component crashes caught and isolated by `SlotErrorBoundary` and `FactoryErrorBoundary`.
  - Hooks Client `ctx.logger.exporter` (`ERROR` level) and browser global unhandled errors/rejections.
  - Observes `ctx.connection.rpc.call` to report `gateway/internal` and transport failures.
- **End-to-End Distributed Tracing**:
  - Propagates `sentry-trace` and `baggage` headers from Client RPC calls (`rpc.client`) to Host `connection/request` waterfall (`http.server`).
  - Creates structured spans for Agent turns (`gen_ai.turn`), steps (`gen_ai.step`), LLM streaming calls (`gen_ai.chat` with token usage attributes), and tool executions (`gen_ai.tool`).
- **Live DSN Configuration**:
  - Configure `dsn`, optional `clientDsn`, `environment`, `tracesSampleRate`, and capture switches directly in the **Plugins** settings page (`cordis.patch.yml` volatile config).

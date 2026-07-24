# Target control architecture

## Components and boundaries

- `TargetProvider` owns runner-side configuration and creates one `TargetSession`
  per target process.
- `ControlClient` owns the versioned NDJSON stream. Local mode starts the packaged
  agent with Node; SSH mode starts the same binary with `spawn('ssh', args)`.
- `benchkit-agent` owns port selection and the target child process. It is
  short-lived, writes control messages only to stdout, and forwards target output
  to stderr.
- `createTargetRuntime()` is the only target-side integration. It handles Node IPC
  lifecycle and metrics messages but does not participate in the server hot path.
- The consuming benchmark selects load generation, protocol URLs, scenarios,
  result aggregation, regression policy, and report formatting. Benchkit's
  optional HTTP/1 driver is runner-side and does not participate in control.

The runner-to-agent write path is request/response NDJSON. The agent-to-target
write path is Node IPC. Load traffic does not pass through either control path:
the runner connects directly to `connectHost:port`.

## Public API

```ts
const provider = createTargetProvider({
  mode: 'ssh',
  ssh: {
    destination: 'bench@10.10.0.2',
    cwd: '/opt/swm-core'
  },
  bindHost: '0.0.0.0',
  connectHost: '10.10.0.2'
})

const session = await provider.start({
  entrypoint: './benchmark/server.js',
  args: ['--fw', 'core', '--test', 'base-sync'],
  port: { range: [30_000, 30_100] }
})

await session.waitReachable()
await session.startMetrics({ sampleMs: 250 })
// The caller runs HTTP, WebSocket, or another load protocol here.
const metrics = await session.stopMetrics()
await session.stop()
```

`TargetSession` exposes `endpoint`, `state`, `targetEnvironment`,
`diagnostics`, `waitReachable()`, `startMetrics()`, `stopMetrics()`, and
`stop()`. Endpoint is `{ host, port }`; it deliberately has no URL scheme.

## State machine

```text
starting -> ready -> measuring -> ready -> stopping -> stopped
     |         |          |          |          |
     +---------+----------+----------+----------+-> failed
```

An explicit `stop()` may move `ready` or `measuring` to `stopping` so cleanup
remains possible after a failed load generator. Metrics are not implicitly
stopped or returned by that transition. Invalid user transitions fail with
`InvalidStateError`.

## Control protocol

Every frame is one UTF-8 JSON object followed by `\n`. The protocol version is
currently `1`. Requests contain:

```json
{ "version": 1, "id": "1", "type": "metrics:start", "payload": { "sampleMs": 250 } }
```

Responses carry the same `id` and `type`, plus `status`, current `state`, and
either `payload` or a serializable `error`:

```json
{ "version": 1, "id": "1", "type": "metrics:start", "status": "ok", "state": "measuring", "payload": {} }
```

The agent first emits an `agent:ready` event containing protocol and package
versions. Both are checked before `target:start`. Version mismatch is fatal.
Unsolicited `target:exit` and `agent:error` events make the runner-side session
failed.

NDJSON lines and stderr diagnostics are bounded. Command, startup, readiness,
reachability, graceful shutdown, and force-kill phases have independent
timeouts.

## Failure and cleanup

- Target readiness means IPC readiness only. `waitReachable()` subsequently
  probes TCP from the load-generator machine.
- A failed TCP probe reports bind host, connect host, port, last network error,
  and a firewall/listen-address hint.
- Closing runner stdin, losing SSH, receiving a termination signal, or an agent
  exception starts target cleanup.
- Cleanup first asks the target runtime to run registered hooks, then uses
  `SIGTERM`, then `SIGKILL`.
- Remote profiling is rejected before the agent is spawned. Local profiling
  uses a caller-provided artifact directory.

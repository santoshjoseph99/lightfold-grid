# CLI And Provider Adapters

Lightfold Grid adapters translate an agent profile into a tested launch command and
declare how that provider receives prompts, reports lifecycle events, and handles
data. This keeps provider-specific behavior out of the workspace UI and makes
compatibility explicit.

## Bundled Adapters

| Adapter | Launch behavior | Prompt delivery | Lifecycle owner | Privacy |
| --- | --- | --- | --- | --- |
| Bundled Ollama API | Starts `lightfold-ollama-adapter.mjs` and selects the configured model | Stateful Ollama `/api/chat` session over stdin | Adapter | Local |
| Ollama CLI | Starts the configured `ollama run` command and appends the model | Injected through stdin | Model | Local |
| Anti-Gravity CLI | Adds `--model` when configured | Injected through stdin | Model | Cloud |
| GitHub Copilot CLI | Adds `--model` when configured | Injected through stdin | Model | Cloud |
| Custom interactive CLI | Starts the command exactly as configured | Injected through stdin | Model | User-defined |

Select an adapter explicitly under **Configure Grid -> Agent Profile -> CLI Adapter**.
Old workspace files without `adapterId` remain compatible; Lightfold Grid infers an
adapter from their launch command.

The bundled Ollama adapter owns `ready`, `heartbeat`, `ack`, `result`, and `error`
envelopes. It retains the injected contract and subsequent tasks in one chat history,
and neutralizes model-generated envelope markers before emitting one correlated result,
so protocol reliability does not depend on the local model reproducing JSON. Direct
CLI and custom adapters still require the selected model to follow the injected
Lightfold Grid contract.

## Adapter Contract

An adapter definition has a stable ID and declares:

- executable and launch-template flags;
- prompt delivery as stdin or a system-prompt flag;
- lifecycle ownership by the adapter or model;
- local, cloud, or user-defined privacy mode;
- model-selection and unsafe-mode flags;
- compatibility notes shown in workspace settings.

At launch, `buildAdapterLaunchPlan` returns the final command and whether Lightfold
Grid should inject role instructions through stdin. `discoverAdapterCapabilities`
returns the adapter ID, privacy mode, lifecycle owner, prompt mode, selected model,
tool support, and known context window.

## Community Adapter Guide

1. Add a stable adapter ID and definition in `src/services/cliAdapters.ts`.
2. Prefer a small adapter process when the provider exposes an API. The adapter should
   own readiness, heartbeat, acknowledgements, and terminal results.
3. Keep credentials in the provider CLI or environment. Never include them in adapter
   capability metadata, terminal envelopes, or diagnostics.
4. Accept the generated contract and broker requests through stdin. Emit protocol
   envelopes through stdout using the version-1 `[[STARLIGHT-MSG]]...[[END]]` format.
5. Add launch-template tests to `tests/cli-adapters.test.ts`.
6. Add a deterministic provider mock to `tests/adapter-conformance.test.ts`.
7. Document authentication, privacy, supported models, tool behavior, and limitations
   in the compatibility table above.

Run the conformance suite with:

```bash
npm run adapter:conformance
```

A conforming process must announce readiness, preserve a multi-line injected contract,
receive a request, and emit correlated acknowledgement and terminal-result envelopes.

## Known Limits

- Context-window discovery is currently undefined unless an adapter can provide it.
- Tool support is declarative; Lightfold Grid does not independently sandbox or verify
  provider tools.
- The bundled Ollama adapter provides `read_file`, `write_file`, `list_dir`, and
  `run_command` tools. Models that support native Ollama tool calling (e.g.
  `qwen3-coder:30b`, `qwen3:30b`) use the `tool_calls` API field for reliable
  tool execution. Models without native tool calling (e.g. `qwen2.5-coder:7b`,
  `gemma4-32k`) fall back to text-based parsing, which is less reliable and may
  loop. Choose a model with native tool calling for coding tasks that require
  file edits or command execution. Run `ollama show <model>` and look for
  `tool_call` template support to verify compatibility.
- Provider CLI flags can change between releases; compatibility updates should include
  launch-template tests.

# Five-Minute Quickstart

This walkthrough creates a small disposable Git repository and a four-agent local
Ollama wheel. YOLO mode remains off, and no task is merged without the normal Lightfold
Grid review controls.

## Local Ollama Wheel

Requirements: Git, Node.js 22.12+, Ollama, and `gemma4-32k:latest`.

Install and open Lightfold Grid, then make sure `gemma4-32k:latest` is available:

```bash
ollama pull gemma4-32k:latest
```

In Lightfold Grid:

1. Choose **Create Demo Project** and select a parent folder.
2. In the preset picker that opens, select **Local Ollama** and **Wheel**.
3. Keep `gemma4-32k:latest`, apply the preset, and wait for all four tabs to report ready.
4. Give the Orchestrator the suggested safe task from the demo repository README.
5. Watch requests, acknowledgements, retries, results, and health in the broker panel.
6. Inspect changes and run `npm test` before approving any coding-task merge.

The same workspace can be loaded from
`examples/workspaces/local-ollama-wheel.json` using **Load Profile File**.
Source contributors can also create the repository with `npm run demo:setup`.

## Mixed Local And Cloud

To demonstrate model right-sizing, choose **Start With Preset**, then select **Mixed
Ollama + Gemini** and **Wheel**. It keeps orchestration and testing local in Ollama
while assigning implementation and review to Gemini CLI. Configure and authenticate
Gemini CLI first. The same setup is available in
`examples/workspaces/mixed-local-cloud-wheel.json`; replace either cloud agent with
your preferred CLI or model in **Configure Grid**.

## Readiness Troubleshooting

An agent is ready only after its CLI process starts and it emits the injected readiness
message. If a tab stays in `starting` or becomes `failed`:

1. Open **Broker -> Ops** and run workspace health checks.
2. Confirm the CLI executable and selected model exist.
3. Confirm the CLI accepts interactive input through a PTY.
4. Inspect the terminal for login, trust, model-download, or authentication prompts.
5. Complete required CLI setup, then use the terminal tab's restart action.
6. Confirm the agent can run the injected `lightfold-message ready` helper command.

Some CLIs consume the injected contract as ordinary chat text; others require an
adapter or provider-specific launch option. Keep routes explicit and use the broker log
to confirm the acknowledgement/result chain before trusting a complex workflow.

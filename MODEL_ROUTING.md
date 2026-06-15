# Constraint-Aware Model Routing

Lightfold Grid can assign workflow tasks to the least expensive configured model that
satisfies explicit capability, tool, privacy, context-window, and cost constraints.
Tasks without a `routing` block retain fixed-owner behavior for compatibility.

## Agent Model Profiles

Configure model metadata under **Configure Grid -> Agent Profile**:

- capability tier from 1 (small/specialized) to 5 (strongest);
- context window;
- expected latency;
- input and output cost per million tokens;
- capabilities and tools;
- privacy mode inferred from the selected adapter.

Local Ollama presets default to zero provider cost and tier 2. Cloud presets default
to tier 4 and editable illustrative pricing. Verify provider pricing before relying on
cost estimates.

## Routed Workflow Tasks

Add a `routing` block to a workflow task:

```json
{
  "id": "build",
  "owner": "Pane-B",
  "goal": "Implement the feature",
  "requiredCapabilities": ["coding"],
  "requiredTools": ["git", "npm"],
  "routing": {
    "localOnly": false,
    "minCapabilityTier": 2,
    "minContextWindow": 32000,
    "maxEstimatedCostUsd": 0.25,
    "candidateOwners": ["Pane-B", "Pane-E"],
    "estimatedInputTokens": 12000,
    "estimatedOutputTokens": 4000
  }
}
```

Without `candidateOwners`, every configured model profile is considered. The router
rejects ineligible candidates, calculates estimated cost, and selects the least
expensive eligible model. The workflow view records the selected model, reason,
candidate rejections, expected cost, and savings versus the strongest eligible model.

## Ordered Fallbacks

Use `fallbackOwners` when escalation order matters:

```json
{
  "routing": {
    "fallbackOwners": ["Pane-B", "Pane-C", "Pane-E"],
    "estimatedInputTokens": 12000,
    "estimatedOutputTokens": 4000
  }
}
```

The first eligible owner is selected. If delivery or model execution fails, Lightfold
Grid requeues the task and selects the next untried owner. Local-only constraints are
always enforced, including during escalation.

## Usage And Limits

The Ops view aggregates estimated cost, estimated savings, escalations, and
provider-reported token usage. The bundled Ollama adapter reports prompt and completion
token counts. Direct CLI adapters may not expose token usage, so their totals can remain
unknown while cost estimates use the configured profile.

Cost metadata is user-supplied and is not a billing guarantee. Workflow-level budgets,
historical model recommendations, and automatic pricing catalogs remain future work.

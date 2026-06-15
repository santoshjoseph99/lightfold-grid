# Workflow Budgets

Lightfold Grid can apply durable cost and cloud-usage guardrails to dynamically routed
workflow tasks. Budgets constrain each new assignment and escalation before a model is
selected.

```json
{
  "id": "budgeted-feature",
  "name": "Budgeted feature",
  "goal": "Implement and verify a feature",
  "createdBy": "Hub",
  "budget": {
    "maxEstimatedCostUsd": 1.00,
    "maxCloudEstimatedCostUsd": 0.50,
    "maxCloudAssignments": 2
  },
  "tasks": [
    {
      "id": "implement",
      "owner": "local-small",
      "goal": "Implement the feature",
      "routing": {
        "candidateOwners": ["local-small", "cloud-strong"],
        "estimatedInputTokens": 10000,
        "estimatedOutputTokens": 3000
      }
    }
  ]
}
```

## Enforcement

- `maxEstimatedCostUsd` caps estimated spend across all routed assignments.
- `maxCloudEstimatedCostUsd` caps the cloud portion of estimated spend.
- `maxCloudAssignments` caps cloud assignments, including escalations.
- Each routing decision reserves its estimate immediately, so parallel tasks cannot
  independently spend the same remaining budget.
- Reservations remain consumed across manual retries and reassignments even though
  those actions start a new routing cycle.
- Exhausted cloud budgets force local-only routing. Exhausted total budgets reject
  paid candidates with an inspectable routing reason.

Budget usage and limits appear in the workflow view. Budgets and assignment history
are persisted, so enforcement continues after restart.

## Limits

Budgets apply to dynamically routed tasks. Fixed-owner tasks remain explicit user
assignments and are not silently blocked. Estimates depend on user-configured pricing
and token estimates. Provider-reported actual cost is shown separately after execution
and may differ from the reserved estimate.

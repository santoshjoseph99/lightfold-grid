# Historical Model Recommendations

Lightfold Grid derives advisory model recommendations from completed routed workflow
tasks already stored in the durable broker database. Recommendations do not override
task owners, routing constraints, fallback order, or approval gates.

## Matching

Tasks are considered part of the same task family when they have the same:

- coding or non-coding mode;
- required capabilities and tools;
- `localOnly` setting;
- minimum capability tier; and
- minimum context window.

Requirements are normalized, so their order and capitalization do not affect matching.
Only completed routed tasks are evidence. Failed tasks, tasks completed by a model that
is no longer configured on that agent, and models that violate the current task's
constraints are excluded.

## Ranking And Confidence

Eligible models are ranked by observed average cost, then successful-task count,
average duration, and agent ID for deterministic ties. Provider-reported actual cost is
preferred when available; otherwise Lightfold Grid uses the historical routing estimate.

Confidence reflects the amount of matching successful evidence:

- `low`: one successful matching task;
- `medium`: two to four successful matching tasks;
- `high`: five or more successful matching tasks.

The workflow view shows advisory recommendations beside routed and fixed-owner tasks,
including the recommended model and agent, confidence, successful-task count, average
cost, and average duration when available.

## Limits

Recommendations are local to the retained broker history and configured model profiles.
They do not assess output quality beyond workflow completion criteria, compare prompt
content semantically, or automatically alter routing. Sparse or weak completion criteria
can produce weak recommendations, so the evidence remains visible and advisory.

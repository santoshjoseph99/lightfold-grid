# Benchmarks And Proof

Lightfold Grid includes a deterministic public reference benchmark covering
specification, coding, testing, review, debugging, and repository analysis. It compares:

- one strong cloud model for every task;
- a mixed-model team that assigns strength by task; and
- a local-only team.

Run it from a clean checkout:

```bash
npm run benchmark:reference
```

The command reads `benchmarks/reference-suite.json` and writes machine-readable raw
results to `benchmark-results/latest.json` plus a human-readable comparison to
`benchmark-results/latest.md`. Both canonical summaries are committed, and CI fails if
rerunning the reference suite changes them without an intentional update.

## Reported Metrics

Each configuration reports completion rate, validation pass rate, estimated cost,
total and average latency, retries, escalations, human interventions, cloud
assignments, and per-task raw outcomes.

The reference alpha threshold passes when the mixed-model team:

- has at least a 95% validation pass rate;
- loses no more than five percentage points of validation rate against the strong-model
  baseline; and
- reduces estimated model cost by at least 50%.

## Interpretation

The reference suite is deterministic evidence that the benchmark format, metrics, and
comparison logic are reproducible. Its outcomes are declared fixture data, not claims
about real model quality. Public performance claims require repeated live-model runs
using pinned model versions, prompts, repositories, provider pricing, and raw result
publication in the same schema.

Contributors can replace or extend the models, configurations, tasks, and outcomes in
the suite JSON. Every configuration must assign a model to every task category and
provide an explicit outcome for each selected task/model pair.

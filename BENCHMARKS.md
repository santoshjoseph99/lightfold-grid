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

## Pinned Live-Model Evidence

The live benchmark evidence pipeline validates real comparison campaigns without
pretending to execute or judge provider models itself. First verify the committed
fixture contract:

```bash
npm run benchmark:live:contract
```

The example in `benchmarks/live-example/` is deliberately marked `fixture`. Its
declared outcomes test the evidence pipeline and are not model-performance claims.

For a publishable campaign:

1. Copy the example campaign and set `provenance` to `live`.
2. Pin every repository to a commit, every prompt set to a version, artifact path, and
   SHA-256 digest, and every provider model to an exact version or immutable identifier.
3. Record the pricing retrieval timestamp and per-million-token prices used for
   estimated cost.
4. Run every configuration/task pair at least three times.
5. Record completion, validation, latency, retries, escalations, human interventions,
   tokens, timestamps, and the assigned model for every run.
6. Store raw reviewed evidence in JSON bundles with a `records` array. Give every run
   a unique `evidenceRecordId`, relative evidence path, and bundle SHA-256 digest.
7. Remove secrets, private prompts, proprietary code, and unreviewed logs before
   publishing any evidence.
8. Validate and write a report:

```bash
npm run benchmark:live:validate -- path/to/campaign.json --output live-benchmark-results
```

The validator rejects fixture provenance, incomplete repetitions, unpinned metadata,
configuration/model mismatches, unsafe evidence paths, missing evidence records, and
digest mismatches. Passing validation proves provenance completeness and integrity; it
does not prove that a model comparison is fair, representative, or independently
reproduced.

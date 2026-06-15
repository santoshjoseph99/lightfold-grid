# Community Launch Readiness

Lightfold Grid separates repository-controlled community preparation from work that
requires real people or publication access.

Run:

```bash
npm run community:readiness
```

The command fails when repository-controlled materials regress. It intentionally
reports external launch activities as blocked without failing the command.

## Repository Gates

- A repeatable private-alpha guide covers participant selection, consent, observation,
  outcome recording, and safety stops.
- A structured feedback form captures installation and first-workflow outcomes without
  asking for sensitive data.
- The public roadmap is organized around measurable user outcomes.
- Beginner, adapter, documentation, alpha-feedback, and security labels are defined.
- Adapter contributors have a structured proposal and conformance form.
- Cross-platform CI and release packaging run the community-readiness check.

## External Blockers

Automation cannot prove that independent users were recruited, that installation and
first-workflow sessions occurred, or that the repository was publicly created and
announced. These remain blocked until maintainers record real evidence.

See `PRIVATE_ALPHA.md` for the session protocol, `ROADMAP.md` for intended user
outcomes, and `OPEN_SOURCE_PLAN.md` for all public-alpha gates.

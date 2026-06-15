# Source And Bundled-Asset Provenance

This record documents the repository-level publishability review for the first
experimental public alpha.

## Repository Content

- Project source, tests, prompts, examples, documentation, workflows, and generated
  benchmark summaries are published under Apache-2.0.
- The repository currently contains no bundled third-party images, fonts, audio,
  videos, model weights, or copied proprietary source files.
- The demo repository, fake agent, prompts, benchmark fixture data, and workspace
  examples are project-authored test and documentation material.
- The Lightfold Grid SVG, PNG, and ICNS application icons are project-authored assets
  published under Apache-2.0.
- Generated release packages are not committed as source.

## Dependencies

Third-party npm dependencies remain governed by their own licenses and are installed
through `package-lock.json`. Release automation publishes an SPDX software bill of
materials. Dependency license and security review remains part of release preparation.

## Contribution Requirements

Contributors must have the right to submit their work under Apache-2.0, identify
third-party or generated assets, preserve required notices, avoid committing private
prompts or proprietary code, and disclose material AI assistance in the pull request
template.

Adding any third-party bundled asset or copied source requires updating this record with
its origin, license, attribution, and redistribution terms before merge.

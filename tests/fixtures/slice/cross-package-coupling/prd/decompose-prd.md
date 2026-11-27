# Cross-package coupling fixture PRD

Measurement fixture: ten source files in five coupled package pairs.
Each acceptance criterion names one target file so codegraph query resolves
that file as one work unit.

## Acceptance criteria
- Update plain-a source
- Update plain-b source
- Update dyn-a source
- Update dyn-b source
- Update reexport-a source
- Update reexport-b source
- Update workspace-a source
- Update workspace-b source
- Update contract-a source
- Update contract-b source

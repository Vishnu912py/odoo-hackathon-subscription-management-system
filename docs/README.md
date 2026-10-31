# Documentation README

Shared context for the three contributors and coding assistants. Read alongside the root README.

## Documentation map

- [Requirements](requirements.md): source scope and acceptance criteria.
- [Team responsibilities](team-responsibilities.md): named owners, handoffs and completion criteria.
- [Architecture and contracts](architecture.md): proposed entities, integration boundaries and confirmed decisions.
- [ER diagram and schema handoff](er-diagram.md): PostgreSQL relationships, field definitions, constraints and billing transaction boundaries for Zenfox.
- [Frontend wireframe and handoff](ui-wireframe.md): clickable local UI reference, screen map, shared components and implementation sequence for Albin.
- [API contracts and integration guide](api-contracts.md): shared HTTP conventions, roles, business defaults, database additions and integration exercise.
- [API impact and schema alignment](api-impact.md): database-to-API impact matrix, confirmed decisions analysis, and team coordination checklist.
- [OpenAPI v0.1 contract](api/openapi.json): machine-readable operations and payload schemas; [example manifest](api/examples/manifest.json) maps fixtures to schemas.
- [Database guide](../database/README.md): database setup, schema, migrations, seed fixtures, and test suite.
- [Roadmap](../plan.md): implementation order and demo checklist.
- [Contributor guide](../contributing.md): branches, reviews and validation.
- [Agent context](../agents.md): project instructions for coding assistants.

These are planning and technical reference documents, not evidence of all implemented features. Add concrete API/model contracts and verified setup instructions when the scaffold exists. Keep source requirements separate from team decisions.

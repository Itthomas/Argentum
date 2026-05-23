# Slice Cards

Store one markdown file per implementation slice in this directory.

## Rules

- Keep one owning boundary per slice.
- Use a stable numeric prefix such as `0001-`.
- Update the slice status as it moves through `planned`, `approved`, `in-progress`, and `validated`.
- Link the authoritative spec files and the focused validation target.
- Record acceptance criteria explicitly in the slice card.
- Do not start coding until the slice card shows `Approval: approved`.

## Suggested Naming

- `0001-contracts-runtime-config.md`
- `0002-environment-config-loader.md`
- `0003-gateway-session-router.md`

Use [0000-template.md](./0000-template.md) as the starting point.
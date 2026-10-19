# Pi setup

Setup guides for the global Pi configuration under `~/.pi/agent/`:

- [Pi agents](pi-open-agents.md) — pi-subagents setup, parent workflows, and migration validation.
- [Parent workflow commands](pi-custom-commands/README.md) — `/plan`, `/architect`, and `/none`.
- [Guardrails](pi-guardrails/README.md) — scout search delegation and commit protection.

From this repository:

```powershell
node install.mjs --dry-run
node install.mjs
```

The installer backs up live configuration, installs pi-subagents and the local
extensions, deploys agents, merges workflow instructions/settings, and then runs
`pi uninstall npm:pi-open-agents`. Review the dry-run output before installation.
It preserves unrelated settings and extra agent files; it never copies the full
`.pi.user/settings.json` template over live settings.

Run repository checks with:

```powershell
node --test install.test.mjs agents.test.mjs
npm test --prefix .\pi-custom-commands
npm test --prefix .\pi-guardrails
```

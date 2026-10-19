# Pi agents with pi-subagents

This guide keeps its original filename for existing links. Delegation now uses
[pi-subagents](https://github.com/nicobailon/pi-subagents). The main Pi session
implements normal tasks and orchestrates explicit complex workflows.

## Install and migrate

```powershell
node install.mjs --dry-run
node install.mjs
```

The installer validates inputs and backs up existing `settings.json`, `AGENTS.md`,
and `agents/` under `~/.pi/agent/backup-open-agents/<unique-directory>/`. It installs
pi-subagents and local extensions, deploys definitions, merges only workflow
instructions/settings, and finally runs `pi uninstall npm:pi-open-agents`.

Unrelated settings, packages, instructions, and extra agent files are preserved.
Failures stop subsequent steps; backups remain available for manual recovery.
The old package is not uninstalled if installation or deployment fails. Installation
may already have registered the replacement package if a later step fails; correct
the reported problem and rerun before restarting Pi.

Restart Pi after migration. Agent definitions deploy from `.pi.user/agents/` into
`~/.pi/agent/agents/`; project `.pi/agents/` definitions can override the same names.
The legacy architect definition is no longer supplied. Any installed copy remains
disabled in subagents settings; `/architect` is a parent workflow command.

## Roles and models

| Agent | Model | Thinking | Delegation |
| --- | --- | --- | --- |
| [scout](.pi.user/agents/scout.md) | `anthropic/claude-haiku-5-5` | Low | Leaf; repository investigation. |
| [plan](.pi.user/agents/plan.md) | Inherit parent/default | High | Only scout and oracle. |
| [worker](.pi.user/agents/worker.md) | `anthropic/claude-sonnet-5-5` | High | Only reviewer. |
| [reviewer](.pi.user/agents/reviewer.md) | `anthropic/claude-opus-5-5` | High | Leaf; report defects without editing. |
| [oracle](.pi.user/agents/oracle.md) | Inherit parent/default | High | Leaf; challenge direction without editing. |

Model IDs are preserved from existing definitions. Scout's model is not in the
template's enabled-model list; verify its availability with `/model` before use.
An unavailable model or unsupported thinking level must be reported rather than
silently changing providers. No model-backed availability check is performed by
the repository installer.

Plan and worker use `maxSubagentDepth: 2` because the limit is absolute, allowing
parent → specialist → leaf. Leaves use `0` and receive no nested delegation grant.
Children inherit project instructions, exclude global parent workflow instructions,
and use their own role prompts. Plan and worker inherit skills; inspection leaves
do not. Inspection shells follow explicit no-edit instructions; tool lists are
not filesystem sandboxes.

## Parent workflow controls

- `/none`: normal parent implementation; use scouts for repository searches.
- `/architect`: complex workflow; use plan, optional oracle, bounded worker work,
  and independent reviewer checks when useful.
- `/plan`: read-only parent planning; delegate only to scout, oracle, or plan.

These commands change parent instructions/tools, preserve the parent model, and
persist with the session branch. Planning and architect workflows use high thinking;
`/none` restores prior tools/thinking. See [command details](pi-custom-commands/README.md).

Outside architect mode, another specialist requires an explicit user request.
Multiple scouts may investigate independent scopes. The existing search guardrail
still requires the parent to delegate repository search. Prefer background delegation
when child commit protection is required; see [guardrails](pi-guardrails/README.md).

## Validate after installation

Start a fresh Pi session and run `/subagents-doctor`. Ask Pi to list available
subagents (`subagent({ action: "list" })`) and confirm the five roles, their models,
thinking levels, and nesting limits. Use `/subagents-guide` for commands supported
by the installed version.

Check these scenarios in a disposable test project:

1. Normal discovery uses scout; a small implementation remains in the parent.
2. Independent investigations can run multiple scouts with different scopes.
3. Explicit plan work can launch scout/oracle, cannot launch worker, and edits no files.
4. Explicit worker work can edit and launch reviewer, but cannot launch other roles.
5. Scout, reviewer, and oracle cannot launch children.
6. `/plan` blocks parent edits and shells; `/none` restores tools/thinking. Resume,
   reload, and tree navigation restore the selected workflow.
7. `/subagents-fleet` displays active children and their status. Inspect usage/cost
   using the installed extension's observability tools.

Repository checks are listed in [Pi setup](pi-setup.md). Live diagnostics and
model-backed workflow checks require a migrated, authenticated Pi session.

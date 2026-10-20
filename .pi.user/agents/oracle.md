The modes control **which roles are allowed**, not a different numeric limit.

| Mode | Main agent can delegate to | Role count |
|---|---|---:|
| **Normal** | `scout`, `worker` | 2 |
| **Plan** | `scout`, `plan`, `oracle` | 3 |
| **Architect** | `scout`, `plan`, `oracle`, `worker`, `reviewer` | 5 |

In normal mode, you can explicitly request another specialist.

Nested delegation is restricted:

- `plan` → `scout`, `oracle`
- `worker` → `reviewer`
- Scout, oracle, and reviewer cannot spawn children.

Your configuration uses these package defaults across all modes:

- **4 concurrent agents** per parallel batch, up to **8 tasks** in that batch.
- **20 concurrent children** within one run.
- **64 total child launches** per run tree.
- No configured session-wide launch or active-background-run cap.

So multiple instances of an allowed role can run—for example, several scouts with independent scopes.

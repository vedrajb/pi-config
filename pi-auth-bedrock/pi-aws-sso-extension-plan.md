# Plan: `pi-aws-sso` Extension

## Objective

Build a small Pi extension that automatically ensures AWS SSO authentication is valid whenever an Amazon Bedrock model is selected.

The extension should **not** implement a new Bedrock provider. Pi's existing `amazon-bedrock` provider should continue handling model discovery, requests, streaming, and AWS SDK integration.

The extension's responsibility is only:

> When a Bedrock model becomes active, validate the configured AWS SSO session. If it is expired or missing, run `aws sso login` automatically, validate again, then allow Pi to continue.

---

## Target UX

Launch Pi normally:

```bash
pi
```

Switch models using:

```text
/model
```

or:

```text
Ctrl+L
```

Example:

```text
openai-codex/gpt-5.6-sol

        ↕

amazon-bedrock/openai.gpt-5.6-sol
```

Expected behavior:

```text
OpenAI selected
      ↓
do nothing
```

```text
Bedrock selected
      ↓
check default AWS session
      ↓
 ┌───────────────┐
 │ Valid session?│
 └───────┬───────┘
       yes│no
          │
          ├──────────────→ aws sso login
          │                     ↓
          │               browser login
          │                     ↓
          └──────────────→ validate again
                                ↓
                         Bedrock ready
```

The user should not need:

```bash
aws sso login --profile default
```

or a custom shell wrapper during normal use.

---

## Extension Layout

Start with a local extension:

```text
~/.pi/agent/extensions/
└── aws-sso.ts
```

Once stable, package it:

```text
pi-aws-sso/
├── package.json
├── README.md
└── src/
    └── index.ts
```

Possible installation later:

```bash
pi install ./pi-aws-sso
```

or via npm/GitHub.

---

## Configuration

Avoid hard-coding company-specific values where possible.

Support:

```text
PI_AWS_SSO_PROFILE
PI_AWS_REGION
```

Resolution order:

### Profile

```text
PI_AWS_SSO_PROFILE
↓
AWS_PROFILE
↓
default
```

### Region

```text
PI_AWS_REGION
↓
AWS_REGION
↓
AWS_DEFAULT_REGION
↓
aws configure get region --profile <profile>
```

For the initial local version, default to:

```text
profile = default
```

---

## Core Authentication Function

Implement:

```ts
ensureAwsSession()
```

Responsibilities:

1. Determine AWS profile.
2. Determine AWS region.
3. Validate the current AWS session.
4. If valid, return immediately.
5. If invalid, run AWS SSO login.
6. Validate again.
7. Set the AWS environment Pi's native Bedrock provider will use.

Validation command:

```bash
aws sts get-caller-identity --profile default
```

Use Pi's command execution API:

```ts
await pi.exec("aws", [
  "sts",
  "get-caller-identity",
  "--profile",
  profile,
]);
```

---

## Detect Bedrock Model Selection

Use Pi's `model_select` event.

Conceptually:

```ts
pi.on("model_select", async (event, ctx) => {
    if (event.model.provider !== "amazon-bedrock") {
        return;
    }

    await ensureAwsSession(ctx);
});
```

This should cover:

- `/model`
- model cycling
- restored models
- programmatic model selection

The extension should ignore all non-Bedrock providers.

---

## Handle Bedrock as the Startup Model

Add a second safeguard for Pi starting with Bedrock already selected:

```ts
pi.on("session_start", async (_event, ctx) => {
    if (ctx.model?.provider === "amazon-bedrock") {
        await ensureAwsSession(ctx);
    }
});
```

Expected startup behavior:

```text
Pi starts on OpenAI
      ↓
nothing
```

```text
Pi starts on Bedrock
      ↓
session_start
      ↓
ensureAwsSession()
```

---

## Avoid Unnecessary AWS Calls

Do not run STS before every prompt.

Use an in-memory TTL:

```ts
let lastSuccessfulCheck = 0;
const CHECK_TTL = 5 * 60 * 1000;
```

Behavior:

```text
Bedrock selected
      ↓
checked <5 min ago?
 ├─ yes → skip
 └─ no  → STS check
```

The AWS SDK already handles normal temporary credential refresh. The extension is mainly responsible for detecting when a fresh interactive SSO login is required.

---

## Prevent Concurrent Login Attempts

Use a shared promise:

```ts
let authPromise: Promise<boolean> | null = null;
```

Pattern:

```ts
if (authPromise) {
    return authPromise;
}

authPromise = authenticate();

try {
    return await authPromise;
} finally {
    authPromise = null;
}
```

This prevents two events from starting two browser login flows at once.

---

## SSO Login Flow

If STS validation fails:

```ts
ctx.ui.notify(
    `AWS SSO session for ${profile} has expired. Authenticating...`,
    "info"
);
```

Then run:

```ts
const result = await pi.exec(
    "aws",
    ["sso", "login", "--profile", profile],
    { timeout: 5 * 60 * 1000 }
);
```

The AWS CLI should handle browser/device authentication.

After login:

1. Run `aws sts get-caller-identity` again.
2. If successful, cache the successful validation time.
3. Continue with the Bedrock model.
4. If it still fails, surface an error.

---

## Failure Handling

### AWS CLI missing

Show:

```text
AWS CLI not found.
Install AWS CLI v2 to use Bedrock SSO.
```

### AWS profile missing

Show:

```text
AWS profile "default" was not found.
```

### SSO login cancelled or failed

Show:

```text
AWS SSO authentication failed for default.
```

### Login succeeds but credentials still fail

Show:

```text
AWS credentials could not be validated after login.
```

Do not silently continue.

---

## Optional Model Rollback

If the user switches from OpenAI to Bedrock and authentication fails, optionally restore the previous model.

Conceptually:

```ts
await pi.setModel(event.previousModel);
```

Use a recursion guard:

```ts
let revertingModel = false;
```

This prevents the rollback itself from repeatedly triggering authentication logic.

Suggested v1 behavior:

- If authentication fails after a manual model selection, revert to the previous model.
- If Pi starts directly on Bedrock and authentication fails, stay on Bedrock but show a clear error.

---

## Set AWS Environment for Pi

After resolving profile and region:

```ts
process.env.AWS_PROFILE = profile;
process.env.AWS_REGION = region;
process.env.AWS_DEFAULT_REGION = region;
```

Architecture:

```text
pi-aws-sso extension
        │
        │ authentication only
        ▼
AWS CLI / AWS SSO cache
        │
        ▼
AWS_PROFILE=default
        │
        ▼
Pi native amazon-bedrock provider
        │
        ▼
AWS SDK
        │
        ▼
Amazon Bedrock
```

The extension should never proxy or inspect LLM request/response traffic.

---

## Optional `/aws-sso-status` Command

Add after the MVP is working:

```text
/aws-sso-status
```

Example output:

```text
AWS Bedrock authentication

Profile: default
Region:  us-east-1
Status:  Authenticated
Account: 123456789012
Role:    DeveloperRole
```

Do not display secrets or tokens.

Also consider:

```text
/aws-sso-login
```

to force a fresh login manually.

---

## Optional Status Bar

Later, show something like:

```text
AWS: ✓ default
```

when a Bedrock model is active.

During authentication:

```text
AWS: authenticating…
```

Do not include this in the initial MVP unless it is trivial.

---

## Lifecycle Design

Do **not** rely on `before_agent_start` as the primary authentication recovery hook.

Authentication needs to happen before Pi reaches a provider call that requires valid credentials.

Primary hooks:

```text
model_select
+
session_start
```

Desired timing:

```text
/model → Bedrock
     ↓
model_select
     ↓
AWS SSO validation/login
     ↓
user submits prompt
     ↓
Pi provider authentication
     ↓
Bedrock call
```

---

## Implementation Phases

### Phase 1 — Detection

Implement only:

- local extension loading
- `model_select`
- detect `amazon-bedrock`
- show a notification

Success criterion:

```text
Switching to Bedrock produces one notification.
Switching to OpenAI does nothing.
```

### Phase 2 — Validation

Add:

```bash
aws sts get-caller-identity --profile default
```

Success criterion:

- valid SSO → immediate success
- expired SSO → detect failure
- missing AWS CLI → clear error
- missing profile → clear error

### Phase 3 — Automatic Login

On failed validation:

```bash
aws sso login --profile default
```

Then validate again.

Success criterion:

```text
Expired SSO
   ↓
browser login
   ↓
Pi continues with Bedrock
```

### Phase 4 — Hardening

Add:

- `session_start`
- region resolution
- validation TTL
- concurrent-login protection
- robust error handling
- optional model rollback
- configuration via environment variables

### Phase 5 — Quality-of-Life Features

Optional:

- `/aws-sso-status`
- `/aws-sso-login`
- status-bar indicator
- configurable TTL
- debug logging

### Phase 6 — Packaging

Convert the local extension into:

```text
pi-aws-sso
```

Add:

- `package.json`
- README
- license
- tests
- npm/GitHub distribution

---

## Test Matrix

| Scenario | Expected result |
|---|---|
| Start Pi with OpenAI | No AWS commands |
| OpenAI → OpenAI | No AWS commands |
| OpenAI → Bedrock, valid SSO | STS succeeds; no browser |
| OpenAI → Bedrock, expired SSO | Browser SSO login |
| Bedrock → OpenAI | No AWS interaction |
| Bedrock → another Bedrock model | Cached auth; no second login |
| Start Pi with Bedrock default | Session checked automatically |
| Resume session with Bedrock model | Authentication checked |
| Cancel browser login | Clear error |
| AWS CLI absent | Clear error |
| AWS profile absent | Clear error |
| Region missing | Clear configuration error |
| SSO login succeeds | Bedrock works immediately |
| SSO login fails | Bedrock request does not proceed |
| Rapid Bedrock selections | Only one login flow |
| `/model` selection | Works |
| Ctrl+P model cycling | Works |

---

## Security Requirements

The extension must:

- never store AWS access keys
- never store AWS secret keys
- never store AWS SSO tokens itself
- never log SSO tokens
- never log environment secrets
- never intercept LLM prompt/response content
- rely on the AWS CLI / AWS SDK credential cache
- use the existing Pi Bedrock provider

The extension should only know:

```text
profile name
region
authentication status
AWS account/role metadata if requested
```

---

## Recommended v1 Scope

Include:

```text
✓ Existing amazon-bedrock provider
✓ AWS CLI v2
✓ AWS SSO profiles
✓ Automatic expiry detection
✓ Automatic browser login
✓ default profile
✓ Region auto-detection
✓ model_select
✓ session_start
✓ Authentication caching
✓ Concurrent-login protection
✓ Clear errors
```

Exclude:

```text
✗ Custom Bedrock implementation
✗ Direct IAM Identity Center OAuth implementation
✗ Credential storage
✗ AWS access/secret key management
✗ Custom model discovery
✗ LLM request proxying
```

---

## Expected Daily Workflow

After installation:

```bash
pi
```

Then switch normally:

```text
Ctrl+P
```

Example:

```text
OpenAI GPT-5.6
       ↓
Bedrock GPT-5.6
       ↓
Claude on Bedrock
       ↓
OpenAI GPT-5.6
```

If the AWS SSO session is valid, switching to Bedrock should be immediate.

If the SSO session has expired:

```text
Switch to Bedrock
       ↓
extension detects expired session
       ↓
AWS browser login
       ↓
session validated
       ↓
Bedrock model ready
```

No `pii()` wrapper and no manual `aws sso login` should be required during normal use.

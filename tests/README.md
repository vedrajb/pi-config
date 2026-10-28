# Tests

All test files live in this directory, grouped by the component they exercise:

- `*.test.mjs`: installer, settings, profiles, agent configuration, and the deviceId Git hook.
- `pi-custom-commands/`: workflow commands and model profiles.
- `pi-guardrails/`: delegation and commit guardrails.
- `_archive/pi-aws-sso/src/`: archived AWS SSO tests.

Implementation files remain in their original directories; tests import them using
paths relative to their location under `tests/`.

Run the complete suite from the repository root:

```powershell
node --test
```

Run individual groups from the repository root:

```powershell
node --test tests/install.test.mjs tests/install-paths.test.mjs tests/profile-install.test.mjs tests/first-install-profile.test.mjs tests/agents.test.mjs
node --test tests/device-id-hook.test.mjs
npm test --prefix .\pi-custom-commands
npm test --prefix .\pi-guardrails
node --test tests/_archive/pi-aws-sso/src/index.test.ts
```

The package-level `npm test` commands use the central test files; there are no
separate test copies alongside the implementation.

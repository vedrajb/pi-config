# pi-aws-sso

Pi extension that validates AWS SSO before an `amazon-bedrock` model is used. If the session is expired, it runs `aws sso login` and validates the credentials again. Pi's native Bedrock provider remains responsible for model requests.

## Use

Try the extension directly:

```bash
pi -e ./aws-sso.ts
# or: pi -e ./src/index.ts
```

Or install this directory as a Pi package:

```bash
pi install ./
```

AWS CLI v2 must be installed. The extension uses the AWS CLI credential cache and never stores AWS credentials or SSO tokens.

## Configuration

Defaults:

- Profile: `default`
- Region: `us-east-1`

The extension first reads `AWS_PROFILE`, `AWS_REGION`, and `AWS_DEFAULT_REGION` from the `amazon-bedrock.env` object in Pi's agent `auth.json` (by default `~/.pi/agent/auth.json`). This keeps the AWS CLI SSO check aligned with Pi's native Bedrock provider without duplicating profile or region configuration. If that file or entry is unavailable, it falls back to process environment variables, then the defaults above.

For example, this Pi credential configuration is sufficient:

```json
{
  "amazon-bedrock": {
    "type": "api_key",
    "env": {
      "AWS_REGION": "us-east-1",
      "AWS_PROFILE": "default"
    }
  }
}
```

Process-level `PI_AWS_SSO_PROFILE` or `PI_AWS_REGION` are used when the `auth.json` entry is unavailable. The stored Bedrock configuration intentionally takes precedence so the extension and Pi's provider use the same values.

For environments without the `auth.json` entry, set environment variables before starting Pi:

```bash
PI_AWS_SSO_PROFILE=my-sso-profile PI_AWS_REGION=us-west-2 pi
```

When a Bedrock model becomes active, the extension runs:

```bash
aws sts get-caller-identity --profile <profile>
```

and only starts `aws sso login --profile <profile>` when validation fails. Successful checks are cached for five minutes and concurrent selections share one authentication attempt.

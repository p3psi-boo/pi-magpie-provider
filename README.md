# pi-magpie-provider

`pi-magpie-provider` registers one [magpie](https://github.com/yetone/magpie) gateway as a Pi model provider. It discovers models from magpie's `GET /v1/models` catalog: IDs stay `provider/model` (or `group/...`), API selection comes from `native_endpoints`, thinking levels from `supported_reasoning_levels`, context and output limits from the advertised windows, and vision from `modalities.input`.

This is the path for Docker and remote magpie. Magpie running on the same machine already writes `~/.pi/agent/models.json`; do not install both wirings.

## Install

Install from npm:

```bash
pi install npm:pi-magpie-provider
```

Or install from GitHub:

```bash
pi install git:github.com/0xRichardH/pi-cliproxyapi-provider@master
```

Restart pi after installing, then run:

```text
/magpie config
/login magpie
/model
```

## Install for local testing

From this repository:

```bash
pi -e .
```

List models without installing:

```bash
PI_MAGPIE_BASE_URL=http://127.0.0.1:3425/v1 \
PI_MAGPIE_API_KEY=your-gateway-key \
pi -e . --list-models magpie
```

## Configure

Run the interactive command:

```text
/magpie config
```

It writes global connection/auth config to:

```text
~/.pi/agent/pi-magpie-provider/config.json
```

Environment variables override config:

```text
PI_MAGPIE_BASE_URL
PI_MAGPIE_PROVIDER_NAME
PI_MAGPIE_AUTH_REQUIRED
PI_MAGPIE_AUTH_HEADER
PI_MAGPIE_API_KEY
```

Default base URL is `http://127.0.0.1:3425/v1`. Docker and LAN sharing usually need a reachable host and a magpie gateway key (`/login magpie`).

Project config supports bounded per-model overrides (`reasoning`, `contextWindow`, `maxTokens`). Connection and auth settings must be set in global config or environment variables.

### Display configuration

Run `/magpie config` in Pi TUI mode to edit package-level `settings.json` values. The tabbed panel has `Connection` and `Display` sections.

```json
{
  "pi-magpie-provider": {
    "showStrictMode": false
  }
}
```

## Authenticate

Use pi's normal API-key login flow:

```text
/login magpie
```

Or:

```bash
export PI_MAGPIE_API_KEY=your-gateway-key
```

## Commands

```text
/magpie config             # tabbed connection and display configuration
/magpie status             # show snapshot and capabilities
/magpie refresh            # refresh GET /v1/models and update pi immediately
/magpie models             # inspect effective model settings and set bounded overrides
/magpie config connection  # open endpoint and authentication editor
```

## How discovery works

Startup registers the provider immediately from the last-known-good local snapshot under `~/.cache/pi-magpie-provider/`. It then refreshes magpie availability in the background with a short timeout and updates the provider dynamically if the model list changed. On a first run, Pi registers a placeholder until background discovery succeeds.

Failed refreshes retain the last-known-good snapshot. Image and video catalog entries are not registered as chat models.

## Test

```bash
npm test
```

## Release

See [RELEASING.md](RELEASING.md) for versioning, `npm publish`, and troubleshooting.

# pi-magpie-provider

`pi-magpie-provider` registers one [magpie](https://github.com/yetone/magpie) gateway as a Pi model provider. It discovers models from magpie's `GET /v1/models` catalog: IDs stay `provider/model` (or `group/...`), API selection comes from `native_endpoints`, thinking levels from `supported_reasoning_levels`, context and output limits from the advertised windows, and vision from `modalities.input`.

This is the path for Docker and remote magpie. Magpie running on the same machine already writes `~/.pi/agent/models.json`; do not install both wirings.

## Install

Install from GitHub:

```bash
pi install git:github.com/p3psi-boo/pi-magpie-provider@master
```

Restart pi after installing, then run:

```text
/login magpie
/model
```

`/login magpie` asks for the gateway URL (default `http://127.0.0.1:3425/v1`) and an optional API key, then checks `GET /v1/models`. That is the only setup step for Docker and remote magpie.

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

Run Pi's provider login:

```text
/login magpie
```

It stores the gateway URL and key in `~/.pi/agent/auth.json`, and writes the URL to:

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

Default base URL is `http://127.0.0.1:3425/v1`. Docker and LAN sharing usually need a reachable host and a magpie gateway key, both collected by `/login magpie`.

Project config supports bounded per-model overrides (`reasoning`, `contextWindow`, `maxTokens`). Connection and auth settings must be set in global config or environment variables.

### Display configuration

Run `/magpie config` in Pi TUI mode to edit package-level `settings.json` values. Gateway URL and API key stay on `/login magpie`; `/magpie config connection` only changes the provider name and default URL.

```json
{
  "pi-magpie-provider": {
    "showStrictMode": false
  }
}
```

## Authenticate

Use Pi's provider login. It collects the gateway URL and key together:

```text
/login magpie
```

Or set the same values in the environment:

```bash
export PI_MAGPIE_BASE_URL=http://127.0.0.1:3425/v1
export PI_MAGPIE_API_KEY=your-gateway-key
```

## Commands

```text
/login magpie              # gateway URL + API key, then catalog check
/magpie status             # show snapshot and capabilities
/magpie refresh            # refresh GET /v1/models and update pi immediately
/magpie models             # inspect effective model settings and set bounded overrides
/magpie config             # display options
/magpie config connection  # provider name and default URL
```

## How discovery works

Startup registers the last-known-good local snapshot under `~/.cache/pi-magpie-provider/`. Pi then refreshes magpie availability; `/login magpie` also fetches the catalog while checking the key, so a separate `/magpie refresh` is not part of setup.

Failed refreshes retain the last-known-good snapshot. Image and video catalog entries are not registered as chat models. An empty catalog before login is expected: the provider still appears under `/login magpie`.

When automatic discovery fails, Pi displays a warning with the model discovery URL and error reason (including the underlying connection error when available). Warnings raised before the session UI is ready are displayed when the session starts. Check the gateway connection and retry with `/login magpie` or `/magpie refresh`.

## Test

```bash
npm test
```

## Release

See [RELEASING.md](RELEASING.md) for versioning and GitHub releases.

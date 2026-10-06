# Pi Magpie Provider

This context defines the language for the pi package that registers one magpie gateway as a pi model provider. Magpie's `/v1/models` catalog is the source of available models and of the metadata used to describe them in pi.

## Language

**magpie gateway**:
One magpie server exposing OpenAI-compatible, Anthropic, and Gemini endpoints at a single base URL. Docker and remote deployments are the same thing: a gateway Pi can reach, that cannot write Pi's `models.json`.
_Avoid_: CLIProxyAPI instance, backend, proxy group

**provider name**:
The pi registry name for the magpie gateway, defaulting to `magpie`. One configured gateway has one provider name.
_Avoid_: Instance name, package name

**model discovery endpoint**:
The magpie `GET <baseUrl>/models` endpoint. It is the only source of available models and of their API, reasoning, window, and vision facts.
_Avoid_: Management API, models.dev catalog, magpie models.json

**available model**:
A chat model ID returned by the model discovery endpoint. Image and video `kind` entries are skipped.
_Avoid_: Supported model, known model, drawer

**native endpoint**:
A path in `native_endpoints` naming an API magpie will pass through without translation, such as `/v1/messages` or `/v1/responses`. Routing groups omit this field.
_Avoid_: owned_by, metadata alias

**registered pi model**:
An available model mapped from magpie catalog fields and passed to `pi.registerProvider()`. Its `id` remains the magpie model ID (`provider/model` or `group/...`).
_Avoid_: models.dev model, alias model

**magpie model snapshot**:
The last successful response from the model discovery endpoint. Startup registers it immediately, then attempts a short background refresh and dynamically updates the provider when availability changes.
_Avoid_: CPA cache, model metadata cache, models.dev snapshot

**gateway key**:
The credential Pi sends as a bearer token to a non-loopback magpie gateway. Docker port mappings usually require one.
_Avoid_: Vendor key, CLIPROXYAPI API key

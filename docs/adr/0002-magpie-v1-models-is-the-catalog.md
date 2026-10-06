# Discover Pi models from magpie GET /v1/models

Accepted. The package discovers available chat models only from magpie's `GET <baseUrl>/models` endpoint and maps that payload onto Pi model definitions. Magpie already fills in `native_endpoints`, `supported_reasoning_levels`, `context_window`, `max_output_tokens`, and `modalities`. Docker magpie cannot write the host's `~/.pi/agent/models.json`, so this package registers the catalog inside Pi.

## Considered Options

- Keep CLIProxyAPI discovery plus models.dev matching. Rejected: magpie IDs are already `provider/model`, and `/v1/models` already carries the facts that matching reconstructed.
- Trust magpie's native Pi adapter to write `models.json`. Rejected for Docker and remote gateways: magpie writes into the process home, which is the container volume, not the user's Pi.
- Fetch a richer magpie-private catalog API. Rejected: there is none. `/v1/magpie/route` and `/v1/magpie/quotas` are runtime, not model specs. Price is intentionally absent from the agent-facing list.

## Consequences

Startup registers the last successful magpie snapshot immediately, then refreshes `/v1/models` in the background. `native_endpoints` selects `openai-responses` or `anthropic-messages`; omitted endpoints stay on the provider default completions API so magpie can translate. Image and video `kind` entries are skipped. Vision follows `modalities.input`. Cost is zero unless a user override supplies it. Claude Messages models still get a stripped `/v1` base URL and `forceAdaptiveThinking`.

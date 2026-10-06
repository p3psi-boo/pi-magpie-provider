# Release guide

Release from a clean local `master` after checks pass. Users install this plugin from GitHub, not npm.

## Check

```bash
npm ci
npm run check
```

## Release

Choose the semantic version increment:

- `patch`: compatible bug fixes, such as `0.1.0` to `0.1.1`
- `minor`: compatible features, such as `0.1.0` to `0.2.0`
- `major`: breaking changes, such as `0.1.0` to `1.0.0`

```bash
npm version patch
git push origin master --follow-tags
```

Replace `patch` with `minor` or `major` when appropriate. `npm version` updates `package.json` and `package-lock.json`, and creates a matching `vX.Y.Z` git tag. Do not publish the plugin to npm.

## Verify

```bash
pi install git:github.com/p3psi-boo/pi-magpie-provider@master
```

Restart Pi and run `/magpie status` to verify that the plugin loads.

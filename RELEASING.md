# Release guide

Publish from a clean local `master` after tests pass. The published version must be unique on npm.

## Prerequisites

- Publish access to the `pi-magpie-provider` package on npm
- A clean local `master` branch

```bash
npm ci
npm test
npm pack --dry-run
```

## Publish

Choose the semantic version increment:

- `patch`: compatible bug fixes, such as `0.1.0` to `0.1.1`
- `minor`: compatible features, such as `0.1.0` to `0.2.0`
- `major`: breaking changes, such as `0.1.0` to `1.0.0`

```bash
npm version patch
npm publish --access public
git push origin master --follow-tags
```

Replace `patch` with `minor` or `major` when appropriate. `npm version` updates `package.json` and `package-lock.json`, and creates a matching `vX.Y.Z` git tag.

The first release creates the npm package. Sign in with `npm login` before `npm publish`.

## Verify

```bash
npm view pi-magpie-provider
pi install npm:pi-magpie-provider
```

The package should appear at <https://pi.dev/packages/pi-magpie-provider> after the gallery indexes the npm release.

## Troubleshooting

### npm reports that the version already exists

npm versions are immutable. Increment the package version, create a new tag, and publish again.

### The package is absent from pi.dev

Confirm that npm published the package publicly and that `package.json` contains the `pi-package` keyword. Gallery indexing may take some time.

# Contributing

## Setup

1. Install Node.js 20 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Fill in your own provider credentials.

## Development

- Run `npm test` before sending a change.
- Use `MOCK_TRANSCRIPT` and `DRY_RUN_TEXT_INJECTION=1` for safe local testing.
- Keep changes scoped; this repo is the host bridge, not the ESP32 firmware.

## Release

### npm package

Package name: `@mac20777/vibecoding-voice`

Recommended release flow:

1. Bump `package.json` and `package-lock.json`.
2. Commit the version bump.
3. Create an annotated tag such as `v0.2.0`.
4. Push branch and tag: `git push origin <branch> --follow-tags`
5. Publish to npm.

Important: on this machine, `NODE_AUTH_TOKEN=... npm publish` was not sufficient for publishing. npm only accepted the token when it was provided through an `.npmrc` entry for the registry.

Use a temporary user config file instead of editing the real user config:

```powershell
$tempNpmrc = Join-Path (Resolve-Path .) '.tmp-npmrc'
Set-Content -Path $tempNpmrc -Value '//registry.npmjs.org/:_authToken=YOUR_TOKEN' -NoNewline
$env:NPM_CONFIG_USERCONFIG = $tempNpmrc
npm publish --cache .npm-cache
Remove-Item Env:NPM_CONFIG_USERCONFIG -ErrorAction SilentlyContinue
Remove-Item $tempNpmrc -ErrorAction SilentlyContinue
```

Notes:

- `npm publish --cache .npm-cache` successfully published `0.1.0` and `0.2.0`.
- If npm returns `EOTP` while using a token, the token is not actually bypassing 2FA for publish.
- Revoke any token that was pasted into chat or shell history after the release is complete.

### GitHub release

After pushing the tag, create the GitHub release, for example:

```powershell
gh release create v0.2.0 --repo macheng2017/vibecoding-voice --title "v0.2.0"
```

## Secrets And Local Data

- Never commit `.env`.
- Do not hardcode provider keys, local usernames, or machine-specific paths.
- Prefer generic defaults like `codex` over absolute local shim paths.

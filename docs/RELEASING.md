# Releasing Figxit

How the owner signs, notarizes, and publishes a release. All steps run on one Mac. Contributors do not need this document: `make dev`, `make build`, and `make test` work with no setup.

This file is not uploaded to figxit.com. The site upload skips `*.md`.

## The workflow

```bash
make dev                    # work on features, ad hoc signed, engine reloads
make build                  # build and sign dist/Figxit.app with the Developer ID
make release                # release the next fix version
make release BUMP=minor     # release the next feature version
make release BUMP=major
```

`make build` is optional before `make release`. The release always builds again, because the version number goes into the app.

The Makefile has only the two main flows: develop (`make dev`, `make test`, `make build`) and publish (`make release`, `make r2`). `make` with no argument lists them. All other tasks are in a second Makefile, `scripts/Makefile`. Run them with `make -C scripts <command>`, and `make -C scripts` lists them. Each one is a script that you can also run directly. The scripts read `.env` by themselves.

| Command | Script | Task |
|---|---|---|
| `make release` | `scripts/release.sh` | The full release |
| `make r2` | `scripts/r2.sh site` | Upload the site |
| `make -C scripts stats` | `scripts/stats.sh show [days]` | Show install counts |
| `make -C scripts stats-deploy` | `scripts/stats.sh deploy` | Upload the Worker that counts installs |
| `make -C scripts r2-ls` | `scripts/r2.sh ls` | List the files in the R2 bucket |
| `make -C scripts cf-forget` | `scripts/r2.sh forget` | Remove the cached Cloudflare token from the keychain |
| `make -C scripts appicon` | `scripts/appicon.sh` | Rebuild the app icon files |
| `make -C scripts shots` | `scripts/shots.sh` | Render the screenshots in `docs/img` |
| `make -C scripts icons` | | Rebuild the product icon set |

## Setup, one time

| Item | Where it is | How to set it |
|---|---|---|
| Developer ID Application certificate | Login keychain | Xcode, Settings, Accounts, Manage Certificates |
| Signing identity | `.env` (git-ignored) | Copy `.env.example` to `.env` and set `SIGN_ID`. No quotes around the value |
| Notary credentials | Login keychain, profile `figxit` | `xcrun notarytool store-credentials figxit` with the Apple ID, the team ID, and an app-specific password |
| Sparkle private key | Login keychain | `helper/.build/artifacts/sparkle/Sparkle/bin/generate_keys`. The public key is `SUPublicEDKey` in `helper/Info.plist` |
| Cloudflare token | 1Password. `CF_TOKEN_REF` in `.env` is the reference to it (`op://vault/item/field`) | Set `CF_TOKEN_REF` in `.env` |
| Tools | Homebrew | `op`, `aws`, `gh` (logged in), `create-dmg`, `rsvg-convert`, `bun` |

Keep a copy of the Sparkle private key in 1Password. Without it, installed apps cannot accept a new update. Export it with:

```bash
helper/.build/artifacts/sparkle/Sparkle/bin/generate_keys -x sparkle-private-key.txt
```

Delete the exported file after you save it.

## What `make release` does

1. Stops if `SIGN_ID` is not set, if the repository has no commit, or if there are uncommitted changes.
2. Sets the version in `engine/package.json`. See "Versions".
3. Builds the app and signs it with the Developer ID and the hardened runtime.
4. Sends the app to the Apple notary service, waits, and staples the ticket to the app.
5. Builds the disk image, signs it, notarizes it, and staples it.
6. Copies the disk image to `releases/Figxit-<version>.dmg`.
7. Writes `docs/appcast.xml` from all disk images in `releases/`, signed with the Sparkle key.
8. Uploads to R2. See "What goes to R2".
9. Commits `engine/package.json` and `docs/appcast.xml` as `release v<version>`, makes the tag, and pushes both.
10. Makes the GitHub release with the disk image attached and generated notes.

The two notary steps take most of the time, usually 2 to 10 minutes each.

## Versions

- `engine/package.json` holds the version. The build copies it into the app.
- If the current version has a git tag, the release adds 1 to the number that `BUMP` names: `patch` (default), `minor`, or `major`.
- If the current version has no git tag, the release uses it with no change. This is how 0.0.1 is released, and how a failed release is repeated with the same number.

## What goes to R2

Bucket `figxit-prod`, served at figxit.com.

| Path | Source | Cache |
|---|---|---|
| `/` (site, `appcast.xml`) | `docs/`, without `*.md` and hidden files | 5 minutes |
| `/download/Figxit-<version>.dmg` and `*.delta` | `releases/` | 1 year, never changes |
| `/download/Figxit.dmg` | The newest disk image | 5 minutes |

The site upload deletes remote files that are not in `docs/`, but it does not touch `/download/`.

`make r2` uploads only the site. Use it for a text change with no new release.

`scripts/r2.sh ls` lists the bucket.

## Cloudflare credentials

No Cloudflare value is in the repository. `.env` (git-ignored) holds `CF_TOKEN_REF`, the 1Password reference to the API token. The token itself is not in a file.

The first Cloudflare command reads the token with `op read` (one 1Password prompt). If `CF_TOKEN_REF` is not set, the command asks for the token in the terminal, and the input is not shown. The script then saves three values in the login keychain, service `figxit-cf`:

| Name | Value |
|---|---|
| `token` | The API token |
| `account` | The account id, found from the zone figxit.com |
| `key-id` | The token id, used as the R2 access key |

Later commands read the keychain and do not prompt. After a token change, run `scripts/r2.sh forget`. The next command reads the new token.

R2 uploads use `aws s3` with the R2 endpoint. R2 accepts an API token as S3 keys: the access key is the token id, and the secret is the SHA-256 of the token.

## How updates reach users

The app reads `https://figxit.com/appcast.xml` (`SUFeedURL` in `helper/Info.plist`) one time each day and when the user selects **Check for Updates**. If the feed has a newer version, Sparkle downloads the disk image, checks its signature against `SUPublicEDKey`, and replaces the app.

`releases/` must keep the old disk images. The feed is built from that folder, and Sparkle makes small delta files between versions from it. The folder is git-ignored and `make clean` does not remove it. The GitHub releases are the backup.

## Install counts

The app has no telemetry: it does not report what the user types or does. The counts come from two requests that exist with or without the counter: the daily update check and the download of the app file.

A Cloudflare Worker, `worker/stats.ts`, runs on two routes of figxit.com: `/appcast.xml` and `/download/*`. It passes each request to R2 with no change and writes one data point to Workers Analytics Engine, dataset `figxit`.

| Kind | When | What is stored |
|---|---|---|
| `check` | The app reads the update feed, about one time each day for each install | The installed app version |
| `install` | A browser downloads `Figxit.dmg` or a versioned image | The file version |
| `update` | The app downloads an image or a delta | The old and the new version |

Nothing else is stored: no IP address, no country, no identifier. Feed requests from a browser or a bot are not counted. The counts are approximate. An install that is closed for a day is not counted that day.

The user can clear **Check for Updates Automatically** in the menu. Then the app makes no request and is not counted.

What we say in public, and it must stay true: "Figxit has no telemetry. Its only network request is the daily update check. We count those checks by app version." If the Worker stores more than the table above, change the README and the landing page first.

```bash
scripts/stats.sh deploy    # upload the Worker and add the two routes, needed one time and after a change
scripts/stats.sh show           # counts for the last 14 days
scripts/stats.sh show 30
```

Both commands use the cached Cloudflare token, see "Cloudflare credentials". The token needs the Workers Scripts, Workers Routes, and Account Analytics permissions.

After a deploy, check it:

1. `curl -sI https://figxit.com/appcast.xml` returns 200.
2. Download `Figxit.dmg` one time in a browser.
3. Wait one minute, then `scripts/stats.sh show` shows one `install` row.

If the first update shows as `install` and not `update`, the Sparkle downloader did not send the app User-Agent. Change `classify` in the Worker.

## Cost and abuse limits

What can cost money: only R2 reads. The Workers plan is the free plan, which stops at its daily request limit and cannot make a bill. R2 has no charge for data transfer. R2 reads cost money above 10 million each month.

| Risk | Control |
|---|---|
| A flood reaches the Workers daily limit and blocks downloads | Both routes are set to fail open by `scripts/stats.sh deploy`. Above the limit, requests skip the Worker and go to R2. Counting stops, downloads continue |
| A flood of requests reads from R2 each time | The disk images are cached at the Cloudflare edge. Add the cache rule below so the site and the feed are cached too |
| One client sends many requests | Add the rate limit rule below |
| A bill grows with no notice | Add the billing notification below |

Set these three in the Cloudflare dashboard, one time. The API token cannot set them.

1. **Cache rule.** figxit.com, Caching, Cache Rules, Create rule. When: Hostname equals `figxit.com`. Then: Eligible for cache, Edge TTL "Use cache-control header if present". The site and the feed are then served from the edge for 5 minutes at a time.
2. **Rate limit rule.** figxit.com, Security, WAF, Rate limiting rules, Create rule. When: Hostname equals `figxit.com`. Rate: 100 requests in 10 seconds for each IP address. Action: Block for 10 seconds. The free plan has one such rule.
3. **Billing notification.** Manage Account, Notifications, Add, "Billing: Usage Based Billing". Product: R2. Set a low threshold, so you get an email long before a cost.

The counts can be inflated by a person who sends requests with the app name. They are a guide, not an exact number.

## Checks after a release

```bash
curl -sI https://figxit.com/download/Figxit.dmg | head -5
```

```bash
curl -s https://figxit.com/appcast.xml | grep -E "<title>|sparkle:version"
```

Then open an installed older version and select **Check for Updates**.

## When a release fails

| Failure | What to do |
|---|---|
| Stops before the upload (build, signing, notary) | Fix the cause and run `make release` again. The version stays the same |
| Notary result is `Invalid` | `xcrun notarytool log <submission id> --keychain-profile figxit` shows the reason |
| "Could not verify the Cloudflare token" | The token is wrong or expired. Fix it in 1Password, then `scripts/r2.sh forget` |
| Upload fails | Run `make release` again. Nothing was tagged |
| Push or GitHub release fails after the tag | The files are on R2 already. Run the last steps by hand: `git push origin HEAD v<version>` and `gh release create v<version> releases/Figxit-<version>.dmg --generate-notes` |

Do not run `make release` again after the tag exists unless you want the next version.

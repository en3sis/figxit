-include .env

SIGN_ID ?= -
BUMP ?= patch

export SIGN_ID NOTARY_PROFILE CF_TOKEN_REF R2_BUCKET SITE_URL

.DEFAULT_GOAL := help
.PHONY: help dev test e2e smoke stop clean build dmg release r2

help: ## List the commands
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  make %-14s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

##@ Develop

dev: ## Run the helper and the engine from source, with reload. Ctrl-C stops both
	@scripts/dev.sh

test: ## Run the unit tests
	cd engine && bun test

e2e: ## Run the end-to-end test in a private tmux server
	cd engine && bun run test/e2e.ts

smoke: ## Build the app, then test the bundle and the figxit command
	@SIGN_ID=- scripts/build.sh
	cd engine && bun run test/bundle.ts

stop: ## Stop the helper and the engine
	@pkill -x figxit-helper; pkill -x figxit-engine; true

clean: stop ## Remove the build output. Released versions in dist/Figxit-<version>/ stay
	rm -rf dist/Figxit.app dist/Figxit.dmg dist/dmg dist/feed helper/.build

##@ Build

build: ## Build dist/Figxit.app. Signed with SIGN_ID from .env, or ad hoc
	@scripts/build.sh

dmg: build ## Build dist/Figxit.dmg with the drag-to-Applications window
	@scripts/dmg.sh

##@ Release (owner only, see docs/RELEASING.md)

release: ## Publish the app: build, sign, notarize, upload, tag, GitHub release. BUMP=patch|minor|major
	@scripts/release.sh $(BUMP)

r2: ## Publish the site only: upload docs/ to R2. No build, no tag
	@scripts/r2.sh site

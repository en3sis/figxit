-include .env

SIGN_ID ?= -
BUMP ?= patch

export SIGN_ID NOTARY_PROFILE CF_TOKEN_REF R2_BUCKET SITE_URL

.DEFAULT_GOAL := help
.PHONY: help dev site test e2e smoke stop clean build dmg release r2

help: ## List the commands
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  make %-14s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

##@ Develop

dev: ## Run the helper and the engine from source, with reload. Ctrl-C stops both
	@scripts/dev.sh

site: ## Serve docs/ at http://localhost:4174 and open it. PORT=<n> to change. Ctrl-C stops it
	@(sleep 1; open http://localhost:$(or $(PORT),4174)) & python3 -m http.server $(or $(PORT),4174) --directory docs

test: ## Run the unit tests
	cd engine && bun test

e2e: ## Run the end-to-end test for zsh, bash, and fish, with and without tmux geometry, all at the same time
	@cd engine && logs=$$(mktemp -d) && pids= && \
	for shell in zsh bash fish; do for plain in "" 1; do \
		FIGXIT_E2E_SHELL=$$shell FIGXIT_E2E_PLAIN=$$plain bun run test/e2e.ts >$$logs/$$shell$$plain.log 2>&1 & pids="$$pids $$!"; \
	done; done; \
	status=0; for pid in $$pids; do wait $$pid || status=1; done; \
	cat $$logs/*.log; rm -rf $$logs; exit $$status

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

release: ## [prod] Publish the app: build, sign, notarize, upload, tag, GitHub release. BUMP=patch|minor|major
	@scripts/release.sh $(BUMP)

r2: ## [prod] Publish the site only: upload docs/ to R2. No build, no tag
	@scripts/r2.sh site

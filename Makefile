-include .env

SIGN_ID ?= -
BUMP ?= patch

export SIGN_ID NOTARY_PROFILE

.DEFAULT_GOAL := help
.PHONY: help dev test e2e smoke stop clean build dmg

help: ## List the commands
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  make %-14s %s\n", $$1, $$2}' $(filter-out .env,$(MAKEFILE_LIST))

##@ Develop

dev: ## Run the helper and the engine from source, with reload. Ctrl-C stops both
	@scripts/dev.sh

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

-include internal/local.mk

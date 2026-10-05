DAYS ?= 14

.DEFAULT_GOAL := help
.PHONY: help stats stats-deploy r2-ls cf-forget icons appicon shots

help: ## List the commands. Run them as: make -C scripts <command>
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  make -C scripts %-14s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

##@ Cloudflare

stats: ## Show install counts. DAYS=14
	@./stats.sh show $(DAYS)

stats-deploy: ## Upload the Worker that counts installs
	@./stats.sh deploy

r2-ls: ## List the files in the R2 bucket
	@./r2.sh ls

cf-forget: ## Remove the cached Cloudflare token from the keychain
	@./r2.sh forget

##@ Assets

icons: ## Rebuild the product icon set from Simple Icons
	cd ../engine && bun run scripts/icons.ts

appicon: ## Rebuild the app icon and the PNG exports in docs/icon
	@./appicon.sh

shots: ## Render the screenshots in docs/img
	@./shots.sh

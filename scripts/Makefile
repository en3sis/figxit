.DEFAULT_GOAL := help
.PHONY: help icons appicon shots dmg-layout

help: ## List the commands. Run them as: make -C scripts <command>
	@awk 'BEGIN {FS = ":.*## "} /^##@/ {printf "\n%s\n", substr($$0, 5)} /^[a-z0-9-]+:.*## / {printf "  make -C scripts %-14s %s\n", $$1, $$2}' $(firstword $(MAKEFILE_LIST))

##@ Assets

icons: ## Rebuild the product icon set from Simple Icons
	cd ../engine && bun run scripts/icons.ts

appicon: ## Rebuild the app icon and the PNG exports in internal/docs/icon
	@./appicon.sh

shots: ## Render the screenshots in internal/docs/img
	@./shots.sh

dmg-layout: ## Rebuild helper/Resources/dmg.DS_Store, the disk image window layout. Uses Finder. Run it after changing the background or the icon positions
	@./dmg-layout.sh

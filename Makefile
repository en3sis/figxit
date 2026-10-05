-include .env

APP := dist/Figxit.app
SPECS := engine/node_modules/@withfig/autocomplete/build
SPECS_SKIP := aws aws.js az az.js gcloud gcloud.js
VERSION := $(shell sed -n 's/.*"version": "\(.*\)".*/\1/p' engine/package.json)
BUMP ?= patch
SIGN_ID ?= -

export SIGN_ID NOTARY_PROFILE CF_TOKEN_REF R2_BUCKET SITE_URL

.PHONY: dev build helper engine bundle icons appicon shots video test e2e smoke dmg release site r2-ls cf-forget stats stats-deploy run-helper stop-helper stop spike clean

dev shots smoke run-helper spike: SIGN_ID = -

dev: helper stop
	@mkdir -p $(HOME)/.local/state/figxit && touch $(HOME)/.local/state/figxit/stopped
	@trap 'kill $$HELPER 2>/dev/null; exit 0' INT TERM EXIT; \
	FIGXIT_NO_ENGINE=1 $(APP)/Contents/MacOS/figxit-helper & HELPER=$$!; \
	cd engine && bun --watch src/main.ts daemon

build: helper engine bundle

helper:
	cd helper && xcrun swift build -c release
	mkdir -p $(APP)/Contents/MacOS $(APP)/Contents/Resources
	cp helper/.build/release/figxit-helper $(APP)/Contents/MacOS/figxit-helper
	cp helper/Info.plist $(APP)/Contents/Info.plist
	/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $(VERSION)" -c "Set :CFBundleVersion $(VERSION)" $(APP)/Contents/Info.plist
	rm -rf $(APP)/Contents/Frameworks $(APP)/Contents/Resources/icons
	mkdir -p $(APP)/Contents/Frameworks
	cp -R helper/.build/release/Sparkle.framework $(APP)/Contents/Frameworks/Sparkle.framework
	cp -R helper/Resources/icons $(APP)/Contents/Resources/icons
	cp helper/Resources/AppIcon.icns $(APP)/Contents/Resources/AppIcon.icns
	@scripts/sign.sh

engine:
	mkdir -p $(APP)/Contents/MacOS
	cd engine && bun build --compile src/main.ts --outfile ../$(APP)/Contents/MacOS/figxit-engine

bundle:
	mkdir -p $(APP)/Contents/Resources/specs $(APP)/Contents/Resources/shell/zsh
	rsync -a --delete $(addprefix --exclude=,$(SPECS_SKIP)) $(SPECS)/ $(APP)/Contents/Resources/specs/
	cp shell/zsh/figxit.zsh $(APP)/Contents/Resources/shell/zsh/figxit.zsh
	@scripts/sign.sh

dmg: build
	@scripts/dmg.sh

release:
	@scripts/release.sh $(BUMP)

site:
	@scripts/r2.sh site

r2-ls:
	@scripts/r2.sh ls

cf-forget:
	@scripts/r2.sh forget

stats:
	@scripts/stats.sh show $(DAYS)

stats-deploy:
	@scripts/stats.sh deploy

icons:
	cd engine && bun run scripts/icons.ts

appicon:
	@scripts/appicon.sh

shots: helper
	cd engine && bun run scripts/shots.ts

video:
	bun run video/render.ts video/silent.mp4
	mkdir -p docs/assets
	bun run video/sound.ts video/silent.mp4 docs/assets/figxit.mp4

beats:
	mkdir -p video/beats
	for n in 1 2 3 4 5; do STYLE=$$n bun run video/sound.ts video/silent.mp4 video/beats/figxit-beat-$$n.mp4; done

test:
	cd engine && bun test

e2e:
	cd engine && bun run test/e2e.ts

smoke: build
	cd engine && bun run test/bundle.ts

stop-helper:
	-pkill -x figxit-helper

stop: stop-helper
	-pkill -x figxit-engine

run-helper: helper stop-helper
	open -g $(APP)

spike: run-helper
	zsh shell/zsh/spike.zsh

clean: stop
	rm -rf dist helper/.build

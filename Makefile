PROJECT = Fuzzy Tab.xcodeproj
SCHEME = Fuzzy Tab
ARCHIVE = .derived/FuzzyTab.xcarchive

# App Store Connect only accepts a build number once, so every upload needs a
# fresh one. Passed on the command line, so no pbxproj churn per release.
BUILD ?= $(shell date +%Y%m%d%H%M)

# App Store Connect API key (Users and Access → Integrations → App Store Connect API).
ASC_KEY_PATH ?= $(HOME)/.appstoreconnect/private_keys/AuthKey_$(ASC_KEY_ID).p8

.PHONY: test build archive upload release

test:
	node --test "tests/*.test.mjs"
	xcodebuild test -project "$(PROJECT)" -scheme "$(SCHEME)" \
		-only-testing:"Fuzzy TabTests" -derivedDataPath .derived/test

build:
	xcodebuild -project "$(PROJECT)" -scheme "$(SCHEME)" build \
		-derivedDataPath .derived/build

archive:
	rm -rf "$(ARCHIVE)"
	xcodebuild archive -project "$(PROJECT)" -scheme "$(SCHEME)" \
		-archivePath "$(ARCHIVE)" -derivedDataPath .derived/archive \
		CURRENT_PROJECT_VERSION=$(BUILD)

upload:
	xcodebuild -exportArchive -archivePath "$(ARCHIVE)" \
		-exportOptionsPlist scripts/ExportOptions.plist -exportPath .derived/export \
		-authenticationKeyPath "$(ASC_KEY_PATH)" \
		-authenticationKeyID "$(ASC_KEY_ID)" \
		-authenticationKeyIssuerID "$(ASC_ISSUER_ID)"

release: test archive upload

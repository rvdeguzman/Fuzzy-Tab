PROJECT = Fuzzy Tab.xcodeproj
SCHEME = Fuzzy Tab
ARCHIVE = .derived/FuzzyTab.xcarchive

# App Store Connect only accepts a build number once, so every upload needs a
# fresh one. Passed on the command line, so no pbxproj churn per release.
BUILD ?= $(shell date +%Y%m%d%H%M)

# Version comes from the git tag (v1.0.3 → 1.0.3), so the tag is the single
# source of truth. Falls back to the pbxproj value outside a tagged checkout.
VERSION ?= $(shell git describe --tags --abbrev=0 --match 'v*' 2>/dev/null | sed 's/^v//')
ifneq ($(VERSION),)
VERSION_ARG = MARKETING_VERSION=$(VERSION)
endif

# App Store Connect API key (Users and Access → Integrations → App Store Connect API).
ASC_KEY_PATH ?= $(HOME)/.appstoreconnect/private_keys/AuthKey_$(ASC_KEY_ID).p8

# Only pass API-key auth when it is configured: on a dev machine Xcode's own
# account handles signing, on CI there is no account and the key is required.
ifneq ($(ASC_KEY_ID),)
AUTH = -authenticationKeyPath "$(ASC_KEY_PATH)" \
	-authenticationKeyID "$(ASC_KEY_ID)" \
	-authenticationKeyIssuerID "$(ASC_ISSUER_ID)" \
	-allowProvisioningUpdates
endif

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
		$(AUTH) CURRENT_PROJECT_VERSION=$(BUILD) $(VERSION_ARG)

upload:
	xcodebuild -exportArchive -archivePath "$(ARCHIVE)" \
		-exportOptionsPlist scripts/ExportOptions.plist -exportPath .derived/export \
		$(AUTH)

release: test archive upload

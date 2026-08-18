#!/usr/bin/env python3
"""Create an App Store version, attach the newest build, optionally submit it.

Uses the App Store Connect API with the same .p8 key the release workflow
signs with. Stdlib only: the ES256 JWT is signed by shelling out to openssl,
so there is nothing to pip install on a runner.

    scripts/asc-submit.py 1.0.3 --notes "Fixes the popup..."   # prepare only
    scripts/asc-submit.py 1.0.3 --notes "..." --submit         # + start review
"""

import argparse
import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"
BUNDLE_ID = "rvdeguzman.Fuzzy-Tab"
PLATFORM = "MAC_OS"


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def der_to_jose(der: bytes) -> bytes:
    """ECDSA signatures come out of openssl as DER; JWS wants raw r||s."""
    if der[0] != 0x30:
        raise ValueError("not a DER sequence")
    i = 2 + (2 if der[1] & 0x80 else 0)  # skip long-form length bytes

    def read_int(pos):
        assert der[pos] == 0x02, "expected DER INTEGER"
        length = der[pos + 1]
        value = der[pos + 2 : pos + 2 + length].lstrip(b"\x00")
        return value.rjust(32, b"\x00"), pos + 2 + length

    r, i = read_int(i)
    s, _ = read_int(i)
    return r + s


def token() -> str:
    key_id = os.environ["ASC_KEY_ID"]
    issuer = os.environ["ASC_ISSUER_ID"]
    key_path = os.environ.get(
        "ASC_KEY_PATH",
        os.path.expanduser(f"~/.appstoreconnect/private_keys/AuthKey_{key_id}.p8"),
    )
    now = int(time.time())
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    payload = {"iss": issuer, "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"}
    signing_input = ".".join(
        b64url(json.dumps(part, separators=(",", ":")).encode())
        for part in (header, payload)
    ).encode()
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path],
        input=signing_input,
        capture_output=True,
        check=True,
    ).stdout
    return f"{signing_input.decode()}.{b64url(der_to_jose(der))}"


def call(method: str, path: str, body=None):
    url = path if path.startswith("http") else f"{API}{path}"
    request = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body else None,
        headers={
            "Authorization": f"Bearer {token()}",
            "Content-Type": "application/json",
        },
    )
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode()
        sys.exit(f"{method} {url} -> {error.code}\n{detail}")


def app_id() -> str:
    apps = call("GET", f"/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        sys.exit(f"No app record for {BUNDLE_ID}")
    return apps[0]["id"]


def newest_valid_build(app: str, wait_minutes: int) -> str:
    """Builds sit in PROCESSING for ~5-15 min after upload, so poll."""
    deadline = time.time() + wait_minutes * 60
    while True:
        builds = call(
            "GET",
            f"/builds?filter[app]={app}&sort=-uploadedDate&limit=1"  # not -version: build numbers sort as strings
            "&fields[builds]=version,processingState",
        )["data"]
        if not builds:
            sys.exit("No builds found; upload one first with `make release`.")
        build = builds[0]
        state = build["attributes"]["processingState"]
        version = build["attributes"]["version"]
        if state == "VALID":
            print(f"build {version} is VALID")
            return build["id"]
        if state in ("INVALID", "FAILED"):
            sys.exit(f"build {version} is {state}; check the ASC activity log")
        if time.time() > deadline:
            sys.exit(f"build {version} still {state} after {wait_minutes} min")
        print(f"build {version} is {state}, waiting…")
        time.sleep(30)


def editable_version(app: str, version_string: str) -> str:
    """Reuse the in-progress version record if one exists, else create it."""
    existing = call(
        "GET",
        f"/apps/{app}/appStoreVersions?filter[platform]={PLATFORM}"
        f"&filter[versionString]={version_string}&limit=1",
    )["data"]
    if existing:
        state = existing[0]["attributes"]["appStoreState"]
        print(f"reusing version {version_string} ({state})")
        return existing[0]["id"]
    created = call(
        "POST",
        "/appStoreVersions",
        {
            "data": {
                "type": "appStoreVersions",
                "attributes": {"platform": PLATFORM, "versionString": version_string},
                "relationships": {"app": {"data": {"type": "apps", "id": app}}},
            }
        },
    )
    print(f"created version {version_string}")
    return created["data"]["id"]


def set_release_notes(version: str, notes: str) -> None:
    for localization in call(
        "GET", f"/appStoreVersions/{version}/appStoreVersionLocalizations"
    )["data"]:
        call(
            "PATCH",
            f"/appStoreVersionLocalizations/{localization['id']}",
            {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "id": localization["id"],
                    "attributes": {"whatsNew": notes},
                }
            },
        )
        print(f"release notes set for {localization['attributes']['locale']}")


def attach_build(version: str, build: str) -> None:
    # Export compliance: the app ships no encryption of its own and only makes
    # HTTPS requests, so it is exempt. Without this answer App Review refuses
    # the version with ENTITY_ERROR.ATTRIBUTE.REQUIRED. Apple rejects a second
    # write, so only answer when it is still unset.
    answered = call(
        "GET", f"/builds/{build}?fields[builds]=usesNonExemptEncryption"
    )["data"]["attributes"]["usesNonExemptEncryption"]
    if answered is None:
        call(
            "PATCH",
            f"/builds/{build}",
            {
                "data": {
                    "type": "builds",
                    "id": build,
                    "attributes": {"usesNonExemptEncryption": False},
                }
            },
        )
        print("export compliance answered (exempt)")
    call(
        "PATCH",
        f"/appStoreVersions/{version}/relationships/build",
        {"data": {"type": "builds", "id": build}},
    )
    print("build attached")


def submit(app: str, version: str) -> None:
    submission = call(
        "POST",
        "/reviewSubmissions",
        {
            "data": {
                "type": "reviewSubmissions",
                "attributes": {"platform": PLATFORM},
                "relationships": {"app": {"data": {"type": "apps", "id": app}}},
            }
        },
    )["data"]["id"]
    call(
        "POST",
        "/reviewSubmissionItems",
        {
            "data": {
                "type": "reviewSubmissionItems",
                "relationships": {
                    "reviewSubmission": {
                        "data": {"type": "reviewSubmissions", "id": submission}
                    },
                    "appStoreVersion": {
                        "data": {"type": "appStoreVersions", "id": version}
                    },
                },
            }
        },
    )
    call(
        "PATCH",
        f"/reviewSubmissions/{submission}",
        {
            "data": {
                "type": "reviewSubmissions",
                "id": submission,
                "attributes": {"submitted": True},
            }
        },
    )
    print("submitted for review")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("version", help="marketing version, e.g. 1.0.3")
    parser.add_argument("--notes", help="release notes ('What's New')")
    parser.add_argument("--submit", action="store_true", help="start App Review")
    parser.add_argument("--wait", type=int, default=30, help="minutes to wait for processing")
    args = parser.parse_args()

    app = app_id()
    build = newest_valid_build(app, args.wait)
    version = editable_version(app, args.version)
    if args.notes:
        set_release_notes(version, args.notes)
    attach_build(version, build)

    if args.submit:
        submit(app, version)
    else:
        print("prepared but not submitted; re-run with --submit to start review")


if __name__ == "__main__":
    main()

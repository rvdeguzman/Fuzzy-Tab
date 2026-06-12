//
//  Fuzzy_TabTests.swift
//  Fuzzy TabTests
//
//  Created by rv on 2026-03-28.
//

import Foundation
import Testing

/// Validates the web-extension resources that ship inside the extension
/// bundle: the manifest must stay coherent (every file it references must
/// exist) and the keyboard-shortcut contract must hold. Reads from the
/// source tree via #filePath so failures point at the file you edit.
///
/// The fuzzy-matching logic itself is JavaScript; its unit tests run with
/// `node --test "tests/*.test.mjs"` from the repo root.
struct ExtensionResourceTests {

    static let resourcesURL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()  // Fuzzy TabTests/
        .deletingLastPathComponent()  // repo root
        .appendingPathComponent("Fuzzy Tab Extension/Resources")

    private func loadJSON(at relativePath: String) throws -> [String: Any] {
        let url = Self.resourcesURL.appendingPathComponent(relativePath)
        let data = try Data(contentsOf: url)
        let object = try JSONSerialization.jsonObject(with: data)
        return try #require(object as? [String: Any], "\(relativePath) must contain a JSON object")
    }

    private func resourceExists(_ relativePath: String) -> Bool {
        FileManager.default.fileExists(
            atPath: Self.resourcesURL.appendingPathComponent(relativePath).path
        )
    }

    @Test func manifestIsValidManifestV3() throws {
        let manifest = try loadJSON(at: "manifest.json")
        #expect(manifest["manifest_version"] as? Int == 3)
        #expect(manifest["name"] as? String == "__MSG_extension_name__")
        #expect((manifest["version"] as? String)?.isEmpty == false)
    }

    @Test func permissionsStayMinimal() throws {
        let manifest = try loadJSON(at: "manifest.json")
        let permissions = try #require(manifest["permissions"] as? [String])
        #expect(Set(permissions) == ["tabs", "storage"], "New permissions need a deliberate decision, not drift")
    }

    @Test func everyDeclaredIconExists() throws {
        let manifest = try loadJSON(at: "manifest.json")

        let icons = try #require(manifest["icons"] as? [String: String])
        let action = try #require(manifest["action"] as? [String: Any])
        let actionIcons = try #require(action["default_icon"] as? [String: String])

        for path in Set(icons.values).union(actionIcons.values) {
            #expect(resourceExists(path), "manifest references missing icon: \(path)")
        }
    }

    @Test func popupResourcesExist() throws {
        let manifest = try loadJSON(at: "manifest.json")
        let action = try #require(manifest["action"] as? [String: Any])
        let popup = try #require(action["default_popup"] as? String)

        #expect(resourceExists(popup))
        for companion in ["popup.css", "popup.js", "fuzzy.js"] {
            #expect(resourceExists(companion), "popup depends on missing file: \(companion)")
        }
    }

    @Test func backgroundScriptExists() throws {
        let manifest = try loadJSON(at: "manifest.json")
        let background = try #require(manifest["background"] as? [String: Any])
        let worker = try #require(background["service_worker"] as? String)
        #expect(resourceExists(worker))
    }

    @Test func keyboardShortcutIsConfigured() throws {
        let manifest = try loadJSON(at: "manifest.json")
        let commands = try #require(manifest["commands"] as? [String: Any])
        let execute = try #require(commands["_execute_action"] as? [String: Any])
        let keys = try #require(execute["suggested_key"] as? [String: String])

        #expect(keys["mac"] == "Command+Shift+K")
        #expect(keys["default"]?.isEmpty == false)
    }

    @Test func localizedStringsArePresent() throws {
        let messages = try loadJSON(at: "_locales/en/messages.json")

        for key in ["extension_name", "extension_description"] {
            let entry = try #require(messages[key] as? [String: Any], "missing locale key: \(key)")
            let value = try #require(entry["message"] as? String)
            #expect(!value.isEmpty)
        }
    }

    @Test func popupMarkupReferencesItsModules() throws {
        let url = Self.resourcesURL.appendingPathComponent("popup.html")
        let html = try String(contentsOf: url, encoding: .utf8)

        #expect(html.contains("popup.css"))
        #expect(html.contains("popup.js"))
        #expect(html.contains(#"type="module""#), "popup.js uses ES module imports")
    }

}

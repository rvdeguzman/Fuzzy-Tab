//
//  ViewController.swift
//  Fuzzy Tab
//
//  Created by rv on 2026-03-28.
//

import Cocoa
import OSLog
import SafariServices
import WebKit

/// Hosts the status page that tells the user whether the Safari extension
/// is enabled and offers a shortcut to Safari's extension settings.
class ViewController: NSViewController, WKNavigationDelegate, WKScriptMessageHandler {

    private enum Extension {
        static let bundleIdentifier = "rvdeguzman.Fuzzy-Tab.Extension"
    }

    private enum Message {
        static let handlerName = "controller"
        static let openPreferences = "open-preferences"
    }

    private let logger = Logger(subsystem: "rvdeguzman.Fuzzy-Tab", category: "status-page")

    @IBOutlet var webView: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()

        webView.navigationDelegate = self
        webView.configuration.userContentController.add(self, name: Message.handlerName)

        guard let pageURL = Bundle.main.url(forResource: "Main", withExtension: "html"),
              let resourceURL = Bundle.main.resourceURL else {
            logger.error("Status page resources are missing from the app bundle.")
            return
        }

        webView.loadFileURL(pageURL, allowingReadAccessTo: resourceURL)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: Extension.bundleIdentifier) { [weak self] state, error in
            guard let state, error == nil else {
                // Leave the page in its default "state unknown" copy.
                self?.logger.error("Could not read extension state: \(error?.localizedDescription ?? "unknown error")")
                return
            }

            DispatchQueue.main.async {
                webView.evaluateJavaScript("show(\(state.isEnabled), true)")
            }
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? String, body == Message.openPreferences else {
            return
        }

        SFSafariApplication.showPreferencesForExtension(withIdentifier: Extension.bundleIdentifier) { _ in
            DispatchQueue.main.async {
                NSApplication.shared.terminate(nil)
            }
        }
    }

}

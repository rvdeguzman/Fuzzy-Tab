//
//  SafariWebExtensionHandler.swift
//  Fuzzy Tab Extension
//
//  Created by rv on 2026-03-28.
//

import OSLog
import SafariServices

/// Receives `browser.runtime.sendNativeMessage` calls from the extension's
/// JavaScript. The extension currently does all of its work in JS, so this
/// handler just echoes messages back to keep the native channel verifiable.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {

    private let logger = Logger(subsystem: "rvdeguzman.Fuzzy-Tab.Extension", category: "native-messaging")

    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey]

        logger.debug("Received native message: \(String(describing: message), privacy: .private)")

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: ["echo": message ?? NSNull()]]
        context.completeRequest(returningItems: [response])
    }

}

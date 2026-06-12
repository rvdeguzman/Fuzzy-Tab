#!/usr/bin/env swift
//
//  generate-icons.swift
//  Renders the Fuzzy Tab icon at every size the project needs.
//
//  Design: a magnifying glass over a stack of result rows — the middle row
//  is the fuzzy "match" at full brightness — on a blue gradient squircle.
//  Detail drops away at small sizes so the glyph stays legible at 16 px.
//
//  Run from the repo root:  swift scripts/generate-icons.swift
//

import AppKit

let repoRoot = FileManager.default.currentDirectoryPath

struct IconSpec {
    let path: String
    let pixels: Int
    /// Transparent margin around the squircle as a fraction of the canvas.
    let margin: CGFloat
}

let appIconDir = "Fuzzy Tab/Assets.xcassets/AppIcon.appiconset"
let webIconDir = "Fuzzy Tab Extension/Resources/images"

var specs: [IconSpec] = []

// macOS app icon — Apple's standard ~10% margin around the squircle.
let appIconSizes: [(String, Int)] = [
    ("icon_16x16.png", 16), ("icon_16x16@2x.png", 32),
    ("icon_32x32.png", 32), ("icon_32x32@2x.png", 64),
    ("icon_128x128.png", 128), ("icon_128x128@2x.png", 256),
    ("icon_256x256.png", 256), ("icon_256x256@2x.png", 512),
    ("icon_512x512.png", 512), ("icon_512x512@2x.png", 1024),
]
for (name, px) in appIconSizes {
    specs.append(IconSpec(path: "\(appIconDir)/\(name)", pixels: px, margin: 0.098))
}

// Web extension icons — near-full bleed; Safari renders these in its own chrome.
for px in [16, 32, 48, 64, 96, 128, 256, 512] {
    specs.append(IconSpec(path: "\(webIconDir)/icon-\(px).png", pixels: px, margin: 0.03))
}

// Host app status page icon (shown at 128 pt, render 2x for retina).
specs.append(IconSpec(path: "Fuzzy Tab/Resources/Icon.png", pixels: 256, margin: 0.0))

func srgb(_ r: CGFloat, _ g: CGFloat, _ b: CGFloat, _ a: CGFloat = 1) -> CGColor {
    CGColor(colorSpace: CGColorSpace(name: CGColorSpace.sRGB)!, components: [r, g, b, a])!
}

func render(spec: IconSpec) -> Data {
    let px = spec.pixels
    let space = CGColorSpace(name: CGColorSpace.sRGB)!
    let ctx = CGContext(
        data: nil, width: px, height: px,
        bitsPerComponent: 8, bytesPerRow: 0, space: space,
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
    )!

    // Draw in a 1024-unit design space regardless of output size.
    let unit = CGFloat(px) / 1024
    ctx.scaleBy(x: unit, y: unit)
    ctx.setAllowsAntialiasing(true)
    ctx.interpolationQuality = .high

    // ── Background squircle with vertical blue gradient ──
    let inset = 1024 * spec.margin
    let bgRect = CGRect(x: inset, y: inset, width: 1024 - 2 * inset, height: 1024 - 2 * inset)
    let cornerRadius = bgRect.width * 0.2237  // Apple squircle ratio
    let bgPath = CGPath(roundedRect: bgRect, cornerWidth: cornerRadius, cornerHeight: cornerRadius, transform: nil)

    ctx.saveGState()
    ctx.addPath(bgPath)
    ctx.clip()

    let gradient = CGGradient(
        colorsSpace: space,
        colors: [srgb(0.33, 0.67, 1.00), srgb(0.02, 0.32, 0.84)] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawLinearGradient(
        gradient,
        start: CGPoint(x: 512, y: bgRect.maxY),
        end: CGPoint(x: 512, y: bgRect.minY),
        options: []
    )

    // Soft specular highlight across the top third.
    let sheen = CGGradient(
        colorsSpace: space,
        colors: [srgb(1, 1, 1, 0.16), srgb(1, 1, 1, 0)] as CFArray,
        locations: [0, 1]
    )!
    ctx.drawLinearGradient(
        sheen,
        start: CGPoint(x: 512, y: bgRect.maxY),
        end: CGPoint(x: 512, y: bgRect.maxY - bgRect.height * 0.45),
        options: []
    )
    ctx.restoreGState()

    // ── Magnifying glass ──
    // Small renders need a chunkier glyph; pick geometry by output size.
    let lensCenter: CGPoint
    let lensRadius: CGFloat
    let strokeWidth: CGFloat
    let drawBars: Bool

    switch px {
    case ..<32:
        lensCenter = CGPoint(x: 482, y: 562); lensRadius = 268; strokeWidth = 132; drawBars = false
    case ..<48:
        lensCenter = CGPoint(x: 478, y: 566); lensRadius = 256; strokeWidth = 112; drawBars = false
    case ..<128:
        lensCenter = CGPoint(x: 472, y: 572); lensRadius = 242; strokeWidth = 96; drawBars = true
    default:
        lensCenter = CGPoint(x: 470, y: 575); lensRadius = 235; strokeWidth = 88; drawBars = true
    }

    let white = srgb(1, 1, 1)
    ctx.setStrokeColor(white)
    ctx.setLineCap(.round)

    // Handle, angled down-right from the lens rim.
    let dir = CGPoint(x: cos(-CGFloat.pi / 4), y: sin(-CGFloat.pi / 4))
    let handleStart = CGPoint(
        x: lensCenter.x + dir.x * (lensRadius + strokeWidth * 0.2),
        y: lensCenter.y + dir.y * (lensRadius + strokeWidth * 0.2)
    )
    let handleLength: CGFloat = lensRadius * 0.88
    let handleEnd = CGPoint(
        x: handleStart.x + dir.x * handleLength,
        y: handleStart.y + dir.y * handleLength
    )
    ctx.setLineWidth(strokeWidth * 1.18)
    ctx.move(to: handleStart)
    ctx.addLine(to: handleEnd)
    ctx.strokePath()

    // Lens ring.
    ctx.setLineWidth(strokeWidth)
    ctx.strokeEllipse(in: CGRect(
        x: lensCenter.x - lensRadius, y: lensCenter.y - lensRadius,
        width: lensRadius * 2, height: lensRadius * 2
    ))

    // ── Result rows inside the lens — middle row is the match ──
    if drawBars {
        ctx.saveGState()
        let interior = lensRadius - strokeWidth / 2 - 26
        ctx.addEllipse(in: CGRect(
            x: lensCenter.x - interior, y: lensCenter.y - interior,
            width: interior * 2, height: interior * 2
        ))
        ctx.clip()

        let barHeight: CGFloat = 54
        let barGap: CGFloat = 86
        let barLeft = lensCenter.x - 158
        // (width, alpha) per row, top to bottom; middle is the match.
        let rows: [(CGFloat, CGFloat)] = [(196, 0.5), (340, 1.0), (148, 0.5)]
        for (index, row) in rows.enumerated() {
            let yCenter = lensCenter.y + barGap - CGFloat(index) * barGap
            let rect = CGRect(x: barLeft, y: yCenter - barHeight / 2, width: row.0, height: barHeight)
            ctx.setFillColor(srgb(1, 1, 1, row.1))
            ctx.addPath(CGPath(roundedRect: rect, cornerWidth: barHeight / 2, cornerHeight: barHeight / 2, transform: nil))
            ctx.fillPath()
        }
        ctx.restoreGState()
    }

    let image = ctx.makeImage()!
    let rep = NSBitmapImageRep(cgImage: image)
    rep.size = NSSize(width: px, height: px)
    return rep.representation(using: .png, properties: [:])!
}

for spec in specs {
    let data = render(spec: spec)
    let url = URL(fileURLWithPath: repoRoot).appendingPathComponent(spec.path)
    try! data.write(to: url)
    print("wrote \(spec.path) (\(spec.pixels)px)")
}
print("done — \(specs.count) files")

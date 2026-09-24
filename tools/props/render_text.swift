// Renders shaped text (CoreText: Kannada conjuncts etc.) to a tight transparent PNG. Used by lib.py for decals when
// ImageMagick (no complex-script shaping) would break the script.
//   swift tools/props/render_text.swift "<text>" "<font name>" <pointSize> "#rrggbb" out.png
import AppKit

let a = CommandLine.arguments
guard a.count >= 6 else { print("usage: text font size #rrggbb out.png"); exit(1) }
let text = a[1], fontName = a[2], size = CGFloat(Double(a[3]) ?? 64), hex = a[4], out = a[5]
func color(_ h: String) -> NSColor {
  var s = h; if s.hasPrefix("#") { s.removeFirst() }
  let v = UInt32(s, radix: 16) ?? 0
  return NSColor(srgbRed: CGFloat((v >> 16) & 255) / 255, green: CGFloat((v >> 8) & 255) / 255, blue: CGFloat(v & 255) / 255, alpha: 1)
}
let font = NSFont(name: fontName, size: size) ?? NSFont.boldSystemFont(ofSize: size)
let attr = NSAttributedString(string: text, attributes: [.font: font, .foregroundColor: color(hex)])
let line = CTLineCreateWithAttributedString(attr)
let b = CTLineGetImageBounds(line, nil)
let pad: CGFloat = 4
let w = Int(ceil(b.width + pad * 2)), h = Int(ceil(b.height + pad * 2))
let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: w, pixelsHigh: h, bitsPerSample: 8, samplesPerPixel: 4,
                           hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0)!
NSGraphicsContext.saveGraphicsState()
let ctx = NSGraphicsContext(bitmapImageRep: rep)!
NSGraphicsContext.current = ctx
let cg = ctx.cgContext
cg.clear(CGRect(x: 0, y: 0, width: w, height: h))
cg.textPosition = CGPoint(x: pad - b.minX, y: pad - b.minY)
CTLineDraw(line, cg)
NSGraphicsContext.restoreGraphicsState()
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: out))

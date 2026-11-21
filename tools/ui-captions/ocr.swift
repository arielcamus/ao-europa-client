import Foundation
import Vision
import AppKit
// usage: ocr <image> [scale]  -> lines "x y w h<TAB>text" in image pixel coords (top-left origin)
let path = CommandLine.arguments[1]
guard let img = NSImage(contentsOfFile: path), let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { exit(1) }
let W = Double(cg.width), H = Double(cg.height)
let req = VNRecognizeTextRequest()
req.recognitionLevel = .accurate
req.recognitionLanguages = ["es-ES", "en-US"]
req.usesLanguageCorrection = false
let handler = VNImageRequestHandler(cgImage: cg, options: [:])
try handler.perform([req])
for obs in (req.results ?? []) {
  guard let top = obs.topCandidates(1).first else { continue }
  let b = obs.boundingBox
  print(String(format: "%.0f %.0f %.0f %.0f\t%@", b.minX * W, (1 - b.maxY) * H, b.width * W, b.height * H, top.string))
}

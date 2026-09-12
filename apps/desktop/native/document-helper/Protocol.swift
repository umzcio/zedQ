import Foundation
import CoreFoundation
@objc protocol DocumentHelperProtocol {
    func execute(_ request: Data, withReply reply: @escaping (Data) -> Void)
    func cancel()
}
let serviceName = "dev.zq.DocumentHelper.Service"
func jsonData(_ value: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
}
// Reject the generic prototype protocol before creating a job or starting Python.
// The fixed renderer performs complete block, typography and content validation.
func validRequest(_ data: Data) -> Bool {
    guard data.count <= 1024 * 1024,
          let request = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
          Set(request.keys) == ["version", "operation", "document"],
          let version = request["version"] as? NSNumber,
          CFGetTypeID(version) != CFBooleanGetTypeID(), version == 1,
          request["operation"] as? String == "render_document",
          let document = request["document"] as? [String: Any],
          Set(document.keys) == ["format", "title", "blocks", "typography"],
          let format = document["format"] as? String, ["docx", "xlsx", "pptx", "pdf"].contains(format),
          document["title"] is String, document["blocks"] is [[String: Any]],
          document["typography"] is [String: Any] else { return false }
    return true
}

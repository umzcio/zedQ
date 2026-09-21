import Foundation
import Security

// This standalone helper intentionally uses the login/file Keychain: zQ's
// development app has no provisioned keychain-access-groups entitlement.
// SecItem still supplies encrypted generic-password storage with the creating
// helper's default ACL. Never use an allow-all ACL or trust /usr/bin/security.
// Sign every release with the same certificate identity and identifier so its
// designated requirement remains stable across updates. Ad-hoc rebuilds may
// require the user to authorize access again.
// https://developer.apple.com/documentation/technotes/tn3137-on-mac-keychains
// https://developer.apple.com/library/archive/technotes/tn2206/_index.html

let maxInputBytes = 65536

func respond(_ value: [String: Any]) -> Never {
    guard let data = try? JSONSerialization.data(withJSONObject: value) else { exit(1) }
    FileHandle.standardOutput.write(data)
    exit(0)
}

func fail(_ status: OSStatus = errSecParam) -> Never {
    // OSStatus only: no request data, system descriptions, or native stderr.
    respond(["ok": false, "status": Int(status)])
}

func validKey(_ value: String) -> Bool {
    let bytes = value.utf8
    return !bytes.isEmpty && bytes.count <= 8192 && bytes.allSatisfy { $0 >= 33 && $0 <= 126 }
}

var input = Data()
while true {
    let chunk = FileHandle.standardInput.readData(ofLength: 4096)
    if chunk.isEmpty { break }
    if input.count + chunk.count > maxInputBytes { fail() }
    input.append(chunk)
}

guard let request = (try? JSONSerialization.jsonObject(with: input)) as? [String: Any],
      let operation = request["operation"] as? String,
      ["get", "set", "delete"].contains(operation),
      let service = request["service"] as? String,
      service.range(of: "^dev\\.zedq\\.desktop\\.providers\\.[a-f0-9]{64}$", options: .regularExpression) != nil,
      let account = request["account"] as? String,
      account.range(of: "^[a-zA-Z0-9._-]{1,128}$", options: .regularExpression) != nil,
      !service.contains("\n"), !account.contains("\n")
else { fail() }

// Background reconnects must fail quietly when access needs authorization.
// This setting applies only to this one-request helper process, never the app
// or other Keychain clients. It does not change an item's access controls.
if let value = request["interactive"] {
    guard let flag = value as? NSNumber, CFGetTypeID(flag) == CFBooleanGetTypeID() else { fail() }
    let status = SecKeychainSetUserInteractionAllowed(flag.boolValue)
    guard status == errSecSuccess else { fail(status) }
}

// No kSecAttrSynchronizable: keys never enter iCloud Keychain. Exact service
// and account constrain every request; there is no enumerate/search operation.
let query: [String: Any] = [
    kSecClass as String: kSecClassGenericPassword,
    kSecAttrService as String: service,
    kSecAttrAccount as String: account,
]

switch operation {
case "get":
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    let status = SecItemCopyMatching(lookup as CFDictionary, &result)
    if status == errSecItemNotFound { respond(["ok": true, "key": NSNull()]) }
    guard status == errSecSuccess else { fail(status) }
    guard let data = result as? Data,
          let key = String(data: data, encoding: .utf8), validKey(key) else { fail(errSecDecode) }
    respond(["ok": true, "key": key])
case "set":
    guard let key = request["key"] as? String, validKey(key) else { fail() }
    let attributes: [String: Any] = [kSecValueData as String: Data(key.utf8)]
    var status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecItemNotFound {
        var item = query.merging(attributes) { _, new in new }
        item[kSecAttrLabel as String] = "zQ provider API key"
        status = SecItemAdd(item as CFDictionary, nil)
        // Another process may have created the exact item after the update.
        if status == errSecDuplicateItem { status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary) }
    }
    guard status == errSecSuccess else { fail(status) }
    respond(["ok": true])
case "delete":
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else { fail(status) }
    respond(["ok": true])
default:
    fail()
}

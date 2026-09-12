import Foundation
@objc protocol SkillHelperProtocol {
    func ping(withReply reply: @escaping (Bool) -> Void)
    func execute(_ request: Data, withReply reply: @escaping (Data) -> Void)
    func cancel()
}
#if SEATBELT_ONLY_PROBE
let serviceName = "dev.zq.SkillHelperSeatbeltProbe.Service"
#elseif APP_SANDBOX_ONLY_PROBE
let serviceName = "dev.zq.SkillHelperSandboxProbe.Service"
#else
let serviceName = "dev.zq.SkillHelperPrototype.Service"
#endif
func jsonData(_ value: [String: Any]) -> Data {
    (try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys])) ?? Data("{}".utf8)
}

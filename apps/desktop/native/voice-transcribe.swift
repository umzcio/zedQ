import Foundation
import Speech

// This helper accepts only a native-owned WAV path. No microphone capture or
// network-backed recognition is permitted here. Authorization is requested only
// for an explicit transcription, never while reading Settings availability.
func finish(_ value: Any? = nil, error: String? = nil) -> Never {
    let result: [String: Any] = error.map { ["ok": false, "error": $0] } ?? ["ok": true, "value": value ?? NSNull()]
    if let data = try? JSONSerialization.data(withJSONObject: result), let text = String(data: data, encoding: .utf8) { print(text) }
    exit(error == nil ? 0 : 1)
}
let args = CommandLine.arguments
guard args.count >= 3 else { finish(error: "Invalid transcription request.") }
let command = args[1]
let language = command == "availability" ? args[2] : (args.count == 4 ? args[3] : "")
guard !language.isEmpty else { finish(error: "Choose a transcription language.") }
let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language))
if command == "availability" {
    let languages = SFSpeechRecognizer.supportedLocales().map { $0.identifier.replacingOccurrences(of: "_", with: "-") }.sorted()
    let authorized = SFSpeechRecognizer.authorizationStatus()
    let supported = recognizer?.supportsOnDeviceRecognition == true
    let denied = authorized == .denied || authorized == .restricted
    finish(["engine": "Apple Speech (on-device)", "available": supported && !denied,
            "languages": languages, "message": denied ? "Speech recognition permission is denied. Enable zQ in System Settings → Privacy & Security → Speech Recognition." : supported ? "Ready. Audio stays on this Mac. Speech permission is requested when you transcribe." : "On-device speech is unavailable for this language on this Mac. Try another language or enable the language in macOS Dictation settings."])
}
guard command == "transcribe", args.count == 4 else { finish(error: "Invalid transcription command.") }
guard let recognizer, recognizer.supportsOnDeviceRecognition else { finish(error: "On-device speech is unavailable for this language. Audio was not uploaded.") }
let url = URL(fileURLWithPath: args[2])
guard url.pathExtension == "wav", FileManager.default.fileExists(atPath: url.path) else { finish(error: "The recorded audio is unavailable.") }
var task: SFSpeechRecognitionTask?
SFSpeechRecognizer.requestAuthorization { status in
    DispatchQueue.main.async {
        guard status == .authorized else { finish(error: "Allow zQ speech recognition in System Settings → Privacy & Security → Speech Recognition, then try again.") }
        // Recheck immediately before starting; never rely only on the UI probe.
        guard recognizer.supportsOnDeviceRecognition else { finish(error: "On-device speech is unavailable. Audio was not uploaded.") }
        let request = SFSpeechURLRecognitionRequest(url: url)
        request.requiresOnDeviceRecognition = true
        request.shouldReportPartialResults = false
        task = recognizer.recognitionTask(with: request) { result, error in
            if let result, result.isFinal { finish(result.bestTranscription.formattedString) }
            if error != nil { finish(error: "Apple Speech could not transcribe this recording. Check language support and try again. Audio was not uploaded.") }
        }
    }
}
DispatchQueue.main.asyncAfter(deadline: .now() + 65) { task?.cancel(); finish(error: "On-device transcription timed out. Try a shorter recording.") }
RunLoop.main.run()

# Chat document tool fix — 2026-09-10

Bug: natural-language request for a Word document on Ollama returns copy/paste instructions. Artifact rendering is only wired to manual UI; Ollama rejects tool calls and the host prompt denies file access.

Authorized outcome: tool-capable Ollama models can call create_document(format,title,content), receiving a real downloadable file in the response and persistent Artifacts library. No arbitrary filesystem paths, shell execution or automatic export outside managed storage. Existing menus/version behavior reused. Other adapters retain their existing hosted tools; this correction targets the reported Ollama failure without claiming all providers support local functions.

Tasks:
1. Ollama: native function definitions, streamed call accumulation, bounded execution/continuation, capability discovery, cancellation, fixture tests. Contract localTools [{name,description,parameters}], onLocalTool({name,arguments}) -> JSON object; supportsLocalTools(baseUrl,model) returns tools capability and caches on adapter. Never execute unknown calls, truncated calls or after stop. Preserve native thinking in continuation.
2. Host: capability preparation and accurate system prompt; bounded create_document executor reusing artifact renderer/storage, generated file cards, artifact activity, failure/cancel handling; tests through ChatService and restart.
3. End-to-end fixture and live model-server Montana DOCX check, verify archive content, package/reopen with original workspace restored. No paid provider calls or test data in normal workspace.

No git metadata exists. Work in authorized tree. Task 1 owns packages/providers/ollama.cjs and its test file; Task 2 owns host/UI files. Shared interface described above; no overlapping file edits.

Completed: all three tasks. Host review flush-warning finding fixed and scoped re-review passed; final adapter review found no blocker. 431 tests pass, one existing skip; typecheck and arm64 package pass. Exact Montana prompt succeeded on authorized qwen3.8:27b via both native service and packaged Regenerate flow. DOCX preview/archive verified, packaged download saved 9,126 bytes, both response artifacts survived quit. Original test workspace restored and regular app reopened with original user conversation intact. No paid calls. Logs and limits in docs/chat-artifacts.md.

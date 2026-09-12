# Native helper isolation follow-up

Approved direction: continue the native helper proof without Docker or Chat integration.

The first strict build fails before Python: App Sandbox rejects nested Seatbelt installation. Test a third, explicitly selected development variant with a separate bundle identity. Its trusted XPC launcher is not App Sandbox-entitled; the worker must install the existing deny-default policy before executing Python. Installation failure remains fatal. This uses deprecated sandbox_init, so successful probes do not establish a supported shipping architecture.

- [x] Demonstrate Python and job file IO under the policy.
- [x] Probe synthetic host reads, sibling writes, networking, fork, and direct exec denial; cancellation must stop actual running work.
- [x] Repeat all four document fixtures inside this boundary.
- [x] Record limitations, including privileged launcher exposure, signing/authentication, quotas, supported API and platform coverage. Keep all variants out of the shipping app.

Result: ten confinement/lifecycle/cleanup tests and four format fixtures pass in the explicit Seatbelt-only build. Independent review identified a permission-lock cleanup bug, reproduced and fixed with descriptor-relative cleanup. No production integration: deprecated/private sandbox interfaces and launcher/resource/distribution concerns remain. Details: `docs/native-skill-helper-native-findings.md`.

All test data is disposable and separate from the user's normal workspace. The original strict and App Sandbox-only variants retain their behavior. No new UI/items require context menus.

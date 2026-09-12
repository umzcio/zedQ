# Interoperability

zQ uses published formats and protocols at its import/export boundaries. Internal storage may use zQ records; users should not need to rewrite portable packages into a proprietary manifest.

## Skills (implemented)

The [Agent Skills specification](https://agentskills.io/specification) defines a directory containing `SKILL.md` with YAML frontmatter and optional scripts, references, and assets. zQ imports Markdown, folders, and ZIP/.skill archives containing one such directory. It preserves original metadata and resource bytes and exports `SKILL.md` or a standard directory inside a ZIP. Old `.zqskill.json` files remain readable for migration only.

Import is separate from activation. Instructions and bounded readable references can become chat context. Preserving scripts, binaries, `allowed-tools`, or compatibility metadata does not install dependencies, grant permissions, or execute code. Requirements appear in the review. Packages requiring tools outside zQ's runtime have partial functional compatibility even when their files round-trip intact.

The desktop's [fixed document helper](document-helper.md) provides structured DOCX/XLSX/PPTX/PDF creation and source-based revisions. Skill instructions can guide those tools; importing a document skill does not enable its arbitrary Python/JS scripts, LibreOffice, OCR or spreadsheet recalculation.

## Connectors and plugins (future integration)

Use [MCP](https://modelcontextprotocol.io/specification/2026-07-28) for MCP servers and preserve recognized ecosystem configuration through explicit adapters. Connection configuration is distinct from the wire protocol. Authentication and native execution still need an intentional host implementation.

Plugins have ecosystem-specific manifests, such as [Claude's plugin manifest](https://code.claude.com/docs/en/plugins-reference); there is no universal plugin archive. Recognize supported manifests explicitly, preserve source metadata, and explain unsupported components. Do not invent a required `zqplugin.json` wrapper or claim that successful import means every component can run.

## Discovery

Settings → Skills → Browse starts with six manually selected Anthropic skills listed on skills.sh. Catalog metadata is bundled; previews fetch the upstream public GitHub package at a pinned commit. Imported files are stored locally and automatic discovery uses installed names/descriptions and loads relevant instructions through a bounded native tool when enabled. Links lead to the skills.sh listing and original source.

The documented [skills.sh API](https://www.skills.sh/docs/api) requires Vercel OIDC authentication. Full authenticated catalog search is not configured in this release. The in-app search filters the curated list, and Explore skills.sh opens the full public directory.

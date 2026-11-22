---
version: 1
slug: "src-entrypoints-newtab-app-tsx"
primary_target: "src/entrypoints/newtab/App.tsx"
related_targets: ["src/entrypoints/newtab/style.css","src/entrypoints/content.ts"]
---

# Surface Brief · High-Frequency Entry Surfaces (NewTab + Command Palette + SPA Toast)

- **Scope & Mode**: Operate (`newtab/App.tsx`, `newtab/style.css`, `content.ts`, `network-utils.ts` SVG monogram helper).
- **Audience & Job**: R&D and heavy-multitasking browser users jumping between intranet services (`localhost`, `10.x.x.x`, `.corp`) and public work tools, deduplicating tabs without losing focus, and launching via keyboard (`/` / `Alt+Shift+K` / `Cmd+Shift+K` / `Enter` / `Esc`).
- **Constraints**: 100% local MV3 extension (no external fonts/CDNs), Simplified Chinese UI, light/dark/system themes, zero regression to existing keyboard flows, storage schemas, or the 151 unit tests.

## Direction contract

- **THESIS**: Strip away every ChatGPT-template gradient badge, rainbow countdown bar, and ungrounded wireframe void, replacing them with one disciplined **Precision Slate** instrument system across the NewTab deck, Command Palette, and SPA Toast so all three surfaces feel like one engineered desktop-grade tool.
- **OWN-WORLD**: Precision Slate (`#f2f4f7` cool-slate canvas / `#ffffff` crisp elevated deck / `#e9edf3` recessed rails in light mode; `#0b0d11` obsidian ground / `#13161c` raised deck / `#1a1e26` recessed wells in dark mode), `1px` structural hairlines, crisp layered shadows without double-border ghost cards, single sharp cobalt signal accent (`#2563eb` light / `#60a5fa` dark), emerald live-tab indicator (`#0d9488` / `#34d399`), tabular numerals, monospace reserved strictly for URLs/ports/keycaps, and unified `1.5px`-stroke vector icons (no emoji icons).
- **STORY**: Opening a new tab lands immediately in a calibrated launch deck showing live browser session telemetry, a dominant `/` command-search bar with live URL/intranet detection, tightly organized quick-launch tiles with open-tab & intranet status cues, a "继续上次" recovery strip, and a structured two-column bookmark matrix; pressing `Alt/Cmd+Shift+K` or triggering an SPA duplicate opens a matching crisp instrument overlay with zero visual clash.
- **FIRST VIEWPORT**: At `1280×1040`, the top command header anchors a `32px` tabular clock + live session status line on the left and a wide command-input search bar (`/` keycap + vector engine switcher) + `办公内网 / 个人` segmented control + theme/settings buttons on the right; directly below sits the bordered **Quick-Launch Deck** (group tab rail with inline action buttons + 6-column concentric-radius tile grid with 40px+ safe hit targets and tactile `0.96` press scale), followed by the recessed **Continue Strip** and collapsible **Bookmark Directory**.
- **FORM**: Precision Slate Instrument Deck (Candidate 1 on the user-pinned Precision Slate direction; `seed: none (pinned)` — user explicitly selected Direction A: Precision Slate after `concept-seed` `seed:3ef788508381fdb0`), with discipline raised from the Operate challenges: calibrated hairline rail alignment, semantic state indicators without noisy pill clutter, and unified cross-surface density.
- **FINISH**: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance.

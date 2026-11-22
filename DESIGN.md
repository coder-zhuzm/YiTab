---
name: YiTab 一签
description: Precision Slate visual system for YiTab's browser workspace, command palette, SPA deduplication toast, popup, confirm interstitial, and options control center.
colors:
  cobalt-signal: "#2563eb"
  cobalt-signal-hover: "#1d4ed8"
  cobalt-signal-dark: "#60a5fa"
  cobalt-wash: "rgba(37, 99, 235, 0.09)"
  cobalt-ring: "rgba(37, 99, 235, 0.22)"
  slate-canvas: "#f2f4f7"
  crisp-surface: "#ffffff"
  recessed-well: "#eaeef4"
  hover-tint: "#f4f6f9"
  hairline: "#dfe4ec"
  hairline-strong: "#c8d0dc"
  graphite-ink: "#111318"
  slate-ink: "#464f5e"
  muted-slate-ink: "#525d70"
  live-emerald: "#0f766e"
  live-emerald-soft: "rgba(15, 118, 110, 0.10)"
  warn-amber: "#b45309"
  warn-amber-dark: "#fbbf24"
  danger-crimson: "#dc2626"
  danger-soft: "rgba(220, 38, 38, 0.10)"
  obsidian-canvas: "#0b0d11"
  obsidian-surface: "#13161c"
  obsidian-well: "#1a1e26"
  obsidian-hover: "#1d222b"
  obsidian-hairline: "#232833"
  obsidian-hairline-strong: "#323947"
  bone-ink: "#edf0f5"
  silver-ink: "#a6b0c0"
  muted-steel-ink: "#939dae"
  live-teal-dark: "#2dd4bf"
typography:
  display:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1
    letterSpacing: "-0.03em"
    fontFeature: "tnum"
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "15px"
    fontWeight: 450
    lineHeight: 1.4
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "13px"
    fontWeight: 450
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "11.5px"
    fontWeight: 500
    lineHeight: 1.35
  compact:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
  row:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "12.5px"
    fontWeight: 450
    lineHeight: 1.35
  item:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "13.5px"
    fontWeight: 500
    lineHeight: 1.35
  micro:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif"
    fontSize: "10px"
    fontWeight: 600
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace"
    fontSize: "11px"
    fontWeight: 500
    lineHeight: 1.35
rounded:
  hair: "3px"
  tag: "4px"
  xs: "5px"
  sm: "6px"
  md: "7px"
  action: "8px"
  lg: "9px"
  tile: "10px"
  input: "11px"
  overlay: "12px"
  deck: "14px"
  pill: "999px"
spacing:
  xs: "4px"
  sm: "6px"
  md: "10px"
  lg: "14px"
  xl: "18px"
  xxl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.cobalt-signal}"
    textColor: "{colors.crisp-surface}"
    typography: "{typography.title}"
    rounded: "{rounded.md}"
    padding: "0 12px"
    height: "30px"
  button-primary-hover:
    backgroundColor: "{colors.cobalt-signal-hover}"
  button-secondary:
    backgroundColor: "{colors.recessed-well}"
    textColor: "{colors.slate-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 11px"
    height: "30px"
  input-command:
    backgroundColor: "{colors.crisp-surface}"
    textColor: "{colors.graphite-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.input}"
    padding: "0 9px 0 5px"
    height: "40px"
  deck-container:
    backgroundColor: "{colors.crisp-surface}"
    rounded: "{rounded.deck}"
  chip-group:
    textColor: "{colors.slate-ink}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "0 10px"
    height: "32px"
---

# Design System: YiTab 一签

## Overview

**Creative North Star: "The Precision Instrument Deck"**

YiTab is built as a quiet, engineered desktop utility where chrome disappears behind speed and clarity. The system rejects decorative gradients, rainbow progress tracks, high-saturation pill badges, and stacked white cards in favor of calibrated tonal slate surfaces, crisp `1px` structural hairlines, and a single authoritative Cobalt Signal accent reserved strictly for active focus, primary execution, and live state.

Every desktop surface—the NewTab Launch Deck (`src/entrypoints/newtab/`), the Global Command Palette & SPA Duplicate Toast (`src/entrypoints/content.ts`), the Popup (`src/entrypoints/popup/main.tsx`), the Confirm Interstitial (`src/entrypoints/confirm/main.tsx`), and the Options Control Center (`src/entrypoints/options/main.tsx`), unified through `src/styles/precision-ui.css` and `src/lib/theme-tokens.ts`—shares identical surface hierarchy, concentric corner geometry, tabular telemetry, and uniform vector iconography across both light and dark modes.

**Key Characteristics:**
- Calibrated three-step neutral surface ladder (`canvas` → `surface` → `surface-well`) in cool slate (light) and deep obsidian-graphite (dark).
- Single-declaration layered shadows for floating/deck elevation (`--shadow-deck`, `--shadow-popover`); `1px` solid hairlines reserved strictly for structural dividers.
- Zero external font/CDN dependencies; native system UI sans paired with monospace strictly for domains, ports, IPs, and keycaps.
- Keyboard-first ergonomics (`/` focus, `↑↓` selection, `Enter` activation, `Esc` dismiss, `Tab` traversal) with `>= 40px` extended hit areas and tactile `scale(0.96)` press feedback.

## Colors

A restrained, cool-mineral neutral palette anchored by a single Cobalt Signal accent and high-contrast semantic status inks.

### Primary
- **Cobalt Signal** (`#2563eb` light / `#60a5fa` dark): Focus rings, primary CTA buttons (`切换并关闭`, `添加快捷方式`), active group chip text, and the inset `2px` SPA toast countdown track. Hover deepens to `#1d4ed8` in light mode and `#93c5fd` in dark mode.
- **Cobalt Wash & Ring** (`rgba(37, 99, 235, 0.09)` / `rgba(37, 99, 235, 0.22)` light; `rgba(96, 165, 250, 0.14)` / `rgba(96, 165, 250, 0.28)` dark): Selected search suggestion row, active group chip background, and `1px` inset selection outline in the Command Palette.

### Neutral
- **Slate Canvas** (`#f2f4f7` light / `#0b0d11` dark): Page background behind the launch deck.
- **Crisp Surface** (`#ffffff` light / `#13161c` dark): Elevated command deck, bookmark directory, search bar, Command Palette, and SPA Toast card.
- **Recessed Well** (`#eaeef4` light / `#1a1e26` dark): Segmented control track, engine switcher chip, keycaps, resume footer rail, filter bar, and favicon bases.
- **Structural Hairline** (`#dfe4ec` / `#c8d0dc` light; `#232833` / `#323947` dark): `1px` section dividers, input strokes, and keycap bevels.
- **Ink Ramp** (`#111318` primary / `#464f5e` secondary / `#525d70` muted in light; `#edf0f5` / `#a6b0c0` / `#939dae` in dark): Calibrated so muted captions, domains, and keycaps clear `4.5:1` contrast on both `surface` and `surface-well`.

### Semantic Status
- **Live Emerald** (`#0f766e` light / `#2dd4bf` dark) with soft tint (`rgba(15, 118, 110, 0.10)` / `rgba(45, 212, 191, 0.14)`): Open-tab status dot and `当前` active badge.
- **Danger Crimson** (`#dc2626` light / `#f87171` dark): Destructive tile delete hover and tab-close hover state.

**The Single-Accent Discipline Rule.** Cobalt Signal never appears as decorative gradients or multi-hue badges; it marks only the primary action, keyboard focus, or current active selection.

**The Neutral Image Outline Rule.** Favicon frames carry a pure neutral inset outline (`oklch(0 0 0 / 0.1)` light, `oklch(1 0 0 / 0.1)` dark) so surrounding surface tint never bleeds onto icon edges.

## Typography

**Body & UI Font:** `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'PingFang SC', 'Segoe UI', 'Microsoft YaHei', sans-serif` (100% local, antialiased via `-webkit-font-smoothing: antialiased`).
**Technical Mono Font:** `ui-monospace, 'SF Mono', Menlo, Monaco, Consolas, monospace`

**Character:** Compact, crisp Operate-mode hierarchy where weight and tabular alignment establish scanability without oversized display theatrics.

### Hierarchy
- **Display (Clock)** (`600`, `32px`, `line-height: 1`, `letter-spacing: -0.03em`, `tabular-nums`): NewTab header clock only.
- **Headline (Command Input)** (`450`, `15px`, `line-height: 1.4`): Command Palette search input.
- **Title (Section & Header)** (`600`, `13px`, `line-height: 1.4`): Bookmark section title, SPA Toast header, tile/command primary titles (`13.5px`).
- **Body (Controls & Rows)** (`450–500`, `12.5px–13px`, `line-height: 1.35–1.5`): Search input, group chips, tile labels (`text-wrap: pretty`), bookmark titles.
- **Label & Telemetry** (`500`, `11px–12px`, `tabular-nums`): Tab/bookmark counts, filter tabs, keycaps, and monospace domains/hosts.

**The Monospace Truth Rule.** Monospace is used strictly for domains, IP/port addresses, and keyboard keycaps—never as decorative labels on prose or headings.

## Layout

- **NewTab Shell**: Centered `max-width: 960px` container (`padding: 36px 32px 72px`), collapsing at `<= 1080px` (4-column tiles, `260px` search) and `<= 760px` (`24px 16px 64px` padding, full-width search bar stacked above segmented control + icon buttons, 3-column tiles, single-column bookmark links).
- **Quick-Launch Deck**: Full-width `.yt-deck` enclosing the group rail (top divider), 6-column shortcut tile grid (`gap: 6px`), and recessed `.yt-resume` footer rail.
- **Bookmark Directory**: Collapsible `.yt-bookmarks` deck below the launch deck with `1px` folder separators and a 2-column `.yt-bm-links` grid (`gap: 2px 24px`).
- **Shadow DOM Overlays**: Command Palette (`width: 640px; max-width: 100%`, `12vh` top offset, `520px` narrow adaptation) and SPA Toast (`top: 16px; right: 20px; max-width: min(390px, calc(100vw - 40px))`).
- **Popup Tool Shell (`400px` wide)**: `.yt-brand-pill` header + single-row `.yt-rail-tabs` 4-column segmented rail (`治理` / `检索` / `书签` / `快照`) eliminating tab clipping, paired with `.yt-list-row` search items and `.yt-deck-card` snapshot blocks.
- **Confirm Interstitial (`max-width: 880px`)**: Sticky translucent header with `.yt-brand-pill` and solid Cobalt Signal CTA buttons (`Enter` / `Esc`), monospace Target URL Inspector, and `.yt-card-selected` inset-ring active match cards.
- **Options Control Center (`max-width: 1080px`)**: Two-column `.yt-opt-layout` (`224px` sticky `.yt-opt-sidebar` navigation rail + main content stack, collapsing at `<= 820px`), AntD `.ant-card` perimeter overrides via `--shadow-deck`, and `.yt-choice-tile` option cards.

## Elevation & Depth

Surfaces communicate depth through tonal contrast and single-declaration layered shadows—never combining a `1px` CSS border with a wide soft shadow on the same card edge.

### Shadow Vocabulary
- **Deck Elevation (`--shadow-deck`)**: `0 0 0 1px oklch(0 0 0 / 0.06), 0 1px 2px -1px oklch(0 0 0 / 0.05), 0 4px 14px -4px oklch(0 0 0 / 0.05)` (light); `0 0 0 1px oklch(1 0 0 / 0.07), 0 8px 24px -8px rgba(0, 0, 0, 0.55)` (dark).
- **Floating Popover / Palette (`--shadow-popover`)**: `0 0 0 1px oklch(0 0 0 / 0.07), 0 16px 36px -12px rgba(17, 19, 24, 0.16)` (light); `0 0 0 1px oklch(1 0 0 / 0.09), 0 24px 56px -12px rgba(0, 0, 0, 0.72)` (dark).

**The Single-Boundary Elevation Rule.** Cards and overlays declare their outer edge once via layered `box-shadow`; internal structural separation uses `1px solid var(--hairline)` borders only.

## Shapes

Corners follow strict concentric math (`outerRadius = innerRadius + padding`) so nested controls never look pinched:
- Search box `11px` = Engine switcher pill `6px` + `5px` left padding.
- Segmented control track `9px` = Active button `6px` + `3px` padding.
- Tile floating action bar `8px` = Action button `6px` + `2px` padding.
- Main decks use `14px`, floating overlays (Command Palette, SPA Toast) use `12px`, tiles/icon frames use `10px`, and inset progress tracks sit `12px` clear of `12px` card corners (`bottom: 8px; left: 12px; right: 12px`).

## Components

### Buttons & Actions
- **Shape**: `7px` radius (`30px–32px` height), `9px` for `36×36px` icon buttons.
- **Primary**: Solid Cobalt Signal `#2563eb` with `#ffffff` text; hover `#1d4ed8`; active press `scale(0.96)`.
- **Secondary / Ghost**: `--surface-well` (`#eaeef4`) or transparent with `--ink-2`; extended hit area via `::after` pseudo-elements to maintain `>= 40px` vertical touch/click safety without overlapping adjacent buttons.
- **Transitions**: Explicit property transitions only (`background-color`, `color`, `border-color`, `opacity`, `transform` at `110ms–140ms ease-out`); zero `transition: all`.

### Selection & Navigation
- **Segmented Control & Group Rail**: Active mode pill uses elevated `--surface` with subtle ring shadow; active group filter chip uses `--accent-soft` + `--accent` text.
- **Command Palette Rows**: Selected state pairs `--accent-soft` fill with a full `1px` inset hairline ring (`box-shadow: inset 0 0 0 1px var(--accent-ring)`).
- **Bookmark Rows**: Keyboard-focusable (`role="link"`, `tabIndex={0}`) with `opacity: 0; pointer-events: none` hover/focus action clusters (never `display: none`).

### Icons & Fallbacks
- **Vector Stroke**: Unified `1.5px` stroke weight (`currentColor`) across custom SVG glyphs (`EngineGlyph`, Command Palette search/category/close icons, SPA Toast marks).
- **Favicon Monograms**: Deterministic `generateSvgFavicon` mineral-slate SVG tiles (`#1e3a5f`, `#1e293b`, `#134e4a`, `#27272a`, `#1e40af`, `#3730a3`, `#3f3f46`) with `1.5px` subtle inner ring—no linear gradients.

## Do's and Don'ts

### Do:
- **Do** keep every interactive target at `>= 40px` hit area (via non-colliding `::after` hit-slop when visual size is compact).
- **Do** specify exact CSS transition properties (`110ms–150ms ease-out`) and honor `@media (prefers-reduced-motion: reduce)`.
- **Do** apply `font-variant-numeric: tabular-nums` to every dynamic count, clock, and result tally.
- **Do** add explicit `:focus-visible` `2px solid var(--accent)` outlines inside Shadow DOM roots after `all: initial`.

### Don't:
- **Don't** use linear gradients, rainbow countdown bars, or multi-hue decorative pills anywhere on Operate surfaces.
- **Don't** place a vertical accent bar down one side of a rounded list row (`::before` side stripe); use full-perimeter inset rings or surface tint.
- **Don't** use Unicode emoji (`🌐`, `🔍`, `＋`) as UI icons; render uniform `1.5px`-stroke vector SVGs.
- **Don't** use `display: none` for keyboard-reachable row actions or `transition: all` on interactive controls.

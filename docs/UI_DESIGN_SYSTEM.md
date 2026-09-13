# Mola UI design system

Mola uses local shadcn/ui components built on Base UI, Tailwind utilities without
Preflight, and a shared semantic appearance layer. The product remains a compact
team conversation workspace: Manrope, a forest green workspace rail, restrained
green action accents, and a continuous conversation surface.

## Direction

- **Forest** `#153d36`: the persistent workspace rail and brand identity.
- **Action green** `#21684e`: primary actions and keyboard focus in light mode.
- **Ink** `#20292b`: primary text, with quieter metadata below it in the hierarchy.
- **Mist** `#f4f7f6`: secondary surfaces; **white** `#ffffff`: conversation and cards.
- **Line** `#dfe6e2`: subtle dividers and group boundaries.

Headings, lists, and forms align left. The existing three-part workspace remains:

```text
workspace rail | personal navigation | conversation / active work
               |                    | contextual controls
```

Surfaces indicate purpose instead of adding decorative cards. Compact controls
and modest radii preserve the sharp, fast character requested for Mola. Motion
answers interactions; reduced motion is respected throughout the interface.

## Files and contracts

- `src/components/ui/`: local shadcn/Base UI primitives.
- `src/tailwind.css`: utilities and mappings from Tailwind colors to semantic
  tokens. Preflight is intentionally absent so document and feature layout resets
  remain under Mola's control.
- `src/design-system.css`: semantic tokens, shared component defaults, accessible
  focus, density, theme, and cross-feature appearance rules. Import this **last**.
- `src/lib/appearance.ts`: persisted appearance, OS color scheme updates, and
  synchronization between tabs. Call `initializeAppearance()` before mounting
  React. Components read and update choices through `useAppearance()`.

`--background`/`--foreground`, `--card`, `--popover`, `--primary`, `--secondary`,
`--muted`, `--accent`, `--border`, `--input`, and `--ring` follow the shadcn semantic
contract. Their associated foreground tokens are the readable text pairings.

The former Mola `--muted` text color is now **`--muted-foreground`**. `--muted` is a
surface color. Legacy `--ink`, `--line`, `--subtle`, and `--active-surface` aliases
resolve to shared tokens. Do not add new hardcoded feature colors.

Use `--brand-solid` with `--brand-foreground` for existing always-green controls.
New primary controls use `--primary` and `--primary-foreground`, which deliberately
change together in dark mode. Alerts use `--destructive`/`--danger-surface` and
`--warning`/`--warning-surface` with their corresponding border tokens.

## Appearance and density

The default appearance is **system** theme and **compact** density. Users may pick
light, dark, or system and compact or comfortable. Preferences are device-local
under `mola.appearance.v1`; no profile request is needed. Invalid or unavailable
storage falls back safely, and a choice remains effective in the current tab if
storage is blocked. A system theme follows OS changes without reloading.

Dark mode uses a deep forest conversation background and progressively raised
surfaces. It does not filter rendered content. User avatar colors, photos, camera
video, shared screens, and PDF document canvases keep their original appearance.

Compact navigation rows are 34px; comfortable rows are 42px with more message and
section spacing. Shared controls grow from 36px to 42px. Coarse pointers receive
44px main controls and rows, and form text uses 16px to avoid mobile input zoom.

`data-unstyled="true"` on a primitive preserves an existing specialized layout
(for example the composer or inline search). Shared component CSS must respect
this marker. A button with the `unstyled` variant likewise retains its feature
classes. Style new standard controls through shared variants first.

## Review checklist

Review changes in both light and dark appearance, compact and comfortable
density, narrow viewports, keyboard-only navigation, and reduced motion. Check
portaled menus and dialogs as well as the page underneath them. Preserve fixed
contrast treatment on video controls and original colors in user content.

## Component migration

Buttons, text fields, text areas and native select adapters are shared across
messaging, navigation, authentication, calls and administration. Specialized
browser controls (file pickers, ranges and radio/checkbox inputs) retain their
native form behavior and share semantic colors and focus treatment.

Dialogs, tooltips, context menus, profile previews, avatars and tabs use Base UI
primitives through local shadcn components. `Modal` and `IconButton` remain small
product adapters so feature code shares consistent behavior. Menu keyboard
navigation, modal focus isolation and nested overlay dismissal belong to these
primitives. Portal containers must use `undefined` for the document body:
Base UI treats an explicit `null` as an unavailable container.

Keep the call's dialog controller mounted when minimizing a conversation. The
dock must exist before the dialog restores focus. Native fullscreen keeps its
own focus scope inside the dialog. Profile previews mount inside the nearest
modal when applicable, and Escape dismisses the preview before its parent.

Settings use vertical tabs on desktop and horizontal tabs on mobile. Hidden
panels stay mounted to preserve edits; forms still save only on explicit submit.
Appearance changes apply immediately. Opening notification preferences and
leaving settings preserve the existing unsaved-profile confirmation.

Migration checks include the complete browser workflow suite, authentication,
administration and server tests. `tests/ui-library.e2e.spec.ts` audits the full
workspace in light/dark themes at 390px and 1440px; settings tests cover theme
persistence, OS changes, density, draft retention, keyboard navigation and
contrast. Existing call tests cover media continuity, fullscreen, minimization,
screen sharing and mobile controls.

## Migration verification — 2026-09-13

- Production build and TypeScript validation passed; dependency audit reported
  no vulnerabilities.
- 248 server checks passed. All 230 main browser scenarios were exercised;
  failures identified in the full sweep were resolved and checked through a
  focused 58-scenario run and the final repeated appearance suite (16/16).
- Authentication (3/3) and system administration (3/3) passed independently.
- The built application was checked at 390px and 1440px in light/dark themes,
  including settings, persisted density, dialogs, context menus and live socket
  connection, with no page errors, failed assets or horizontal overflow.
- Theme switching was additionally checked with 24 immediate contrast audits
  and rapid consecutive choices. Palette changes temporarily suppress CSS
  transitions until the new colors are painted together; normal interaction
  transitions resume afterward.

The build's existing 500 kB chunk advisory remains: the main JavaScript bundle
is 944.49 kB (281.23 kB gzip). PDF rendering remains a separate lazy-loaded chunk.
This is a bundle-size advisory, not a build failure.

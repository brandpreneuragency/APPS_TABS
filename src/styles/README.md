# TABS UI contract

Read this before adding or changing a page. Preserve the current owner-edited
Docs/Tasks appearance; an older build or Git revision is comparison evidence,
not a template to restore. These are role-based defaults, not rules for every
`div`, every text node or every element implemented as a `button`.

## One value source, shared application rules

Edit design values only in [`tokens.css`](./tokens.css), including named themes.
Use [`controls.css`](./controls.css) for common roles. Feature CSS owns placement,
content layout and justified role-specific exceptions, not another token catalog.
Spacing is fixed; existing text-size settings and resizable panel geometry are separate.

| Role | Default | Shared class |
| --- | --- | --- |
| UI icon, including empty-state symbols | `--c-icon-1`, 14px square | Lucide / `ui-icon` / `icon-base` |
| Ordinary icon-only action | `--c-sq-button`, 24px square; no padding | `ui-icon-button` |
| Text or icon + text action | 24px high, automatic width, 8px horizontal inset, 2px internal gap | `ui-button` |
| Compact toolbar row | `--control-height-sm`, 32px | `ui-toolbar` |
| Standalone input/select | 32px high | `ui-input` |
| Textarea | Content/rows determine height | `ui-input` |
| Selectable list row | Minimum 32px; may grow with content | `ui-list-row` |
| Content card | Content-sized, not a fixed-height button | `ui-card` |
| Page/panel content inset | `--c-space-1`, 8px, at one owning layer | `ui-page-body` / `ui-panel-body` |
| Label + control | Shared label and spacing | `ui-field` |

### Sizing exceptions must follow the role

- A 32px toolbar normally contains centered 24px actions; do not give its children
  the parent's full height. Compact control clusters use `--c-gap-0` (2px), as in
  the editor top bar. This is not a replacement for card/grid/body spacing.
- Text buttons stay automatic-width, never square. `ui-button--compact` reduces
  horizontal padding; `ui-button--round` changes shape, not the hit-target size.
- Editable titles are left-aligned, transparent, full-available-width text
  controls with truncation, not centered CTA buttons. See `.editor-topbar-title`.
- Inline toolbar search can be 24px and borderless (Notes search); standalone form
  inputs remain 32px. Preserve the difference instead of shrinking every input.
- Navigation rows and full-width navigation actions can be 32px. Calendar day
  cells, task metadata/checkboxes, multi-line cards and touch affordances have their
  own geometry. Do not shrink these merely because they contain a button.
- Window controls are a separate shell role. Inspect the actual cascade and hit
  target before changing them: a local size declaration can lose to `ui-icon-button`
  min/max sizes or flex basis. Do not infer a working exception from one declaration.

## Text and interaction states

- Ordinary chrome labels use `--c-text-3`. Hover, focus and selected labels normally
  use `--c-text-1`, not accent-colored text. Icons normally follow their control's
  foreground. Selected surfaces use the existing selection background rather than
  stacking several accent decorations.
- Routine toolbar actions stay quiet/transparent. The Notes toolbar's New action
  is a concrete example: a class named “primary” does not itself justify accent fill.
- Preserve contrast on genuinely filled primary actions: Send uses `--c-text-1`
  on an accent background, including its hover state. Do not dim that foreground.
- Danger, warning, success and error feedback retain their semantic colors.
  User-selected client/category colors, authored document text, syntax highlighting
  and embedded-form design are separate from ordinary chrome labels.
- Accent is still appropriate for check/status indicators, drag insertion lines
  and deliberate data cues such as Today's calendar label, not border colors.
  This does not justify accent text on an ordinary tab or action.
- Existing accent text in legacy tabs/menus is not automatically an approved
  exception. Inspect its purpose before copying it into a new design.
- Keep visible keyboard focus and disabled behavior. A hover rule alone does not
  establish keyboard-focus behavior; inspect both. Do not erase semantic states
  with an unqualified global `color` override.

## Flat surfaces, borders and content ownership

- No app-owned box shadows, text shadows, drop-shadow filters or glow tokens,
  including named themes, menus, dialogs, completion animations and drag previews.
  Remove the generating declarations; do not hide them beneath a global override.
- Visible app-owned borders use only `--c-border`, `--c-border-1` or `--c-border-2`
  (use an already defined token). Remove other decorative borders and accent/status
  overrides; keep approved base borders. No decorative gradients or blur filters.
- Use solid borders for ordinary bounded controls/popovers. Focused text fields,
  selects and editable text have no visible border or outline; keep border widths
  for stable layout. Fields retain their default background on hover and focus
  (prose editors retain their caret), including embedded forms. Shared focus rules
  preserve field-wrapper backgrounds as well.
  Buttons, navigation and drop targets retain `--c-border-2` focus outlines;
  resize grips and loading indicators use the same approved palette. Preserve
  forced-colors system focus, reduced motion and authored embedded-form styling.
- Do not automatically add an accent perimeter to a whole stateful container.
  The calendar's Today column keeps its label cue without an extra perimeter.
  This is not a blanket border ban.
- Give each inset and scroll region one owner. Notes is a concrete exception to
  “all page bodies get 8px”: its outer page has zero padding; the inner notes grid
  owns the 8px inset. Do not reintroduce nested padding around the same content.
- Keep tree indentation, document prose, task-card metadata layout and user-resized
  panel widths separate from generic panel padding.

## New pages and overlays

Reuse `PrimaryWorkspaceContent` / `CenterContentPanel`; do not add a parallel shell.
Compose shared classes with feature-specific layout classes. Use primary, danger
and ghost modifiers intentionally, and name icon actions with `aria-label`.

Portaled overlays must be styled from their actual overlay root, not a composer
ancestor they no longer have. Check the open menu, search, rows, footer, scroll,
selection, Escape/outside dismissal and focus restoration. Focus initial search
after the portal mounts; repositioning must not steal focus from another item.

## Retired personal overrides

Appearance retains theme selection, not a token editor. On startup, `themeTokens`
is archived verbatim to a unique `legacy.themeTokens.v1.*` recovery key before the
active key is removed in the same transaction. Failure preserves the original.
Archived overrides are not applied; documents and task data are not migrated.

## Verification

Run relevant tests, including `npm run test -- src/styles/designTokens.test.ts`.
The contract checks fixed values, single-source definitions, retired/undefined
tokens, compact role defaults and absence of shadow effects. Drag-preview tests
also verify that removing effects does not change original styling or payloads.

Source checks do not prove the cascade. Inspect computed sizes/colors, real hover
and keyboard focus, both themes, and opened overlays. Preserve Docs/Tasks and
check supported text sizes and narrow layouts. Report browser preview separately
from native Tauri/installed-app verification. Never infer authorship from file
timestamps or classify every dirty-worktree difference as a new owner change.

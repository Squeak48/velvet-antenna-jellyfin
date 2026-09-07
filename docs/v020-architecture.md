# Velvet Antenna v0.20

## Purpose

v0.20 is the first standalone Velvet Antenna build. It replaces the layered 0.10 + 0.12 + 0.14 + 0.15 + 0.17 stack with one CSS file and one JavaScript file.

The main engineering rule is simple:

> Velvet Antenna owns presentation and routing. Jellyfin owns media functionality.

That means playback, Series/Season child loading, subtitles, metadata editing, library tabs and other server-backed behaviour are delegated to Jellyfin rather than reimplemented.

## Systems

### Router and shell

- One route classifier.
- One persistent Velvet Antenna navigation bar.
- Native Jellyfin viewer chrome hidden only where the Velvet Antenna shell replaces it.
- Native library tabs retained.
- Admin and playback routes are not wrapped by the viewer shell.

### Home

- Home candidate pool preference: Continue Watching, Next Up, Recently Added Movies, Recently Added Series.
- Candidate pool must settle before the hero is selected.
- Once selected, the hero is locked to one exact Jellyfin item ID until Home is left.
- Later DOM mutations cannot rotate or replace the locked item.
- Hero metadata and backdrop are enriched from Jellyfin after the item is locked.

### Playback

- Velvet Antenna never implements playback.
- Home Play navigates to the exact item's detail page and delegates to Jellyfin's genuine `.btnPlay`.
- Only Movie, Episode, Video and Audio item types are auto-play candidates.
- Series, Season, folders and unknown item types open details instead of guessing.
- SyncPlay, Join Group, Watch Together, Watch Session, Play To, Remote Play and similar controls are explicitly rejected.

### Series and Seasons

- Jellyfin's native Series and Season detail structure remains intact.
- `#listChildrenCollapsible` / child rendering remains native.
- Velvet Antenna styles the native structure rather than replacing it.

### Subtitles

- Jellyfin owns subtitle availability and selection.
- v0.20 only ensures a genuine `.btnSubtitles:not(.hide)` cannot be accidentally suppressed by styling.
- A hidden Jellyfin subtitle button is never forcibly exposed.

### Libraries

- Native Jellyfin tabs are preserved.
- Library cards receive Velvet Antenna focus and artwork styling.
- Clicking the non-interactive body of a library card navigates directly by exact Jellyfin item ID. This provides a fallback for badly matched/unmatched cards whose normal card link is unreliable.

### Metadata rescue mode

For administrators:

- Every library card with a Jellyfin item ID receives an `EDIT` affordance.
- The affordance uses Jellyfin's native `ItemAction.Edit` path rather than a custom metadata form.
- A `MANAGE METADATA` button on library pages exposes all edit affordances at once for rapid cleanup of unmatched items.
- Detail pages also gain an `EDIT METADATA` action.
- Non-administrators do not see these controls.

### Search

- Native Jellyfin search remains the data source and behaviour owner.
- Velvet Antenna provides the page identity, input treatment and result presentation.

### Live TV / IPTV / DVR

- Live navigation appears only if a Jellyfin Live route can be discovered.
- Native Live TV behaviour remains untouched.
- v0.20 includes the first standalone Velvet Antenna presentation layer for guide/programme cards and recording state.

## Observer policy

v0.20 has one debounced `MutationObserver` watching structural child changes only.

It does not observe class/style attributes and has no continuous enforcement interval. Render functions are designed to be idempotent.

The Home hero settle process is bounded and stops permanently once the item is locked.

## Upgrade rule

v0.20 has no mod dependencies. Test it with all earlier Velvet Antenna versions disabled.

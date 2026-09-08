# Velvet Antenna v0.21 - Velvet Lens

v0.21 is a standalone redesign rather than another patch on v0.20.

## Goals

1. Make Velvet Antenna visibly and behaviourally distinct from stock Jellyfin.
2. Remove the DOM-wide rescan architecture that made large libraries feel slow.
3. Preserve native Jellyfin functionality for playback, Series/Season children, subtitles, metadata editing, selection and deletion.
4. Turn maintenance into a first-class administrator workflow rather than a set of grid hacks.

## Performance model

v0.21 has no document-wide MutationObserver.

On route changes it performs a small, bounded series of render passes while Jellyfin finishes loading. Normal library browsing after that is event-driven:

- pointer/focus events update the Velvet Lens stage;
- route changes remount page-specific UI;
- native paging/tab/filter clicks schedule bounded refresh passes;
- metadata and duplicate scans run only when an administrator explicitly opens a workbench.

This prevents a 500-item library page from triggering repeated full-card rescans on every DOM mutation.

## Navigation

The Velvet Antenna bar has a persistent Back button.

Back delegates to browser/Jellyfin history and falls back to Home if there is no usable history entry.

## Home

The Home hero keeps the proven settle-and-lock model:

- wait for Continue Watching / Next Up / recently-added candidates to settle;
- lock one exact Jellyfin item ID;
- enrich the locked item from Jellyfin;
- never rotate it because of later DOM mutations.

PLAY delegates to Jellyfin's real local `.btnPlay` on the exact detail page and rejects SyncPlay/Watch Together/Join Group-style controls.

## Velvet Lens library stage

Movies, Series and Collections no longer open with a static banner.

A full-width cinematic stage sits above the native grid. Moving focus across a Jellyfin card changes:

- backdrop;
- title;
- year/runtime/rating;
- overview;
- OPEN / PLAY actions;
- administrator metadata action.

The selected native card remains the actual Jellyfin item. Velvet Antenna does not create a parallel media database.

## Administrator workbenches

For administrators, the stage exposes NEEDS ID and DUPLICATES.

Unlike v0.20, these are whole-library tools. They are not limited to the current 100/500/1000-card Jellyfin page.

### Needs ID

The workbench reads the current library recursively in batches and lists items with no external provider IDs.

### Duplicates

The workbench first reads lightweight identity metadata across the entire library, groups likely duplicates using normalised title plus year/provider corroboration, then requests heavy MediaSource/MediaStream details only for candidate groups.

Candidate rows can show resolution, codec, HDR/Dolby Vision, bitrate, audio layout/codec and file size.

Velvet Antenna does not automatically delete media. Deletion and Group Versions remain Jellyfin-native actions.

## Series, Seasons and subtitles

Series/Season child rendering stays native Jellyfin.

The player remains native Jellyfin and the real `.btnSubtitles:not(.hide)` control is preserved.

## Upgrade rule

v0.21 has no dependency on v0.20 or earlier Velvet Antenna versions.

For testing, disable 0.10, 0.12, 0.14, 0.15, 0.17 and 0.20, then enable v0.21 only.

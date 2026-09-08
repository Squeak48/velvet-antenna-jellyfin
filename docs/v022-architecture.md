# Velvet Antenna v0.22 - Antenna Flow

v0.22 is the first viewer-first product release after the v0.20/v0.21 stabilisation work.

## Product thesis

Jellyfin remains the media engine. Velvet Antenna owns discovery, continuity and presentation.

The goal is not to reproduce commercial streaming shelves. It is to use the finite personal library, playback state and metadata Jellyfin already knows to answer a more useful question: **what should I watch now?**

## Compatibility base

The generated v0.22 asset starts with the proven v0.21.5 standalone bundle. This deliberately preserves:

- Jellyfin local playback delegation
- Series/Season/Episode native child rendering
- native subtitle playback for existing tracks
- native context menus and multi-select administration
- back/navigation behaviour
- Velvet Lens library browsing
- the visible detail PLAY/CONTINUE control

The temporary Needs ID and Duplicate workbenches remain only as unreachable compatibility code in the v0.21 base and are removed from the v0.22 viewer surface.

## Antenna Flow

Antenna Flow queries Jellyfin directly and renders bounded components. It does not scrape hundreds of cards and does not use MutationObserver.

Home adds:

- Tonight
- Continue the Story
- One More Episode
- Forgotten Signals
- Rediscover
- Signal Match explanations
- contextual finish times

The original Jellyfin home sections are hidden only after the v0.21 hero has settled and Antenna Flow has mounted, so the stable hero selection path is retained.

## Tonight

Tonight creates a small candidate set from resumable media, Next Up and strong unwatched films. Users can choose a time budget or finish-by time. Ranking is transparent and deterministic, using runtime fit, watched state, community rating and genre overlap with recent viewing.

## Series continuity

Series detail pages retain Jellyfin's native season/episode machinery. Velvet Antenna adds a continuity strip using Jellyfin Next Up data and watched episode counts.

## Live subtitle search

CC+ is an additive player control. It remains visible even when Jellyfin has no current subtitle tracks.

Search uses Jellyfin's own configured remote subtitle providers:

- GET `Items/{itemId}/RemoteSearch/Subtitles/{language}`
- POST `Items/{itemId}/RemoteSearch/Subtitles/{subtitleId}`

Download & Use first downloads through Jellyfin. Because an already-created playback media source may not immediately contain the new stream, v0.22 has a bounded fallback that preserves the current timestamp, reloads the same item, seeks back to the saved time and attempts to select the downloaded language through Jellyfin's refreshed native subtitle menu.

If automatic selection cannot be confirmed, the subtitle remains downloaded and Velvet Antenna tells the viewer to choose it from CC. No external subtitle provider is called directly from Velvet Antenna.

## Performance rules

- No MutationObserver in v0.22 feature modules.
- API data is cached in memory for five minutes per browser session.
- Route work uses a small number of bounded delayed passes.
- Whole-library scans are not performed during ordinary browsing.
- Jellyfin native functionality remains the fallback for destructive/admin actions.

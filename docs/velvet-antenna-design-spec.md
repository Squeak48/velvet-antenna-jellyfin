# Velvet Antenna
## Streaming Interface Design Specification

**Version:** 1.0  
**Platform:** Jellyfin-based personal streaming service  
**Primary targets:** LG webOS TV, desktop web, mobile  
**Future targets:** IPTV, Freeview / Live TV, DVR  
**Brand direction:** Dark, cinematic, luxurious, restrained

---

## 1. Product Vision

Velvet Antenna should feel like a genuine premium streaming service rather than a themed Jellyfin installation.

The service should be:

- Fast to understand from the sofa
- Artwork-led rather than interface-led
- Calm and cinematic
- Easy to navigate with a television remote
- Strongly branded without overusing purple
- Flexible enough to support Movies, Series, Anime, Live TV, IPTV and DVR
- Capable of hiding features that are not yet configured
- Designed around a personal, curated library rather than advertising or discovery feeds

The central design principle is:

> **The content is the star. Velvet Antenna provides the atmosphere.**

---

## 2. Brand Identity

### 2.1 Name

**VELVET ANTENNA**

The name should feel distinctive, private, nocturnal and slightly broadcast-inspired without sounding like a generic streaming platform.

### 2.2 Logo Direction

The primary mark is a flowing ribbon-shaped symbol that combines:

- A broad `V`
- A signal or antenna wave
- A subtle sense of motion
- Purple illumination
- A premium, polished finish

The logo should retain a restrained violet underglow as its signature feature.

### 2.3 Logo Usage

Use two main variants:

#### Full Lockup

```text
[ SYMBOL ]

VELVET
ANTENNA
```

Used for:

- Splash screen
- Login screen
- About page
- Promotional artwork
- Server branding

#### App Mark

Use only the ribbon / antenna symbol.

Used for:

- App icon
- Favicon
- Profile branding
- Loading animation
- Small navigation contexts

The app mark must remain legible at very small sizes.

---

## 3. Visual Language

### 3.1 Mood

Velvet Antenna should feel:

- Cinematic
- Refined
- Dark
- Modern
- Slightly mysterious
- Comfortable in a living-room environment

It should not feel:

- Gamer-like
- Cyberpunk
- Loudly neon
- Overly glossy
- Like a Plex clone
- Like a generic Jellyfin theme

### 3.2 Core Palette

| Purpose | Colour | Hex |
|---|---|---|
| Main background | Near-black | `#08060C` |
| Raised surface | Charcoal plum | `#110D17` |
| Secondary surface | Deep plum | `#1B1028` |
| Primary accent | Violet | `#8A46E8` |
| Secondary accent | Rich purple | `#6C2CBF` |
| Highlight | Lilac | `#C68BFF` |
| Main text | Warm white | `#F6F2F8` |
| Secondary text | Muted grey-lilac | `#AAA2B1` |
| Disabled text | Deep muted grey | `#6C6572` |
| Progress background | Deep grey-purple | `#2B2432` |

### 3.3 Purple Usage Rule

Purple should be used sparingly.

Target visual balance:

- **80% artwork and content**
- **15% neutral dark interface**
- **5% Velvet Antenna purple**

Purple should primarily indicate:

- Focus
- Selection
- Playback progress
- Active navigation
- Loading
- Live status
- Important interaction feedback

Purple should not be used as a blanket background colour.

---

## 4. Typography

### 4.1 Brand Typeface

The Velvet Antenna wordmark may use a custom or geometric display typeface.

The brand font should be reserved for:

- Logo
- Splash screen
- Occasional section branding

### 4.2 Interface Typeface

Recommended:

**Manrope** or **Inter**

Use:

- Regular for metadata
- Medium for navigation
- SemiBold for headings
- Bold only for major titles where necessary

### 4.3 Typography Hierarchy

| Element | Weight | Relative Size |
|---|---:|---:|
| Hero title | SemiBold | Very large |
| Page title | SemiBold | Large |
| Section title | SemiBold | Medium-large |
| Card title | Medium | Medium |
| Metadata | Regular | Small |
| Secondary metadata | Regular | Small, muted |

Avoid oversized text that reduces visible content on television screens.

---

## 5. Main Navigation

Primary navigation:

```text
HOME    MOVIES    SERIES    ANIME    LIVE    COLLECTIONS
```

Right-side utility actions:

```text
SEARCH    PROFILE    SETTINGS
```

### 5.1 Behaviour

- **Live** should remain hidden until Live TV or IPTV is configured.
- Anime remains a first-class section rather than being buried inside Series.
- Collections should be visible because curated grouping is a core part of the product.
- Jellyfin administration concepts should not appear in normal viewer navigation.

Avoid exposing:

- Dashboard
- Libraries
- Folders
- Metadata
- Plugins
- Server management

These belong only in administration screens.

---

## 6. Home Screen

The home screen should feel curated rather than like a raw library index.

### 6.1 Recommended Order

```text
Hero / Featured

Continue Watching

Next Up

Recently Added

Your Collections

Anime

Live Now              [only when Live TV is configured]

Recent Recordings     [only when DVR is configured]
```

Rows should disappear automatically when they have no content.

### 6.2 Hero Area

The top 35 to 45 percent of the screen may be used for one cinematic hero item.

Preferred hero source:

1. Most recently watched item
2. Featured item from the user's library
3. Recently added high-profile item

Hero content should show:

```text
TITLE

Short metadata line

Brief description

[ Continue / Play ]    [ + My List ]
```

Do not autoplay trailers by default.

The backdrop should fade naturally into the page background.

---

## 7. Card System

Different content types should use different card proportions.

### 7.1 Movies

Use portrait posters.

```text
┌─────────┐
│         │
│ POSTER  │
│         │
└─────────┘
Movie Title
2025 • 2h 14m
```

### 7.2 Continue Watching

Use 16:9 landscape cards.

```text
┌────────────────┐
│                │
│   BACKDROP     │
│                │
├████████░░░░░░░░┤
└────────────────┘

Series Name
S03 E05
```

### 7.3 Next Up

Use landscape cards with:

- Episode image
- Series title
- Season and episode
- Runtime
- Progress if partially watched

### 7.4 Collections

Use wide cinematic cards.

Examples:

```text
ALIEN COLLECTION
STAR WARS
MARVEL
BATMAN
```

Collections should feel curated and premium rather than like folders.

### 7.5 Focus Behaviour

On TV focus:

- Increase scale by approximately 3 to 5 percent
- Add a restrained violet underglow
- Increase artwork brightness slightly
- Do not add a thick purple outline
- Use a smooth 150 to 200 ms transition

Example:

```text
      ┌──────────────┐
      │              │
      │    MOVIE     │
      │              │
      └──────────────┘
        ░▒▓████▓▒░
```

The underglow should echo the logo.

---

## 8. Movie Detail Page

The movie page should be immersive but uncluttered.

### 8.1 Layout

```text
FULL-WIDTH BACKDROP
fading into background

TITLE

Year • Runtime • Rating • Age Rating

Short description

[ PLAY ]    [ + MY LIST ]    [ MORE ]

Director
Cast

MORE LIKE THIS
[ posters ]
```

### 8.2 Rules

- No large opaque information panels unless readability requires them.
- Use subtle gradient overlays behind text.
- Keep metadata concise.
- Artwork should remain dominant.

---

## 9. Series Detail Page

Series pages should make episode navigation fast.

### 9.1 Header

```text
SERIES TITLE

2 Seasons • 2021

[ RESUME S02 E04 ]
```

### 9.2 Season Selection

Use a compact season selector:

```text
Season 2  ▼
```

### 9.3 Episode List

Prefer a clean list rather than oversized tiles:

```text
┌───────────────┐
│ episode image │   4. Episode Title
└───────────────┘   42 min
                    Short description

┌───────────────┐
│ episode image │   5. Episode Title
└───────────────┘   40 min
                    Short description
```

Include:

- Episode image
- Number
- Title
- Runtime
- Description
- Watch progress
- Watched indicator

---

## 10. Anime Experience

Anime should be a dedicated top-level area.

### 10.1 Anime Home

Recommended sections:

```text
Continue Watching

Latest Episodes

Your Series

Movies & Specials

Completed Series

Collections

By Genre
```

### 10.2 Metadata

Where available, support:

- English title
- Japanese title
- Season
- Episode number
- Air date
- Special / OVA distinction

### 10.3 Organisation

The design should tolerate:

- Standard season numbering
- Absolute numbering
- Specials
- OVAs
- Split cours
- Movies attached to a franchise

Anime should visually belong to Velvet Antenna, but its organisation should be intentionally more flexible than normal television.

---

## 11. Live TV and IPTV

Live TV should be designed into the interface from the start even if it is not yet configured.

When Live TV is unavailable:

- Hide the **Live** navigation item
- Hide Live rows from Home
- Hide Recordings and Scheduled sections

When enabled:

```text
HOME    MOVIES    SERIES    ANIME    LIVE    COLLECTIONS
```

### 11.1 Live Home

Sub-navigation:

```text
LIVE NOW    GUIDE    RECORDINGS    SCHEDULED
```

### 11.2 Live Now

Use large landscape programme cards.

Example:

```text
BBC ONE

The Repair Shop
19:00 - 20:00

██████████████░░░░

42 min remaining
```

Include:

- Channel logo
- Channel name
- Programme title
- Current progress
- Start and end time
- Live status

### 11.3 TV Guide

Use a proper grid layout:

```text
             18:00          18:30          19:00          19:30

BBC ONE      News            │ The One Show │ EastEnders
BBC TWO      Documentary     │              │ Gardeners' World
ITV1         News            │ Emmerdale    │ Coronation Street
CHANNEL 4    Simpsons        │ Hollyoaks    │ News
```

Focus state should use the Velvet Antenna underglow rather than a bright border.

### 11.4 Signal Motif

The antenna theme may appear subtly in Live TV.

Example:

```text
●  )))   LIVE
```

Use a gentle animated pulse.

Avoid flashing or distracting animation.

---

## 12. IPTV

IPTV should appear inside the same Live interface as terrestrial television.

The user should not need to care whether a channel originates from:

- IPTV M3U
- Freeview tuner
- HDHomeRun
- TVHeadend
- Another backend

All channels should feel part of a unified service.

### 12.1 Channel Groups

Possible categories:

```text
FAVOURITES
TERRESTRIAL
NEWS
SPORT
ENTERTAINMENT
MOVIES
KIDS
OTHER
```

Only show useful categories. Avoid excessive fragmentation.

---

## 13. DVR and Recordings

Recordings should be treated as first-class media.

### 13.1 Recordings Screen

```text
RECENT RECORDINGS

[ programme ] [ programme ] [ programme ] [ programme ]


SCHEDULED

Tonight 21:00
Programme Name

Tomorrow 20:00
Programme Name
```

### 13.2 Recording Behaviour

Support:

- One-off recordings
- Series recordings
- Scheduled recordings
- Completed recordings
- Failed recordings
- Recording in progress

### 13.3 Recording Indicators

Use restrained states:

- Violet dot for scheduled
- Pulsing violet dot for currently recording
- Checkmark for complete
- Muted warning icon for failed

---

## 14. Profiles

Profile selection should be simple and elegant.

Example:

```text
WHO'S WATCHING?

     ◉               ◉
   JAMES           DYLAN
```

### 14.1 Profile Customisation

Profiles may have:

- Different library access
- Different home row ordering
- Different parental restrictions
- Different watch history
- Different accent shade within the Velvet Antenna palette

Do not use heavily cartoonish profile graphics unless intentionally selected.

---

## 15. Search

Search should be universal.

Search across:

- Movies
- Series
- Episodes
- Anime
- Collections
- Actors
- Live TV channels
- Programmes
- Recordings

### 15.1 Search Results

Group results by content type rather than presenting one undifferentiated list.

Example:

```text
MOVIES

SERIES

EPISODES

LIVE TV

RECORDINGS
```

---

## 16. Splash and Startup

The splash screen should feel premium and brief.

Sequence:

1. Black screen
2. Velvet Antenna mark fades in
3. Soft violet underglow sweeps beneath the symbol
4. Wordmark appears
5. Transition to home

Target duration:

**1.0 to 1.5 seconds**

No loud sound effects.

No lengthy animation.

---

## 17. Motion

Motion should be restrained.

Recommended:

- 150 to 200 ms card focus transitions
- Soft fade between screens
- Slight scale on selected cards
- Subtle logo pulse while loading
- Gentle Live TV signal pulse
- No bounce effects
- No excessive parallax

Motion must never slow navigation.

---

## 18. Loading States

Avoid generic spinning indicators where possible.

Preferred Velvet Antenna loading state:

- Small version of the ribbon logo
- Soft violet pulse or underglow
- Minimal movement

For content loading:

- Use dark skeleton cards
- Fade artwork in when ready
- Prevent card rows from jumping as images load

---

## 19. Accessibility

The visual design must retain:

- High text contrast
- Readable text from normal TV viewing distance
- Strong focus indication
- Clear selected state
- No reliance on colour alone
- Reduced-motion compatibility
- Large enough click / focus targets
- Subtitle readability over all content

The purple underglow is a signature, but focus should also include scale or brightness changes.

---

## 20. Performance Principles

Velvet Antenna should feel fast even with a large NAS-backed library.

Priorities:

1. Keep the Jellyfin database and metadata on local SSD
2. Cache artwork locally
3. Avoid unnecessary live effects
4. Use CSS transforms for focus animations
5. Avoid heavy blur across large screen regions
6. Avoid animated backgrounds
7. Load only visible artwork where possible
8. Keep hero effects lightweight

The interface should remain responsive while the media itself is stored remotely.

---

## 21. Jellyfin Integration Strategy

### Phase 1: Theme and Branding

Use:

- Jellyfin branding settings
- Custom CSS
- Custom logo
- Custom splash imagery
- Custom colours
- Card sizing
- Navigation styling
- Focus effects
- Typography
- Layout spacing

### Phase 2: Home Experience

Refine:

- Section order
- Hero presentation
- Continue Watching
- Next Up
- Collections
- Anime visibility
- Profile-specific layouts

### Phase 3: Live TV

When configured, add:

- Live navigation
- Guide
- Live Now
- Channel branding
- Recordings
- Scheduled programmes

### Phase 4: Advanced Customisation

Only if necessary:

- Modify or fork Jellyfin Web
- Add custom home components
- Add more advanced hero logic
- Improve collection presentation
- Create bespoke Live TV presentation

The goal is to avoid unnecessary code modifications until CSS and built-in configuration have been exhausted.

---

## 22. Feature Visibility Rules

Velvet Antenna should never show empty product areas.

| Feature | Visibility Rule |
|---|---|
| Movies | Show if library exists |
| Series | Show if library exists |
| Anime | Show if anime library exists |
| Collections | Show if collections exist |
| Live | Show only when Live TV is configured |
| Live Now | Show only when channels are available |
| Guide | Show only when guide data exists |
| Recordings | Show only when DVR is configured or recordings exist |
| Scheduled | Show only when recording schedules exist |

This prevents the UI from feeling unfinished.

---

## 23. World-Class UI Rules

Every screen should follow these rules:

1. **Artwork first**
2. **Navigation must be obvious**
3. **Do not show technical server concepts to viewers**
4. **Purple indicates interaction, not decoration**
5. **Use fewer, stronger elements**
6. **Do not overload the home screen**
7. **Keep text concise**
8. **Collections should feel curated**
9. **Anime should be intentionally supported**
10. **Live TV should feel integrated, not bolted on**
11. **Every feature should disappear gracefully when unused**
12. **Remote-control navigation takes priority over mouse-first design**

---

## 24. Initial Home Screen Specification

Recommended first implementation:

```text
VELVET ANTENNA                           Search     Profile

HOME   MOVIES   SERIES   ANIME   COLLECTIONS


[ HERO AREA ]

Continue Watching
[ landscape ] [ landscape ] [ landscape ] [ landscape ]

Next Up
[ landscape ] [ landscape ] [ landscape ] [ landscape ]

Recently Added Movies
[ poster ] [ poster ] [ poster ] [ poster ] [ poster ]

Recently Added Series
[ poster ] [ poster ] [ poster ] [ poster ] [ poster ]

Your Collections
[ wide card ] [ wide card ] [ wide card ]

Anime
[ landscape ] [ landscape ] [ landscape ] [ landscape ]
```

When Live TV is later enabled:

```text
HOME   MOVIES   SERIES   ANIME   LIVE   COLLECTIONS
```

Add:

```text
Live Now
[ channel / programme cards ]

Recent Recordings
[ landscape cards ]
```

---

## 25. Design Summary

Velvet Antenna should not look like a purple Jellyfin skin.

It should feel like a coherent streaming product with its own identity.

The signature elements are:

- Near-black cinematic backgrounds
- Strong artwork
- Restrained violet accents
- Soft purple underglow
- Clean typography
- Fast television navigation
- Dedicated Movies, Series and Anime experiences
- Future-ready Live TV, IPTV and DVR
- A recognisable Velvet Antenna mark
- Minimal technical clutter

The intended result is a service that looks credible beside mainstream streaming applications while still feeling personal, private and distinctive.

---

## 26. Next Design Steps

1. Finalise Velvet Antenna logo
2. Create app icon variant
3. Create splash screen
4. Create desktop / TV home-screen mock-up
5. Define exact card sizes
6. Define focus and underglow behaviour
7. Create movie detail mock-up
8. Create series detail mock-up
9. Create anime home mock-up
10. Create future Live TV / Guide mock-up
11. Translate approved design into Jellyfin CSS
12. Test on LG webOS
13. Refine for mobile

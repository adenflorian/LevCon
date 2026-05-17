# LevCon

LevCon is a custom Elgato Stream Deck plugin for controlling Windows audio sessions.

It provides paged per-app volume control, mute toggling, page navigation, and a dedicated action for showing or hiding the system output volume tile.

## Features

- Per-app volume control on Stream Deck keys and dials
- Dial rotation adjusts volume
- Dial press, key press, and touch tap toggle mute
- Paged app/session navigation
- Optional pinned output volume tile
- Global priority list and blacklist matching
- Windows native audio helper built with .NET and NAudio

## Actions

The plugin currently exposes these Stream Deck actions:

- `Mixer Slot` - shows one paged audio session slot on a key or encoder
- `Page Left` - moves to the previous page of app slots
- `Page Right` - moves to the next page of app slots
- `Toggle Output Volume` - shows or hides the output volume tile

## Global Settings

The `Mixer Slot` property inspector exposes global settings for:

- `Step Size` - knob increment size for volume changes
- `Priority List` - preferred app ordering matchers
- `Blacklist` - sessions to exclude from the UI

The output volume tile visibility is controlled by the `Toggle Output Volume` action and stored in global settings.

## Project Layout

- [src](c:/Users/David/Projects/personal/levcon/src) - TypeScript plugin source
- [helper/LevCon.AudioHelper](c:/Users/David/Projects/personal/levcon/helper/LevCon.AudioHelper) - native Windows audio helper
- [com.david-valachovic.levcon.sdPlugin](c:/Users/David/Projects/personal/levcon/com.david-valachovic.levcon.sdPlugin) - Stream Deck plugin bundle, manifest, layouts, and UI

## Requirements

- Windows 10 or newer
- Stream Deck 7.1 or newer
- Node.js 24
- .NET 8 SDK

## Build

Install dependencies:

```bash
pnpm install
```

Build the helper and plugin bundle:

```bash
pnpm run build
```

Build only the Windows helper:

```bash
pnpm run build:helper
```

Run the watch workflow:

```bash
pnpm run watch
```

The watch script rebuilds the helper, watches the Rollup bundle, and restarts the Stream Deck plugin after each successful build.

## Development Notes

- The TypeScript plugin entry point is [src/plugin.ts](c:/Users/David/Projects/personal/levcon/src/plugin.ts).
- The main slot rendering/action logic is in [src/actions/mixer-slot.ts](c:/Users/David/Projects/personal/levcon/src/actions/mixer-slot.ts).
- Session enumeration, sorting, filtering, and helper IPC live in [src/services/audio-session-provider.ts](c:/Users/David/Projects/personal/levcon/src/services/audio-session-provider.ts).
- The native helper implementation is in [helper/LevCon.AudioHelper/Program.cs](c:/Users/David/Projects/personal/levcon/helper/LevCon.AudioHelper/Program.cs).

## Plugin Metadata

- Name: `LevCon`
- Plugin UUID: `com.david-valachovic.levcon`
- Description: `Windows Audio Levels Controller`

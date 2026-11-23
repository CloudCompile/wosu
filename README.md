# wosu!

**Play at: [wosu.dino.icu](https://wosu.dino.icu)**

osu! is a rhythm game in which you click circles on the screen, following the rhythm of the music.

wosu! is an unofficial osu!standard and osu!mania client that runs entirely in your browser, without any installation! Beatmaps come from mirrors like ([Sayobot](https://osu.sayobot.cn), [Mino](https://catboy.best), [NeriNyan](https://nerinyan.moe)) or you can upload your own `.osz` files.

wosu! is the successor to [WebOsu 2](https://github.com/WebOsu-2/webosu-2.github.io), itself a continuation of [the original WebOsu](https://github.com/111116/webosu). The classic WebOsu 2 is still online if your device struggles with wosu! or if you just prefer it.

Scoring and judgement follow osu!'s rules closely, but can still differ from official osu!. osu!standard is the main mode; osu!mania (4K, 7K and every other key count) is playable too, with its own judgements, holds, scoring and keys. osu!taiko and osu!catch are not supported yet.

![wosu! gameplay: YOASOBI - Yoru ni Kakeru (Keirelia's Insane) on Autoplay](screenshots/gameplay.gif)

<sub>YOASOBI - Yoru ni Kakeru [Keirelia's Insane], mapped by [Petal](https://osu.ppy.sh/beatmapsets/1238759) (Autoplay).</sub>

## Features
- Base osu!standard gameplay loop
- osu!mania: keyed notes and holds, 320/300/200/100/50/miss judgements, per-column HUD, autoplay and replays
- Mods: EZ, NF, HT, DC, HR, SD, PF, DT, NC, HD, FL, RX, AP, SO and Autoplay
- Download beatmaps in-game, with several default beatmaps and the option to import your own
- Full HUD with difficulty visualization bars, click counters, and more
- Extra configuration and features like storyboards, beatmap skins and hitsounds, background video, background dim/blur, mouse/keyboard/touch input, volume meters, notifications, a now-playing panel, and everything saved locally in your browser.
- A graphics preset (Settings → Graphics): Automatic reads this device (CPU cores, memory, phone or not, and the GPU's name: Intel UHD vs Iris Xe vs Arc, GTX vs RTX, Apple M1 vs M2 Pro, Adreno/Mali, software rendering) and picks a level, and Performance / Balanced / Quality set render resolution, anti-aliasing, background effects, storyboards, videos, hit lighting and cursor extras all at once.
- Personalize (Settings → Graphics): benchmarks this device for about three seconds — four short CPU workloads and a synthetic playfield rendered off-screen at 100/90/80/70% of the display's pixels, timed to the GPU — shows every number while it runs and a full report afterwards (CPU index, GPU tier, fill rate, frame budget, why each choice was made), and sets the render scale and effects to fit. The run is bounded by time, stops itself on a stall or if the tab is hidden (a background tab cannot time frames), and its last result is kept for the next launch.
- Device detection you can argue with: every input (`deviceMemory`, core count, mobile-ness, the renderer string) is optional, anything unknown lands in the middle tier rather than the top, software renderers (SwiftShader, llvmpipe) count as the lowest GPU, and phones never rate above integrated. `?tiers=cpu,gpu` (or `?tiers=high`) overrides the answer, and `wosuHardware()` in the console prints exactly what was read, what was concluded and why.

## Controls

| Action | Default |
| --- | --- |
| Hit | `Z` / `X`, mouse buttons, or tap |
| Pause | `Esc` (or hold the bottom-right button) |
| Skip intro | `Space` |
| Quick retry | hold `` ` `` |
| Cycle HUD visibility / peek at HUD | `Shift` + `Tab` / hold `Ctrl` |
| Mods / random beatmap (song select) | `F1` / `F2` |
| Settings / beatmap listing / notifications | `Ctrl+O` / `Ctrl+D` / `Ctrl+N` |
| Volume | `Alt` + mouse wheel, `Alt` + `↑`/`↓` |

Gameplay keys can be rebound in Settings → Input.

## osu!mania controls

osu!mania maps use one key per column, laid out like osu!mania's own defaults:

| Keys | Columns |
| --- | --- |
| 1K | `Space` |
| 2K | `F` `J` |
| 3K | `F` `Space` `J` |
| 4K | `D` `F` `J` `K` |
| 5K | `D` `F` `Space` `J` `K` |
| 6K | `S` `D` `F` `J` `K` `L` |
| 7K | `S` `D` `F` `Space` `J` `K` `L` |
| 8K | `A` `S` `D` `F` `J` `K` `L` `;` |
| 9K | `A` `S` `D` `F` `Space` `J` `K` `L` `;` |
| 10K | `A` `S` `D` `F` `V` `N` `J` `K` `L` `;` |

Wider maps add the keys `Q W E R U I O P` and the digits. Holds keep their key down until the tail. The per-column key overlay replaces the standard click counters.

Every key count's columns can be rebound in Settings → Input → osu!mania key bindings: click a column's key, press the key you want (`Esc` cancels), and right-click it to put back the default. Binding a key another column of the same layout already uses takes it from that column.

Holds are judged like lazer's: the head is a note judged on the press, and the tail is judged on the release against windows 1.5× the note's, so both count toward the score and combo. Letting go before the tail's window breaks the hold (the combo breaks) and limits its tail to a 50; pressing the column again before the tail picks the hold back up.

## Development

Requires Node.js 22 or newer.

```bash
npm install
npm run dev        # dev server with hot reload
npm test           # unit tests (Vitest)
npm run typecheck  # TypeScript
npm run build      # typecheck + production build into dist/
```

Every push and pull request runs CI (typecheck, tests, build). The site is hosted on [Vercel](https://vercel.com): pushes to `main` deploy to production, and pull requests get preview deployments. `dist/` is plain static files with relative paths, so it can be served from any host or sub-path.

See [CONTRIBUTING.md](CONTRIBUTING.md) for how to report bugs and send changes.

### Layout

| Path | What lives there |
| --- | --- |
| `src/app` | The Pixi application, layer stack, screen stack, overlays, music controller, background, cursors |
| `src/beatmap` | `.osu` parsing, slider curves, mod processing (stacking, combos, slider events), `.osz` archives, the local library, star ratings |
| `src/gameplay` | Rules and judgement (headless and unit tested), score/health processors, autoplay, input, hitsounds, playfield drawables and HUD |
| `src/graphics` | GPU slider renderer (shaders for WebGL and WebGPU) and texture helpers |
| `src/skin` | osu! skins (imported `.osk`, beatmap skins) and wosu!'s own skin, which is drawn in code from its options in Settings → Skin (`src/skin/wosu`; `node tools/default-skin/build.mjs` writes it out as an osu! skin folder) |
| `src/screens` | Intro, main menu, song select, player loader, player, results |
| `src/overlays` | Toolbar, settings, beatmap listing, mod select, notifications, now playing, volume, dialogs |
| `src/ui` | The small UI framework every screen is built from (buttons, text boxes, sliders, dropdowns, scroll containers, tooltips, triangles) |
| `src/audio`, `src/online`, `src/storage` | Web Audio engine, mirror APIs and downloads, IndexedDB storage |
| `public/assets` | Skin atlas, cursor textures, hitsounds and fonts; `art/sprites` holds the source sprites of the atlas |

## License notes

The code is MIT licensed. Some media files are copyrighted by [ppy](https://github.com/ppy/) and others; check their respective licenses before you use them. Exo 2 is licensed under the SIL Open Font License (see `public/assets/fonts/Exo2-OFL.txt`).

The menu cursor and cursor trail textures in `public/assets/skin/cursor/` come from [ppy/osu-resources](https://github.com/ppy/osu-resources) and are licensed under [CC BY-NC 4.0](https://creativecommons.org/licenses/by-nc/4.0/).

wosu! is not affiliated with or endorsed by ppy. osu! is a trademark of ppy Pty Ltd.

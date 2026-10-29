# Blackmagic output — checklist for the Mac mini

OverlaySys can send a channel to a Blackmagic output device (first target: the
stage channel on the **UltraStudio Express Monitor 3G**, cabled UltraStudio →
SDI → SDI-to-HDMI converter → TV). It drives the card through an ffmpeg built
with Blackmagic support — the same one Narthex TV uses. OverlaySys can't ship
that ffmpeg (licence), so it is built once on the Mac mini.

Run the checks in order and paste the output of each back into the
conversation. Checks 1–3 don't need the new OverlaySys build; check 4 does.

## 0. Build the ffmpeg (once)

Narthex TV's script does it. Read the "Match the SDK to the driver" section of
`~/WebstormProjects/GRMCApps/scripts/narthex-tv/README.md` first.

1. Open **Desktop Video Setup → About** and note the driver version.
2. Download the **Desktop Video SDK** with the same version from
   <https://www.blackmagicdesign.com/support> (behind a name/email form).
3. Build:

   ```sh
   brew install freetype pkg-config   # optional; harmless
   ~/WebstormProjects/GRMCApps/scripts/narthex-tv/build-ffmpeg-decklink.sh ~/Downloads/Blackmagic_DeckLink_SDK_<version>
   ```

   It installs `~/.local/bin/ffmpeg-decklink`. If you put it elsewhere, set the
   path in OverlaySys **Settings → Connection → Blackmagic output**.

## 1. Does ffmpeg see the card?

```sh
~/.local/bin/ffmpeg-decklink -hide_banner -sinks decklink
```

**Pass:** a line containing `UltraStudio Express Monitor 3G`.
**Fail:** `Unknown output format` → the ffmpeg has no Blackmagic support
(rebuild with the script). An empty list → driver not installed or the card
isn't connected (check Desktop Video Setup sees it).

## 2. Card and TV, without OverlaySys

Quit OverlaySys first, then:

```sh
~/.local/bin/ffmpeg-decklink -hide_banner -f lavfi \
  -i testsrc2=size=1920x1080:rate=60000/1001 \
  -an -c:v v210 -f decklink 'UltraStudio Express Monitor 3G'
```

**Pass:** the TV shows a colour pattern with a counter that keeps moving for a
minute. Ctrl-C to stop.

| What you see | What it means |
| --- | --- |
| Counter moves for ~1 s then freezes | SDK and driver versions don't match. Rebuild against the SDK matching Desktop Video Setup → About. |
| Solid red | Wrong output codec (should never happen with the command above). |
| `Could not enable video output!` | Something else holds the card. Run `pgrep -fl ffmpeg-decklink`; quit it (it can need several `kill` calls). |
| `Unsupported video size, framerate or field order` | The card refuses 1080p59.94 — tell me which mode Desktop Video Setup lists. |
| TV says no signal, ffmpeg runs fine | Converter or cable. Check the converter's input light. |

## 3. Does the UltraStudio show up as a sound output?

While check 2 is running, open **System Settings → Sound → Output**.

Report: is the UltraStudio (or "Blackmagic") listed? This decides whether
video sound can go out the SDI with no extra work.

## 4. OverlaySys on the TV (after the new build is installed)

1. Quit anything that ran check 2.
2. In OverlaySys, open **Settings → Connection → Blackmagic output** and press
   **Check**. It should show the ffmpeg version and the UltraStudio.
3. Open the stage channel's window settings (the dot next to the channel),
   set **Output** to the UltraStudio, keep **Signal format** 1080p59.94, tick
   **Auto-open at launch** if wanted, save, and open the channel.
4. Leave it running for 10 minutes while you take a few rows.

**Pass:**
- the stage layout is on the TV and changes with takes, with no flash or
  "no signal" in between;
- **Outputs** shows the stage channel connected, named after the card;
- the app log (Help → Reveal logs) has `[decklink]` lines around
  `599 frames in 10s`;
- after quitting OverlaySys, `pgrep -fl ffmpeg-decklink` prints nothing.

Report the `[decklink]` lines and OverlaySys's CPU in Activity Monitor.

**If frames are well under 599 per 10 s** (the Mac mini can't keep up), quit
and relaunch with the page rendering at half rate (the TV still gets
59.94):

```sh
OVERLAYSYS_DECKLINK_RENDER_FPS=30 open -a OverlaySys
```

and report the same numbers again.

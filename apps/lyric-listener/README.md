# Lyric Listener — STT setup & usage guide

The lyric listener is a small Node script that connects to OverlaySys's WebSocket server, registers as an STT source, reads recognized text from stdin, and forwards each line as an `stt_hypothesis` message. The server-side matcher does the rest — picks the best slide for the current song, broadcasts an `stt_match` to the operator UI, and (when Trust Mode is on) auto-advances the cursor.

The daemon itself does no audio capture and no speech recognition. Those are external — you pipe a real STT process into the daemon's stdin. This guide covers the realistic configurations.

## Pipeline

```
[audio source] → [audio capture] → [STT engine] → [lyric-listener daemon] → [OverlaySys WS server] → [matcher] → [operator UI]
```

Each arrow is a unix pipe (or a network connection in the last hop). The daemon's only job is the last shell hop: turn an STT process's stdout into WS messages.

## What you need

| Component | Purpose | Recommended |
|---|---|---|
| Audio capture | Get vocal audio into a unix pipe | **sox** (cross-platform) |
| STT engine | Recognize speech, emit text | **whisper.cpp** (local, offline) |
| Speech model | The actual ML weights | **ggml-base.en** (~140MB, fast on CPU) |
| OverlaySys server | Receives hypotheses | already running |
| Lyric-listener daemon | Pipes STT stdout to WS | this package |

Cloud STT (Deepgram, AssemblyAI, OpenAI Whisper API) works as a drop-in alternative — the daemon doesn't care where the text came from, only that one line of recognized text appears on stdin per "hypothesis." A cloud-API wrapper is sketched at the bottom.

## Step 1 — Install whisper.cpp

### macOS (recommended path)

```bash
brew install whisper-cpp
```

This gives you `whisper-cli` (and on most installs `whisper-stream`) on your `PATH`. Verify:

```bash
whisper-cli --help | head -5
```

### Linux

Prebuilt binaries don't exist on Linux package managers in 2026. Build from source:

```bash
git clone https://github.com/ggml-org/whisper.cpp.git
cd whisper.cpp
make            # builds whisper-cli
make stream     # builds the streaming example
sudo cp build/bin/whisper-cli /usr/local/bin/
sudo cp build/bin/stream /usr/local/bin/whisper-stream
```

### Windows

Use WSL2 with the Linux instructions, or grab a prebuilt release from the whisper.cpp GitHub releases page. Native Windows builds work but are out of scope here.

## Step 2 — Download a model

Whisper.cpp uses GGML-format models. For worship use, **base.en** is the sweet spot — fast on a laptop CPU, accurate enough for English vocals.

```bash
mkdir -p ~/whisper-models
cd ~/whisper-models
curl -LO https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin
```

Model sizes (English-only variants):

| Model | Size | Speed (CPU) | Notes |
|---|---|---|---|
| `tiny.en` | 75MB | ~10x realtime | Often misses lyrics on quiet/echoey vocals |
| **`base.en`** | 142MB | ~7x realtime | **Recommended.** Best size/quality tradeoff |
| `small.en` | 466MB | ~3x realtime | Better accuracy, still real-time |
| `medium.en` | 1.5GB | ~1x realtime | Best accuracy, needs a strong CPU |

The matcher is forgiving — base.en will mishear "I once was lost but now am found" as "I once was lost but now I'm found" and the matcher will still score it correctly because it scores token overlap, not exact text match.

## Step 3 — Install audio capture (sox)

### macOS

```bash
brew install sox
```

### Linux

```bash
sudo apt install sox            # Debian/Ubuntu
sudo dnf install sox            # Fedora
sudo pacman -S sox              # Arch
```

Verify it can see your audio devices:

```bash
sox -d -r 16000 -c 1 -t wav - 2>&1 | head -3
# (Press Ctrl-C — you should see WAV header bytes streaming, not an error)
```

If you see "no default audio device" or similar, see [Audio routing](#audio-routing) below.

## Step 4 — Run OverlaySys server

In the OverlaySys repo:

```bash
pnpm install   # only first time
pnpm dev       # starts server, operator, renderer
```

Confirm the server is up:

```bash
curl -s http://localhost:4000/health
# {"ok":true,"time":...}
```

## Step 5 — Smoke-test the daemon (manual stdin)

Before connecting real STT, verify the daemon connects and the matcher works:

```bash
# Terminal 1: start the daemon, type lines manually
cd path/to/OverlaySys
echo "amazing grace how sweet the sound" | node apps/lyric-listener/src/stdin.mjs
```

You should see something like:

```
[lyric-listener] connected; registered as stdin-yourhostname
[stt_match] 100% → section 1, slide 1  | "amazing grace how sweet the sound"
[lyric-listener] disconnected
```

Open the operator UI at `http://localhost:3000`, take a song row, and verify the "🎤 STT × 1" pill appears in the SongModePanel header. With Trust Mode off, the matched slide gets a dashed green outline. Toggle Trust Mode on and the cursor will auto-advance to high-confidence matches after a 300ms debounce.

## Step 6 — Wire up live audio + whisper

### Option A — `whisper-stream` (sliding-window, low latency)

`whisper-stream` (the streaming example program from whisper.cpp) does continuous transcription with overlapping windows. This is the recommended live mode.

```bash
whisper-stream \
  -m ~/whisper-models/ggml-base.en.bin \
  --step 500 \
  --length 5000 \
  --keep 200 \
  -t 4 \
  | node apps/lyric-listener/src/stdin.mjs
```

Flag rundown:

- `--step 500` — emit a new transcript every 500ms
- `--length 5000` — each transcript is computed over a 5-second window
- `--keep 200` — context overlap; smooths sudden phrase boundaries
- `-t 4` — threads. Bump up if your CPU has spare cores

`whisper-stream` writes refined partial transcripts to stdout using carriage returns to overwrite the current line, then `\n` when a segment finalizes. The daemon understands this — it splits on `\r` as well as `\n`, strips ANSI escapes, and dedupes consecutive identical segments — so the matcher sees clean hypotheses without re-processing the same partial repeatedly.

### Option B — Sliding `sox` chunks + `whisper-cli`

If your install of whisper.cpp didn't include the streaming example, fall back to chunking with sox:

```bash
while true; do
  sox -d -r 16000 -c 1 -b 16 -t wav /tmp/chunk.wav trim 0 1.5
  whisper-cli -m ~/whisper-models/ggml-base.en.bin --no-timestamps -f /tmp/chunk.wav 2>/dev/null
done | node apps/lyric-listener/src/stdin.mjs
```

This is poor man's streaming — record 1.5s, transcribe it, repeat. Latency is ~2.5s end-to-end vs. ~1s for the streaming option. Acceptable for testing, not great for live worship.

## Audio routing

The "audio source" is whatever device sox sees as `-d` (default input). On macOS:

```bash
# List devices visible to coreaudio
system_profiler SPAudioDataType | grep -A1 "Input"

# Use a specific device
sox -t coreaudio "USB Audio CODEC" -r 16000 -c 1 -b 16 -t wav -
```

Realistic worship setups:

| Setup | Audio routing |
|---|---|
| **USB return from FOH mixer** to the operator laptop | Set the USB device as macOS default input. `sox -d` picks it up. |
| **BlackHole virtual audio cable** capturing system audio (e.g. you're playing the band through the laptop) | Install [BlackHole](https://existential.audio/blackhole/), set it as default input, pass-through to your speakers via Audio MIDI Setup. |
| **Loopback / Soundflower / VB-Cable** (Windows or older macOS) | Same idea — virtual cable as default input. |
| **Bluetooth headset on the operator** picking up the room | Works in a pinch but quality is bad. Consider a wired USB lav. |

The vocal feed must be reasonably isolated. The matcher tolerates mishears but it can't recover if the input is band + crowd + room noise mashed together.

## Configuring the daemon

Environment variables:

| Var | Default | Purpose |
|---|---|---|
| `WS_URL` | `ws://localhost:4000/ws` | Server WebSocket URL |
| `AUDIO_SOURCE_ID` | `stdin-<hostname>` | Unique id; the operator UI shows this in the listener pill tooltip |
| `LABEL` | `stdin` | Human-readable label shown in the listener pill |

Example, running from a separate audio PC:

```bash
WS_URL="ws://10.0.0.50:4000/ws" \
LABEL="Vocal STT (Aux 3)" \
AUDIO_SOURCE_ID="vocal-aux3" \
whisper-stream -m ~/whisper-models/ggml-base.en.bin --step 500 --length 5000 \
  | node apps/lyric-listener/src/stdin.mjs
```

## Verifying it works end-to-end

1. Start `pnpm dev` in OverlaySys
2. Open operator at `http://localhost:3000` and renderer at `http://localhost:3001/?channel=program`
3. Take a song row from the rundown
4. Start the listener (whisper-stream | daemon)
5. Speak (or play recorded vocals into) the audio source
6. **Operator UI**: the "🎤 STT × 1" pill turns green, the STT status row shows the recognized phrase + confidence, the matched slide gets a dashed green outline
7. Toggle Trust Mode on; speak the next line; the cursor auto-advances after ~300ms

## Tuning

Server-side thresholds are in `server/src/sttMatcher.ts`:

```ts
export const MIN_EMIT_THRESHOLD = 0.30;    // below this, no stt_match emitted at all
export const AUTO_TAKE_THRESHOLD = 0.65;   // trust-mode auto-advance fires above this
```

Symptoms and fixes:

| Symptom | Likely cause | Fix |
|---|---|---|
| Auto-advance fires on the wrong slide | Threshold too low for your audio | Raise `AUTO_TAKE_THRESHOLD` toward 0.75 |
| Auto-advance never fires even on clean vocals | STT misrecognizes too many words | Use a bigger model (`small.en` instead of `base.en`) or lower the threshold |
| Lots of "no match" on every hypothesis | Vocal audio is too quiet or noisy | Boost mic gain at the source; check sox sees real signal with `sox -d ... -n stat` |
| Latency feels too high | Window too long | Drop `--length 5000` to `--length 3000` |
| CPU pegged | Model too big OR too few threads | Use `base.en` not `small.en`; increase `-t` to physical core count |

## Cloud STT alternative

If you don't want to install whisper.cpp, any service that produces line-delimited text on stdout works. A minimal OpenAI Whisper API wrapper (Bash):

```bash
#!/bin/bash
# Records 5-second chunks and pipes each transcript as a single stdout line.
while true; do
  sox -d -r 16000 -c 1 -b 16 /tmp/chunk.wav trim 0 5
  curl -sS https://api.openai.com/v1/audio/transcriptions \
    -H "Authorization: Bearer $OPENAI_API_KEY" \
    -F "model=whisper-1" \
    -F "file=@/tmp/chunk.wav" \
    -F "response_format=text"
  echo
done
```

Pipe that into `node apps/lyric-listener/src/stdin.mjs`. Caveats: per-minute cost, network round-trip latency (~1s extra), online-only.

## Troubleshooting

**"connection refused" from the daemon.** Server isn't running, or `WS_URL` is wrong. Confirm `curl http://localhost:4000/health` works.

**Daemon connects but no `stt_match` ever logged.** Check that you've taken a song row. The matcher only runs when a SongSession is active. The daemon logs every match it receives — if nothing appears, the server's matcher isn't producing any. Verify hypotheses are actually being sent by checking `[stt_match]` lines.

**Listener pill stays gray.** The `stt_listener_register` message wasn't received or rejected. Check the server log for `bad_message`. Confirm your daemon is up-to-date with the protocol; pull the latest from the repo.

**Trust mode never auto-advances.** Check the confidence in the STT status row. If you're hovering at 0.40-0.60, you're below `AUTO_TAKE_THRESHOLD`. Use a bigger model or lower the threshold.

**Whisper repeats hallucinated phrases.** A known whisper.cpp quirk on silence. The matcher's `MIN_EMIT_THRESHOLD` filters most of these out. If hallucinated text matches a slide by coincidence, raise `MIN_EMIT_THRESHOLD` slightly.

## What lives where

| Path | Purpose |
|---|---|
| `apps/lyric-listener/src/stdin.mjs` | The daemon. Reads stdin → sends `stt_hypothesis` |
| `server/src/sttMatcher.ts` | Per-session token-overlap scoring |
| `server/src/sttListener.ts` | Listener registry (online/offline tracking) |
| `server/src/songSession.ts` | Trust-mode auto-advance with debounce |
| `packages/ws-protocol/src/index.ts` | Wire format for `stt_*` messages |
| `apps/operator/src/app/components/SongModePanel.tsx` | Trust toggle, listener pill, STT match indicator |
| `server/scripts/stt-smoke.mjs` | End-to-end smoke test (no audio, no whisper required) |

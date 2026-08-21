# My Call Clone — your own phone-callable Grok voice bot

Yes, what you saw in that video is real. **xAI (X)** launched:

1. **Grok Voice Agent API** — a real-time **speech-to-speech** model (`grok-voice-latest`,
   currently `grok-voice-think-fast-1.0`). One model listens and talks directly — no separate
   speech-to-text → LLM → text-to-speech chain — over a WebSocket that is compatible with the
   OpenAI Realtime API spec. Docs: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
2. **Voice Agent Builder** (July 1, 2026, beta) — a no-code service at xAI where you configure a
   voice bot with a prompt, pick a voice, and **they give you a free phone number** people can
   call. Audio is priced from **$0.05/minute**. Announcement: https://x.ai/news/grok-voice-agent-builder

This repo is the **do-it-yourself version of that service**: a small Node.js server that bridges
a phone number (Twilio) to Grok's speech-to-speech model, so you fully own the code, the prompt,
the tools, and the number.

```
 Caller ── PSTN ──> Twilio number ── Media Streams (WebSocket, G.711 μ-law) ──> this server
                                                                                   │
                                                              wss://api.x.ai/v1/realtime
                                                                                   │
                                                                      Grok speech-to-speech
```

Because Grok supports G.711 μ-law natively (the telephone codec Twilio uses), audio passes
straight through in both directions with no transcoding — which is what keeps latency low.

---

## Option A — no code at all (fastest)

If you just want the thing from the video:

1. Go to the xAI console (https://console.x.ai) → **Voice Agent Builder**.
2. Write your agent's instructions, pick a voice (eve, ara, rex, sal, leo, or clone your own).
3. Grab the **free phone number** included with the account and call it.

Done — no servers, ~$0.05/min. Use this repo instead when you want your own logic, your own
tools/APIs wired in, call recordings, or numbers in countries the builder doesn't cover.

## Option B — this repo (your own stack)

### What you need

| Thing | Where |
|---|---|
| xAI API key | https://console.x.ai |
| Twilio account + a voice-capable phone number | https://console.twilio.com (trial works) |
| Node.js ≥ 18 | https://nodejs.org |
| A public URL for local dev | https://ngrok.com (or any tunnel/host) |

### Setup

```bash
git clone https://github.com/imojbaba/My-call-clone.git
cd My-call-clone
npm install
cp .env.example .env    # then edit .env: XAI_API_KEY + Twilio values
npm start
```

Expose the server publicly (local dev):

```bash
ngrok http 3000
```

Then in the Twilio console → **Phone Numbers → your number → Voice Configuration**, set
**"A call comes in"** to *Webhook*, `HTTP POST`, URL:

```
https://<your-ngrok-subdomain>.ngrok-free.app/incoming-call
```

**Call your Twilio number.** The bot greets you and you can talk to it — interrupting it
mid-sentence works (barge-in is handled).

### Make the bot call *you* (outbound)

```bash
npm run call -- +91XXXXXXXXXX
```

(Requires `PUBLIC_HOST` set in `.env`. Twilio trial accounts can only call verified numbers.)

### Configuration (`.env`)

| Variable | Meaning | Default |
|---|---|---|
| `XAI_API_KEY` | xAI API key | — (required) |
| `GROK_MODEL` | Speech-to-speech model | `grok-voice-latest` |
| `GROK_VOICE` | `eve` `ara` `rex` `sal` `leo` or custom clone | `eve` |
| `SYSTEM_INSTRUCTIONS` | The bot's personality and rules | friendly assistant |
| `GREETING` | First thing the bot says (empty = caller speaks first) | hello message |
| `PORT` | Server port | `3000` |
| `LOG_EVENTS` | Log every Grok event type | `false` |
| `TWILIO_*`, `PUBLIC_HOST` | Only needed for outbound calls | — |

### How the bridge works (`src/server.js`)

- `/incoming-call` returns TwiML telling Twilio to open a bidirectional **Media Stream** to
  `/media-stream`.
- For each call, the server opens `wss://api.x.ai/v1/realtime?model=grok-voice-latest`
  (Bearer auth) and sends `session.update` with your voice + instructions, `server_vad` turn
  detection, and `g711_ulaw` audio in/out.
- Caller audio frames from Twilio are forwarded as `input_audio_buffer.append`; Grok's
  `response.output_audio.delta` chunks are forwarded back as Twilio `media` frames.
- When the caller interrupts, Grok emits `input_audio_buffer.speech_started`; the server sends
  `conversation.item.truncate` (so the model's memory matches what was actually heard) and a
  Twilio `clear` (so buffered audio stops playing immediately).

### Costs

- **Grok voice**: from ~$0.05/min of audio (see https://x.ai/api/voice for current pricing).
- **Twilio**: number rental (~$1–few $/mo) + per-minute voice rates for your country.

### Where to take it next

- **Function calling / tools** — the Realtime-compatible API supports tools; add them to the
  `session.update` payload and handle `response.function_call_arguments.done` events to let the
  bot book appointments, look things up, etc.
- **LiveKit / Pipecat** — xAI ships a LiveKit plugin, and Pipecat has a Grok realtime service,
  if you outgrow the raw-WebSocket bridge.
- **Deploy** — any Node host with WebSocket support (Fly.io, Railway, Render, a VPS) replaces
  ngrok; put the public hostname in the Twilio webhook and `PUBLIC_HOST`.

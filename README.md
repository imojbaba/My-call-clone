# My Call Clone — your own phone-callable Grok voice bot

Yes, what you saw in that video is real, and it is all **X (xAI)** — no third-party telephony,
no test numbers. xAI launched:

1. **Grok Voice Agent API** — a real-time **speech-to-speech** model (`grok-voice-latest`,
   currently `grok-voice-think-fast-1.0`). One model listens and talks directly — no separate
   speech-to-text → LLM → text-to-speech chain — over a WebSocket that is compatible with the
   OpenAI Realtime API spec. Docs: https://docs.x.ai/developers/model-capabilities/audio/voice-agent
2. **Voice Agent Builder** (https://x.ai/voice, launched July 1, 2026) — a no-code service where
   you configure a voice bot with a prompt, pick a voice, and xAI gives you a **free, real phone
   number** on their own phone service. Announcement: https://x.ai/news/grok-voice-agent-builder

## The thing from the video — personal calling, X only, no code

Everything runs on xAI's side; you never touch a server or a telecom provider:

1. Sign in at the xAI console (https://console.x.ai) and open the **Voice Agent Builder**
   (https://x.ai/voice).
2. Create your agent: write its instructions/personality and pick a voice — eve, ara, rex, sal,
   leo, or clone your own voice. xAI says an agent takes under 2 minutes to deploy, and you can
   test it right in the browser first.
3. Every account ships with a **free phone number** — a real, dialable number, not a trial/test
   number. Attach it to your agent.
4. Save that number in your contacts and call your bot whenever you like.

**Cost:** the number itself is free; usage is ~**$0.05/min** of audio plus **$0.01/min** phone
service on xAI numbers. Grok Voice speaks 25+ languages and handles noisy phone audio, accents,
and interruptions.

**Growing beyond the builder:** the same platform lets you bring an existing number via **SIP**,
wire the agent to your own APIs and MCP servers as tools, or connect your own client over
WebSocket — so a personal bot can graduate into one that actually does things for you.

## This repo — the DIY version (optional, for owning the code)

The rest of this repo is the **do-it-yourself version of that service**: a small Node.js server
that bridges a phone number (via Twilio) to the same Grok speech-to-speech model. Use it only if
you want to own the code end-to-end — custom call logic, your own tools, recordings, or numbers
in countries xAI doesn't cover.

```
 Caller ── PSTN ──> Twilio number ── Media Streams (WebSocket, G.711 μ-law) ──> this server
                                                                                   │
                                                              wss://api.x.ai/v1/realtime
                                                                                   │
                                                                      Grok speech-to-speech
```

Because Grok supports G.711 μ-law natively (the telephone codec Twilio uses), audio passes
straight through in both directions with no transcoding — which is what keeps latency low.

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

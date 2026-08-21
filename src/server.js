import Fastify from "fastify";
import fastifyFormBody from "@fastify/formbody";
import fastifyWs from "@fastify/websocket";
import WebSocket from "ws";
import { config, assertServerConfig } from "./config.js";

assertServerConfig();

const fastify = Fastify({ logger: false });
fastify.register(fastifyFormBody);
fastify.register(fastifyWs);

fastify.get("/", async () => ({
  status: "ok",
  service: "my-call-clone",
  model: config.grokModel,
  voice: config.voice,
}));

// Twilio hits this webhook when someone dials your number (and for outbound
// calls placed by src/outbound-call.js). The returned TwiML tells Twilio to
// open a bidirectional media stream to our /media-stream WebSocket.
fastify.all("/incoming-call", async (request, reply) => {
  const host = request.headers["x-forwarded-host"] ?? request.headers.host;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://${host}/media-stream" />
  </Connect>
</Response>`;
  reply.type("text/xml").send(twiml);
});

fastify.register(async (app) => {
  app.get("/media-stream", { websocket: true }, (twilioWs) => {
    console.log("Twilio media stream connected");

    const grokWs = new WebSocket(
      `${config.grokRealtimeUrl}?model=${encodeURIComponent(config.grokModel)}`,
      { headers: { Authorization: `Bearer ${config.xaiApiKey}` } },
    );

    let streamSid = null;
    let greeted = false;
    // Twilio timestamps let us tell the model how much of its answer the
    // caller actually heard before interrupting (for conversation.item.truncate).
    let latestMediaTimestamp = 0;
    let responseStartTimestamp = null;
    let lastAssistantItem = null;
    let markQueue = [];

    const sendToGrok = (msg) => {
      if (grokWs.readyState === WebSocket.OPEN) grokWs.send(JSON.stringify(msg));
    };
    const sendToTwilio = (msg) => {
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.send(JSON.stringify(msg));
    };

    const configureSession = () => {
      sendToGrok({
        type: "session.update",
        session: {
          voice: config.voice,
          instructions: config.instructions,
          turn_detection: { type: "server_vad" },
          // Twilio Media Streams speak 8 kHz G.711 μ-law; Grok supports it
          // natively, so audio passes through both ways with no transcoding.
          input_audio_format: "g711_ulaw",
          output_audio_format: "g711_ulaw",
        },
      });
    };

    const sendGreeting = () => {
      if (greeted || !config.greeting) return;
      greeted = true;
      sendToGrok({
        type: "response.create",
        response: {
          instructions: `Greet the caller first. Say something like: "${config.greeting}"`,
        },
      });
    };

    const handleSpeechStarted = () => {
      // Caller barged in: truncate the assistant turn at the point the caller
      // stopped listening, and flush audio Twilio has buffered but not played.
      if (markQueue.length > 0 && responseStartTimestamp !== null) {
        if (lastAssistantItem) {
          sendToGrok({
            type: "conversation.item.truncate",
            item_id: lastAssistantItem,
            content_index: 0,
            audio_end_ms: Math.max(0, latestMediaTimestamp - responseStartTimestamp),
          });
        }
        sendToTwilio({ event: "clear", streamSid });
        markQueue = [];
        lastAssistantItem = null;
        responseStartTimestamp = null;
      }
    };

    grokWs.on("open", () => {
      console.log("Connected to Grok realtime API");
      configureSession();
      // Fallback in case the server never emits session.updated.
      setTimeout(sendGreeting, 1500);
    });

    grokWs.on("message", (data) => {
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return;
      }
      if (config.logEvents) console.log("grok:", event.type);

      switch (event.type) {
        case "session.updated":
          sendGreeting();
          break;

        // Older and newer Realtime-spec names for the same audio chunk event.
        case "response.audio.delta":
        case "response.output_audio.delta":
          if (event.delta) {
            sendToTwilio({
              event: "media",
              streamSid,
              media: { payload: event.delta },
            });
            if (responseStartTimestamp === null) {
              responseStartTimestamp = latestMediaTimestamp;
            }
            if (event.item_id) lastAssistantItem = event.item_id;
            sendToTwilio({ event: "mark", streamSid, mark: { name: "responsePart" } });
            markQueue.push("responsePart");
          }
          break;

        case "input_audio_buffer.speech_started":
          handleSpeechStarted();
          break;

        case "response.done":
          responseStartTimestamp = null;
          break;

        case "error":
          console.error("Grok error event:", JSON.stringify(event));
          break;
      }
    });

    grokWs.on("close", (code, reason) => {
      console.log(`Grok connection closed (${code}) ${reason || ""}`);
      if (twilioWs.readyState === WebSocket.OPEN) twilioWs.close();
    });
    grokWs.on("error", (err) => console.error("Grok connection error:", err.message));

    twilioWs.on("message", (data) => {
      let msg;
      try {
        msg = JSON.parse(data);
      } catch {
        return;
      }

      switch (msg.event) {
        case "start":
          streamSid = msg.start.streamSid;
          latestMediaTimestamp = 0;
          responseStartTimestamp = null;
          console.log(`Call started, streamSid=${streamSid}`);
          break;

        case "media":
          latestMediaTimestamp = Number(msg.media.timestamp);
          sendToGrok({ type: "input_audio_buffer.append", audio: msg.media.payload });
          break;

        case "mark":
          markQueue.shift();
          break;

        case "stop":
          console.log("Call ended");
          break;
      }
    });

    twilioWs.on("close", () => {
      console.log("Twilio media stream closed");
      if (grokWs.readyState === WebSocket.OPEN || grokWs.readyState === WebSocket.CONNECTING) {
        grokWs.close();
      }
    });
    twilioWs.on("error", (err) => console.error("Twilio stream error:", err.message));
  });
});

fastify.listen({ port: config.port, host: "0.0.0.0" }, (err) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`my-call-clone listening on port ${config.port}`);
  console.log(`Point your Twilio number's voice webhook at: https://<your-public-host>/incoming-call`);
});

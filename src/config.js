import dotenv from "dotenv";

dotenv.config();

const {
  XAI_API_KEY,
  GROK_REALTIME_URL = "wss://api.x.ai/v1/realtime",
  GROK_MODEL = "grok-voice-latest",
  GROK_VOICE = "eve",
  SYSTEM_INSTRUCTIONS = "You are a friendly, helpful voice assistant on a phone call. " +
    "Keep answers short and conversational — one or two sentences unless asked for more. " +
    "Match the caller's language (for example Hindi, Hinglish, or English).",
  GREETING = "Hello! I'm your Grok-powered assistant. How can I help you today?",
  PORT = "3000",
  LOG_EVENTS = "false",
} = process.env;

export const config = {
  xaiApiKey: XAI_API_KEY,
  grokRealtimeUrl: GROK_REALTIME_URL,
  grokModel: GROK_MODEL,
  voice: GROK_VOICE,
  instructions: SYSTEM_INSTRUCTIONS,
  greeting: GREETING,
  port: Number(PORT),
  logEvents: LOG_EVENTS === "true",
};

export function assertServerConfig() {
  if (!config.xaiApiKey) {
    console.error("Missing XAI_API_KEY. Copy .env.example to .env and set your xAI API key (console.x.ai).");
    process.exit(1);
  }
}

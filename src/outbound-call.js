// Place an outbound call from your Twilio number to any phone; when answered,
// the callee is connected to the same Grok voice bot as inbound calls.
//
//   npm run call -- +15551234567
import dotenv from "dotenv";

dotenv.config();

const {
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_PHONE_NUMBER,
  PUBLIC_HOST,
} = process.env;

const to = process.argv[2];

if (!to || !to.startsWith("+")) {
  console.error("Usage: npm run call -- +15551234567   (E.164 format)");
  process.exit(1);
}
for (const [name, value] of Object.entries({ TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, PUBLIC_HOST })) {
  if (!value) {
    console.error(`Missing ${name} in .env`);
    process.exit(1);
  }
}

const host = PUBLIC_HOST.replace(/^https?:\/\//, "").replace(/\/$/, "");
const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="wss://${host}/media-stream" /></Connect></Response>`;

const res = await fetch(
  `https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/Calls.json`,
  {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: TWILIO_PHONE_NUMBER, Twiml: twiml }),
  },
);

const body = await res.json();
if (!res.ok) {
  console.error(`Twilio API error (${res.status}):`, body.message ?? JSON.stringify(body));
  process.exit(1);
}
console.log(`Calling ${to} from ${TWILIO_PHONE_NUMBER} — call SID: ${body.sid}`);

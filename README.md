# VoiceCode

Chinese version: [README.zh-CN.md](README.zh-CN.md)

VoiceCode — share a terminal between desktop and mobile. Desktop shows output and allows keyboard editing; mobile provides voice input, quick actions, and direct command execution. Both connect to the same PTY session in real time.

---

## Installation (top)

Prerequisite: Node.js installed.

Recommended — run instantly with npx:

```bash
npx voicecode
```

Install globally to get the `voicecode` CLI:

```bash
npm install -g voicecode
voicecode
```

From source (development):

```bash
npm install
npm start
```

The server runs by default at `https://localhost:3000` (HTTPS with a self-signed certificate). Your browser will warn about the certificate the first time — allow/continue to proceed.

---

## Quick Start (3 steps)

1) Start the server:

```bash
voicecode
# or: npm start
```

2) Open the desktop terminal page:

- Visit `https://localhost:3000` (or the network address shown in the server log).

3) Join from your phone via QR code:

- Click the QR button on the page to generate a code. Scan it with your phone to open the same session URL (like `https://<ip>:3000/<sessionId>`). Your phone becomes a voice/quick-action remote.

Tip: Your phone and computer should be on the same LAN, and you must use HTTPS for microphone permissions in the browser.

---

## Voice Features

Voice recognition runs locally in the browser using the SenseVoiceSmall (ONNX) model. The app prefers running inference inside a Web Worker to keep the UI responsive; the first run downloads the model (cached by the browser afterwards).

Key modes:

- Push-to-talk (PTT): press and hold the mic button on mobile (or AltRight / middle mouse on desktop) to record; release to transcribe.
- Direct command execution: utterances starting with `/` are sent immediately to the backend PTY with an automatic Enter. The system also supports intelligent matching and alias-triggered commands (say “help” or a custom alias and it runs `/help`).
- Dictation mode: non-command transcriptions are appended to the current terminal input without auto-Enter so you can edit before running.

Model & troubleshooting:

- The page will try to warm the model proactively to avoid long first-press latency.
- Settings include a “clear voice model cache” control (refresh required after clearing).
- If the browser reports no microphone or permission denied, ensure you’re on HTTPS and that microphone access is granted.

---

## QR Code (user-friendly)

Tap the QR button on the page to generate a scannable image. Scanning opens the same session URL in your phone browser so you can join quickly.

If your phone and computer are on the same LAN the QR will prefer a LAN address; if you enabled the tunnel/public access option, the QR will encode the public URL instead for remote scanning.

You can also create a new session with the “New Session” button and get its QR code.

---

## Other Core Features

- Multi-device, real-time sync to the same PTY session.
- Quick Actions drawer: send common commands with one tap; supports edit, rename, and aliases for voice triggers.
- Optional automatic AI CLI startup (e.g., `gemini` or `claude`).

---

## Advanced / Optional

1) Tunnel / Public Access

If you don’t want to deal with self-signed certs or your devices aren’t on the same LAN, use the built-in ngrok tunnel:

Windows (example):

```powershell
setx NGROK_AUTHTOKEN "<your-token>"
voicecode --tunnel
```

Or from source:

```bash
npm run start:tunnel
```

When enabled, QR codes will use the public HTTPS address.

2) Auto-start AI CLI

```bash
voicecode --gemini
voicecode --claude
# or from source: node server.js --gemini
```

---

## Troubleshooting

Q: I can open the page on my phone but the voice button is disabled.

A: Most browsers require HTTPS and a user gesture for microphone access. Ensure you opened the page at `https://...` and granted microphone permission.

Q: First voice use is slow.

A: The model must be downloaded on first use; subsequent runs use the cached model. You can clear the model cache in Settings and reload the page to force a fresh download.

Q: Terminal fails to start on Windows / permissions issues?

A: Run the repair script:

```bash
node scripts/fix-node-pty-perms.js
```

---

## License

ISC

# MAGI SYSTEM on Strands Decider 2B

[English](README.en.md) | [日本語](README.ja.md)

A web app that recreates the **MAGI system** from *Neon Genesis Evangelion*
using **Strands Decider 2B**, the small, open-source "decision model" from the AWS Strands team.
Three sages (MELCHIOR / BALTHASAR / CASPER) each judge the same question
independently, and a majority vote over calibrated probabilities decides the verdict.

> This is a fork of [magi-system-on-jev](https://github.com/hide-G/magi-system-on-jev)
> (Jev / TypeSafe AI) with the decision model swapped for **Strands Decider 2B** (AWS, open source).

- **Mobile friendly** (responsive)
- **Japanese / English UI toggle** (🌐 button, saved in localStorage; switches sage
  personas, verdict labels, and even the speech-recognition language)
- **Voice input** (browser Web Speech API) **and text input**
- **Log button** visualizes the exchange with Strands Decider (request JSON, response JSON, latency)
- **Evangelion-style UI**: MAGI triangular layout, hexagonal panels, CRT scanlines,
  a TOP SECRET banner, and a verdict glow
- **Share to X** with the question, verdict, each sage's noul, and the site URL

---

## What is Strands Decider 2B

Strands Decider 2B is an open-source **decision model** released by the AWS Strands team.
Unlike a normal LLM, it does not generate text; it returns **probabilities (0–1)** over the
options you define (yes/no, or a set of choices).

- Built on a Qwen3.5-2B torso with the text head replaced by a small "pointer head" that scores options
- **2 billion parameters**, small enough to run on a local CPU/GPU with low (millisecond) latency
- Code, model weights, training data, and training scripts are all published (GitHub / Hugging Face)

In this app, each MAGI sage is a **noul (yes/no probability)** question. The three questions are sent
to Strands Decider, and the returned noul values are mapped to approve / reject / hold by threshold,
then combined by majority vote.

> Source content was rephrased for compliance with licensing restrictions.

---

## Project structure

```
magi-decider/
├─ public/                  # static front-end (deploy to S3 + CloudFront, etc.)
│  ├─ index.html            # MAGI UI + OGP meta
│  ├─ styles.css            # Evangelion-style, responsive
│  ├─ app.js                # input -> Decider -> verdict -> render -> log -> share
│  ├─ decider-client.js     # Strands Decider client (mock / live via backend) + deliberation
│  ├─ magi-config.js        # sages, thresholds, endpoint, i18n dictionary
│  ├─ ogp.png / ogp.svg     # OGP card image (1200x630)
├─ backend/                 # server that runs local strands-decider and returns noul
│  ├─ server.mjs            # Node.js standard http server (no extra deps)
│  ├─ package.json
│  └─ requirements.txt      # strands-decider (Python)
└─ README*.md
```

---

## Run locally

### 1. Front-end (try the mock)

With `mode: "mock"` (the default in `magi-config.js`) you can run it without any model.
Just serve `public/` statically.

```bash
cd public
python -m http.server 8080   # or: npx serve -l 8080
```

Open <http://localhost:8080>.

> Voice input (Web Speech API) is allowed on `http://localhost`, but not over plain HTTP in production.

### 2. Run with the real model (Strands Decider 2B)

To use the real model, start the backend and switch the front-end to `live`.

```bash
# (1) Install Strands Decider 2B (first time only; weights download on first run)
cd backend
pip install -r requirements.txt   # strands-decider

# (2) Start the backend (Node.js). It spawns strands-decider as a child process.
node server.mjs                    # default: http://localhost:8787
```

Then edit `public/magi-config.js`:

```js
mode: "live",                       // from "mock" to "live"
decider: {
  endpoint: "http://localhost:8787/deliberate",
  model: "StrandsAgents/strands-decider-2B-hobson-v19",
},
```

Reload the front-end and deliberate; each sage's noul now comes from the real model.

> To check connectivity without strands-decider installed, run
> `ALLOW_MOCK_FALLBACK=1 node server.mjs` to return pseudo noul values (demo only).

---

## How it works

1. Enter a question (e.g. "Does pineapple belong on pizza?"). 🎤 voice input works too (Chrome recommended).
2. Press **Deliberate** (Ctrl+Enter also works).
3. Each sage returns a **noul** (probability 0–1) shown as approve / reject / hold, then the overall verdict appears.
4. Press **Log** to see the request/response JSON and latency of the Strands Decider call.

### Deliberation rules (`magi-config.js` thresholds)
| noul | Sage vote |
|---|---|
| ≥ 0.60 | approve |
| ≤ 0.40 | reject |
| in between | hold |

- 2+ approve → **APPROVAL**, 2+ reject → **REJECTION**, otherwise → **DELIBERATION** (human judgment required).

---

## What the backend does (`backend/server.mjs`)

1. Receives `{state, questions}` from the front-end.
2. Normalizes question `criteria` to the `{true,false}` shape (absorbs a `yes/no` front-end).
3. For each sage's question, spawns the local `strands-decider` CLI and reads a noul.
4. Returns a Jev-compatible response (`answers` with noul).
5. Logs a one-line deliberation summary (question, each noul, verdict) to stdout.

### Differences from the Jev version

| Aspect | Jev version (original) | Strands Decider 2B version (this repo) |
| --- | --- | --- |
| Model | TypeSafe AI's Jev (hosted API) | AWS Strands Decider 2B (open source, local) |
| Connection | HTTP to `api.typesafe.ai` | runs `strands-decider` locally |
| API key | required (stored in Secrets Manager) | **not needed** (no key, no outbound call) |
| Backend | Lambda (key relay) | Node.js http server (model execution) |

Since no API key or Secrets Manager is involved, all key-management notes from the Jev version were removed.

### Environment variables (`server.mjs`)
| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | listen port |
| `DECIDER_MODEL` | `StrandsAgents/strands-decider-2B-hobson-v19` | model ID (Hugging Face) |
| `DECIDER_CMD` | `strands-decider` | CLI command |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin (limit to your domain in production) |
| `APPROVE_AT` / `REJECT_AT` | `0.6` / `0.4` | deliberation thresholds (match the front-end defaults) |
| `ALLOW_MOCK_FALLBACK` | (unset) | `1` returns pseudo noul if the CLI fails (demo only) |

---

## Data shape

**Request** `POST /deliberate`
```json
{
  "state": { "matter": "...", "inquiredAt": "..." },
  "questions": {
    "melchior":  { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } },
    "balthasar": { "type": "noul", "instructions": "..." },
    "casper":    { "type": "noul", "instructions": "..." }
  }
}
```

**Response**
```json
{
  "request": { "model": "StrandsAgents/strands-decider-2B-hobson-v19", "state": { }, "questions": { } },
  "response": {
    "model": "StrandsAgents/strands-decider-2B-hobson-v19",
    "answers": {
      "melchior":  { "type": "noul", "noul": 0.72 },
      "balthasar": { "type": "noul", "noul": 0.31 },
      "casper":    { "type": "noul", "noul": 0.66 }
    },
    "usage": { "input_tokens": 120, "output_tokens": 0 }
  },
  "latencyMs": 118,
  "endpoint": "http://localhost:8787/deliberate"
}
```

> Strands Decider does not generate text; it returns typed judgments (noul = probability of yes).
> "Type-valid" does not mean "semantically correct", so the hold band is designed to escalate to a human.

---

## Credits & notes

- Strands Decider 2B is an open-source decision model by the [AWS Strands team](https://strandsagents.com/blog/introducing-strands-decider/).
- The original Jev / System One model is by [TypeSafe AI](https://typesafe.ai/).
- MAGI and Evangelion are referenced as an homage; this is a fan project, not affiliated.
- This repository contains no secrets (it uses no API keys).

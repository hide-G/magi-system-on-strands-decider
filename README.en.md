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
├─ backend/                 # thin server that relays to `strands-decider serve`
│  ├─ server.mjs            # Node.js standard http server (no extra deps)
│  ├─ package.json
│  └─ requirements.txt      # strands-decider (Python), installed on the inference machine
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

To use the real model, the setup is two-tier:

```
[browser public/] --POST /deliberate--> [server.mjs (relay)] --POST /v1/systemone--> [strands-decider serve]
```

**server.mjs does not run the model itself.** It is a thin relay that batches the three sages'
questions into **a single request** to the `/v1/systemone` endpoint exposed by `strands-decider serve`.
The heavy model inference runs on the serve side (a GPU box or the cloud), so even a modest machine
can run server.mjs alone.

```bash
# (A) On the inference machine (GPU box or cloud), start the Strands Decider server.
#     Only this machine needs strands-decider installed.
pip install "strands-decider[cpu]"   # or [cuda] (Linux + NVIDIA GPU)
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8000

# (B) Start the Node.js relay backend. Point it at the serve location via DECIDER_URL.
cd backend
DECIDER_URL=http://localhost:8000 node server.mjs    # default: http://localhost:8787
#   If serve runs in the cloud:
#   DECIDER_URL=https://<your-endpoint> node server.mjs
```

> `strands-decider serve` binds to `127.0.0.1` with no authentication by default. To expose it
> on another machine or in the cloud, put a front layer (reverse proxy / App Runner / ALB, etc.)
> in front of it to bind a public address and add HTTPS and auth (supported via `DECIDER_TOKEN`).

Then edit `public/magi-config.js`:

```js
mode: "live",                       // from "mock" to "live"
decider: {
  endpoint: "http://localhost:8787/deliberate",
  model: "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610",
},
```

Reload the front-end and deliberate; each sage's noul now comes from the real model.

> To check front-end-to-relay connectivity before you have a serve upstream, run
> `ALLOW_MOCK_FALLBACK=1 node server.mjs` to return pseudo noul values when the upstream
> is down (demo only).

### 3. Live integration test procedure

The public endpoint (`DECIDER_URL`) and auth token (`DECIDER_TOKEN`) are **provided separately**.
Replace every `<...>` below with your own value. **Both the URL and the token are placeholders and
are never committed to the repository** (the design is key-free).

```bash
# (A) Start the upstream on the inference machine (if not already running).
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8000

# (B) Start the relay backend, passing the separately-provided endpoint and token as env vars.
#     The values are placeholders. Avoid leaving the real URL/token in shell history or config.
cd backend
DECIDER_URL=https://<your-decider-endpoint> \
DECIDER_TOKEN=<your-token> \
node server.mjs
```

Next, set `mode: "live"` in `public/magi-config.js`, reload the front-end, and deliberate a question.
Confirm each sage's **noul comes from the real model** (not the mock fallback) by inspecting the log
panel's response JSON. The authoritative signal is `response.model`: when the upstream was reached it
is the plain model id `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610`, whereas on the mock-fallback
path the relay appends a ` (mock-fallback)` suffix (e.g. `...-qwen3.5-v1-2610 (mock-fallback)`). So a
`response.model` *without* the `(mock-fallback)` suffix means the real upstream answered. (The latency
and a non-zero `usage.input_tokens` are only secondary hints. Note that `input_tokens` is non-zero on
the mock-fallback path too, so it cannot by itself distinguish live from mock.)

> When `DECIDER_TOKEN` is set, the relay adds `Authorization: Bearer <your-token>` to the upstream
> call. Pass the token only as a server-side environment variable; never place it in the front-end
> or in Git.

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
3. Batches all three sages' questions into **a single request** and relays it to the upstream
   `strands-decider serve` at `POST /v1/systemone`, reading each sage's noul.
4. Returns a Jev-compatible response (`answers` with noul).
5. Logs a one-line deliberation summary (question, each noul, verdict) to stdout.

> Why batch into one request: Strands Decider encodes the state (the matter) once and advances
> only the questions over a shared prefix cache, so sending all questions at once is the fastest
> and lightest path (the old implementation that launched a CLI per question reloaded the model
> every time and was impractical).

### Differences from the Jev version

| Aspect | Jev version (original) | Strands Decider 2B version (this repo) |
| --- | --- | --- |
| Model | TypeSafe AI's Jev (hosted API) | AWS Strands Decider 2B (open source) |
| Connection | HTTP to `api.typesafe.ai` | HTTP to `strands-decider serve` `/v1/systemone` |
| API key | required (stored in Secrets Manager) | **not needed** (optional `DECIDER_TOKEN`) |
| Backend | Lambda (key relay) | Node.js http server (relays to systemone) |

Since no API key or Secrets Manager is involved, all key-management notes from the Jev version were removed.

### Environment variables (`server.mjs`)
| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8787` | listen port for this relay server |
| `DECIDER_URL` | `http://localhost:8000` | base URL of the upstream `strands-decider serve` |
| `DECIDER_PATH` | `/v1/systemone` | path of the systemone endpoint |
| `DECIDER_MODEL` | `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610` | model ID (for logs/display) |
| `DECIDER_TOKEN` | (unset) | Bearer token for the upstream when it is behind auth |
| `DECIDER_TIMEOUT` | `60000` | request timeout to the upstream (ms) |
| `ALLOWED_ORIGIN` | `*` | CORS allowed origin (limit to your distribution origin in production) |
| `APPROVE_AT` / `REJECT_AT` | `0.6` / `0.4` | deliberation thresholds (match the front-end defaults) |
| `ALLOW_MOCK_FALLBACK` | (unset) | `1` returns pseudo noul if the upstream fails (demo only) |

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
  "request": { "model": "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610", "state": { }, "questions": { } },
  "response": {
    "model": "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610",
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

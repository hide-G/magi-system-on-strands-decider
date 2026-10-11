// ============================================================
// MAGI System on Strands Decider 2B - バックエンド (Node.js 20+, ESM)
// ------------------------------------------------------------
// 役割:
//   1. フロントから議題(state)と賢者の質問(questions)を受け取る
//   2. それを Strands Decider の公式サーバー( `strands-decider serve` )が
//      公開する `POST /v1/systemone` へ "1リクエストにまとめて" 中継する
//   3. 返ってきた各賢者の noul(0〜1 確率)を answers に整形して返す
//   4. 審議サマリを標準出力にログとして残す
//
// なぜ「1リクエストにまとめる」のか:
//   Strands Decider は state(議題)を一度だけエンコードし、質問(suffix)だけを
//   質問ごとに前進させる「共有プレフィックスキャッシュ」を持つため、
//   3賢者ぶんの質問を 1 回の /v1/systemone で送るのが最も速く・軽い。
//   (質問ごとに CLI を起動していた旧実装は、毎回モデル(約4.5GB)を
//    ロードし直すため非常に遅く、実用に向かなかった)
//
// どこへ繋ぐか( DECIDER_URL ):
//   - ローカル(別マシンや同一PC)で `strands-decider serve --port 8000` を起動した場合:
//       DECIDER_URL=http://localhost:8000
//   - クラウド(App Runner / ECS 等)に serve を常駐させた場合:
//       DECIDER_URL=https://<your-endpoint>
//   いずれの場合も、このファイルは「薄い中継役」なので、PCが非力でも動く。
//   (重いモデル推論は DECIDER_URL 側が担当する)
//
// このサーバーは Node.js 標準モジュールのみで動作し、追加依存はありません。
// ============================================================

import http from "node:http";

// ---- 環境変数 ----
// PORT            : このサーバーの待受ポート(既定 8787)
// DECIDER_URL     : strands-decider serve のベースURL(既定 http://localhost:8000)
// DECIDER_PATH    : systemone エンドポイントのパス(既定 /v1/systemone)
// DECIDER_MODEL   : ログ/表示用のモデルID(既定 StrandsAgents/strands-decider-2B-qwen3.5-v1-2610)
// DECIDER_TOKEN   : serve 側に認証を付けた場合の Bearer トークン(任意)
// DECIDER_TIMEOUT : 上流への待受タイムアウト ms(既定 60000)
// ALLOWED_ORIGIN  : CORS で許可するオリジン(既定 "*"。本番は配信元に限定推奨)
// APPROVE_AT/REJECT_AT : 合議の閾値(フロントの既定と合わせる)
// ALLOW_MOCK_FALLBACK  : "1" のとき、上流が未起動/失敗でも擬似 noul を返す(デモ用)
const PORT = Number(process.env.PORT || 8787);
const DECIDER_URL = (process.env.DECIDER_URL || "http://localhost:8000").replace(/\/$/, "");
const DECIDER_PATH = process.env.DECIDER_PATH || "/v1/systemone";
const DECIDER_MODEL =
  process.env.DECIDER_MODEL || "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610";
const DECIDER_TOKEN = process.env.DECIDER_TOKEN || "";
const DECIDER_TIMEOUT = Number(process.env.DECIDER_TIMEOUT || 60000);
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || "*";
const APPROVE_AT = Number(process.env.APPROVE_AT || 0.6);
const REJECT_AT = Number(process.env.REJECT_AT || 0.4);
const ALLOW_MOCK_FALLBACK = process.env.ALLOW_MOCK_FALLBACK === "1";

// 上流 /v1/systemone の完全なURL
const SYSTEMONE_ENDPOINT = DECIDER_URL + DECIDER_PATH;

// ------------------------------------------------------------
// questions を /v1/systemone 用に正規化する。
//   - noul の criteria は {true,false} が正しい(yes/no で来ても吸収する)
//   - instructions / type はそのまま通す
// ------------------------------------------------------------
function normalizeQuestions(questions) {
  const out = {};
  for (const [id, q] of Object.entries(questions || {})) {
    const nq = { type: q.type, instructions: q.instructions };
    if (q.criteria) {
      if (q.type === "noul") {
        const t = q.criteria.true ?? q.criteria.yes;
        const f = q.criteria.false ?? q.criteria.no;
        const crit = {};
        if (t != null) crit.true = t;
        if (f != null) crit.false = f;
        if (Object.keys(crit).length > 0) nq.criteria = crit;
      } else {
        nq.criteria = q.criteria;
      }
    }
    out[id] = nq;
  }
  return out;
}

// ------------------------------------------------------------
// 上流 /v1/systemone の answers から noul(true確率)を頑健に取り出す。
//   期待する形: answers[id] = { type:"noul", noul: 0.83 }
//   実装差を吸収するため、noul 以外のキーもいくつか見る。
// ------------------------------------------------------------
function extractNoul(answer) {
  if (answer == null) return null;
  const cand =
    answer.noul ??
    answer.p_true ??
    answer.true ??
    answer?.probabilities?.true ??
    (typeof answer === "number" ? answer : undefined);
  return typeof cand === "number" ? clamp01(cand) : null;
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

// state を /v1/systemone の "state" に渡す形へ整える。
// サーバーは文字列でもオブジェクトでも受け付けるが、
// 議題本文を素直に渡すため、文字列化できるものは文字列にする。
function stateForUpstream(state) {
  if (typeof state === "string") return state;
  if (state && typeof state === "object") {
    return state.matter || state["議題"] || JSON.stringify(state);
  }
  return String(state ?? "");
}

// ------------------------------------------------------------
// 上流 `strands-decider serve` の /v1/systemone を 1 回だけ呼ぶ。
// 3賢者ぶんの質問をまとめて送るので、呼び出しは審議あたり 1 回で済む。
// ------------------------------------------------------------
async function callSystemOne(state, questions) {
  const body = {
    model: DECIDER_MODEL,
    state: stateForUpstream(state),
    questions, // 既に正規化済み(noul: {true,false})
  };

  const headers = { "Content-Type": "application/json" };
  if (DECIDER_TOKEN) headers["Authorization"] = "Bearer " + DECIDER_TOKEN;

  // タイムアウト付き fetch(Node 18+ の AbortController)
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), DECIDER_TIMEOUT);
  let res;
  try {
    res = await fetch(SYSTEMONE_ENDPOINT, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: ac.signal,
    });
  } catch (err) {
    throw new Error(
      `Strands Decider サーバーへ接続できません(${SYSTEMONE_ENDPOINT}): ${err.message}`
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`/v1/systemone がHTTP ${res.status} を返しました: ${text.slice(0, 500)}`);
  }

  const data = await res.json();
  return data;
}

// ------------------------------------------------------------
// 全賢者ぶんの noul をまとめて取得し、フロント期待形のレスポンスを作る。
//   成功時: 上流の answers から各賢者の noul を取り出して整形
//   失敗時: ALLOW_MOCK_FALLBACK=1 なら擬似 noul で代替(デモ用)
// ------------------------------------------------------------
async function evaluateAll(state, questions) {
  const stateText = stateForUpstream(state);
  const inputTokens = Math.max(20, Math.round(stateText.length / 2));

  try {
    const upstream = await callSystemOne(state, questions);
    const upAnswers = upstream?.answers || {};
    const answers = {};
    for (const id of Object.keys(questions)) {
      const noul = extractNoul(upAnswers[id]);
      if (noul == null) {
        throw new Error(`賢者 "${id}" の noul を上流レスポンスから取得できませんでした`);
      }
      answers[id] = { type: "noul", noul };
    }
    return {
      model: upstream?.model || DECIDER_MODEL,
      answers,
      usage: upstream?.usage || { input_tokens: inputTokens, output_tokens: 0 },
      upstreamLatencyMs: upstream?.latency_ms,
    };
  } catch (err) {
    if (!ALLOW_MOCK_FALLBACK) throw err;
    console.error(`[warn] ${err.message} -> モックフォールバックを使用`);
    const answers = {};
    for (const id of Object.keys(questions)) {
      answers[id] = { type: "noul", noul: mockNoul(stateText, id) };
    }
    return {
      model: DECIDER_MODEL + " (mock-fallback)",
      answers,
      usage: { input_tokens: inputTokens, output_tokens: 0 },
    };
  }
}

// strands-decider が無い環境向けの擬似 noul(デモ用フォールバック)。
// 議題と賢者IDから決定論的に 0.3〜0.7 を返す。
function mockNoul(stateText, id) {
  let h = 2166136261;
  const s = stateText + "::" + id;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Number((0.3 + ((h >>> 0) % 1000) / 1000 * 0.4).toFixed(2));
}

// ------------------------------------------------------------
// 審議サマリ(ログ用)。noul と判定のみ。秘密情報は扱わない。
// ------------------------------------------------------------
function buildDeliberationSummary(state, response, latencyMs) {
  const agenda = stateForUpstream(state);
  const answers = response?.answers || {};
  const sages = {};
  const tally = { approve: 0, reject: 0, hold: 0 };
  for (const [id, ans] of Object.entries(answers)) {
    const noul = typeof ans?.noul === "number" ? ans.noul : null;
    let vote = "hold";
    if (noul != null) {
      if (noul >= APPROVE_AT) vote = "approve";
      else if (noul <= REJECT_AT) vote = "reject";
    }
    tally[vote]++;
    sages[id] = { noul, vote };
  }
  let verdict = "deliberation";
  if (tally.approve >= 2) verdict = "approval";
  else if (tally.reject >= 2) verdict = "rejection";

  return {
    tag: "MAGI_DELIBERATION",
    agenda,
    sages,
    tally,
    verdict,
    latencyMs,
    model: response?.model,
    usage: response?.usage,
  };
}

// ------------------------------------------------------------
// CORS ヘッダー
// ------------------------------------------------------------
function corsHeaders() {
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

// リクエストボディを読み切る
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => {
      data += c;
      if (data.length > 1_000_000) {
        reject(new Error("リクエストが大きすぎます"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ============================================================
// HTTP サーバー
// ============================================================
const server = http.createServer(async (req, res) => {
  // CORS プリフライト
  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    res.end();
    return;
  }

  // ヘルスチェック(このサーバー自身の生存確認)
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, corsHeaders());
    res.end(
      JSON.stringify({
        ok: true,
        model: DECIDER_MODEL,
        upstream: SYSTEMONE_ENDPOINT,
        mockFallback: ALLOW_MOCK_FALLBACK,
      })
    );
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405, corsHeaders());
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  try {
    const raw = await readBody(req);
    const payload = raw ? JSON.parse(raw) : {};
    const { state, questions } = payload;

    if (!state || !questions || Object.keys(questions).length === 0) {
      res.writeHead(400, corsHeaders());
      res.end(JSON.stringify({ error: "state と questions は必須です" }));
      return;
    }

    const normalized = normalizeQuestions(questions);
    const deciderRequest = {
      model: DECIDER_MODEL,
      state,
      questions: normalized,
    };

    const started = Date.now();
    const response = await evaluateAll(state, normalized);
    const latencyMs = Date.now() - started;

    // 審議サマリを1行ログ
    console.log(JSON.stringify(buildDeliberationSummary(state, response, latencyMs)));

    res.writeHead(200, corsHeaders());
    res.end(
      JSON.stringify({
        request: deciderRequest,
        response,
        latencyMs,
        endpoint: SYSTEMONE_ENDPOINT,
      })
    );
  } catch (err) {
    res.writeHead(502, corsHeaders());
    res.end(JSON.stringify({ error: String(err.message || err) }));
  }
});

server.listen(PORT, () => {
  console.log(
    `[MAGI on Strands Decider] listening on http://localhost:${PORT}`
  );
  console.log(
    `[MAGI on Strands Decider] 上流(/v1/systemone) = ${SYSTEMONE_ENDPOINT}  model=${DECIDER_MODEL}`
  );
  if (ALLOW_MOCK_FALLBACK) {
    console.log(
      "[MAGI on Strands Decider] ALLOW_MOCK_FALLBACK=1: 上流未起動/失敗時は擬似noulで応答します"
    );
  }
});

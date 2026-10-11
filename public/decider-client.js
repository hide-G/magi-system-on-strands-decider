// ============================================================
// Strands Decider クライアント（モック / 実モデル 切替）
// ------------------------------------------------------------
// Strands Decider 2B は Yes/No を 0〜1 の確率（noul）で返す意思決定
// モデルです。ここでは MAGI の各賢者を「noul 質問」として扱い、
// バックエンド経由で strands-decider を呼び出します。
//
//   POST {endpoint}/deliberate
//   body: { state, questions: { id: {type:"noul", instructions, criteria:{true,false}} } }
//   res : { request, response:{ model, answers:{ id:{type:"noul", noul} }, usage }, latencyMs, endpoint }
//
// mode="live" に切り替えると、バックエンド（ローカルの strands-decider を
// 実行するサーバー）に接続します。APIキーは不要です。
// ============================================================

// criteria(true/falseの意味説明)の多言語文言
// Strands Decider の noul は true/false の二択に確率を割り当てる。
const DECIDER_CRITERIA = {
  ja: {
    true: "この議題を承認・可決すべき",
    false: "この議題を承認・可決すべきでない",
  },
  en: {
    true: "This matter should be approved",
    false: "This matter should not be approved",
  },
};

// 言語別プロパティ（{ja,en} または文字列）を取り出す
function pickLang(value, lang) {
  if (value && typeof value === "object") return value[lang] || value.ja;
  return value;
}

/**
 * 3賢者ぶんの questions（Strands Decider リクエスト形式）を組み立てる。
 * MAGIの各人格はYes/No判断なので、すべて noul タイプを使う。
 * @param {Array} sages MAGI_CONFIG.sages
 * @param {string} lang 表示言語 ("ja" | "en")
 * @returns {Object} questions マップ
 */
function buildQuestions(sages, lang) {
  const criteria = DECIDER_CRITERIA[lang] || DECIDER_CRITERIA.ja;
  const questions = {};
  for (const sage of sages) {
    questions[sage.id] = {
      type: "noul",
      instructions: pickLang(sage.instructions, lang),
      criteria: { true: criteria.true, false: criteria.false },
    };
  }
  return questions;
}

/**
 * Strands Decider へ送るリクエストbody全体を組み立てる。
 * @param {string|Object} state 議題（stateオブジェクト）
 * @param {Object} config MAGI_CONFIG
 * @param {string} lang 表示言語 ("ja" | "en")
 */
function buildDeciderRequest(state, config, lang) {
  return {
    model: config.decider.model,
    state: state,
    questions: buildQuestions(config.sages, lang || config.defaultLang || "ja"),
  };
}

// ------------------------------------------------------------
// モックエンジン
// ------------------------------------------------------------
// 実際の Strands Decider 2B は学習済みモデルが noul 確率を返すが、
// ここでは議題テキストから疑似的に各賢者のnoul確率を生成する。
// 人格ごとにキーワードの重みを変えることで「観点の違い」を表現し、
// MAGIらしい割れた判定を出す。
// ------------------------------------------------------------

// 人格ごとのキーワード重み（賛成方向 + / 反対方向 -）
const MOCK_PERSONA_BIAS = {
  // 科学者: 効率・データ・技術に前向き、感情論に慎重
  melchior: {
    positive: ["効率", "技術", "データ", "検証", "論理", "最適", "実験", "分析", "合理"],
    negative: ["感情", "曖昧", "未検証", "リスク不明", "根拠なし"],
    base: 0.55,
  },
  // 母: 安全・保護に敏感、危険・強行に反対
  balthasar: {
    positive: ["安全", "保護", "健康", "支援", "守る", "配慮", "長期", "教育", "ケア"],
    negative: ["危険", "強行", "リスク", "緊急", "深夜", "身元不明", "無理", "犠牲"],
    base: 0.5,
  },
  // 女(現実派): 実利・現実解に前向き、理想論・非現実に冷淡
  casper: {
    positive: ["現実", "利益", "実用", "コスト", "早い", "便利", "妥当", "人気", "実績"],
    negative: ["理想", "非現実", "無駄", "高コスト", "面倒", "先送り"],
    base: 0.52,
  },
};

// 文字列から決定論的な擬似乱数（同じ議題なら同じ結果になるように）
function seededNoise(text, salt) {
  let h = 2166136261;
  const s = text + "::" + salt;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // 0〜1 に正規化して ±0.12 のノイズにする
  const n = ((h >>> 0) % 1000) / 1000; // 0〜1
  return (n - 0.5) * 0.24;
}

function clamp01(v) {
  return Math.max(0.02, Math.min(0.98, v));
}

/**
 * 議題テキストから1賢者のnoul確率を擬似生成する。
 */
function mockNoulForSage(sageId, agendaText) {
  const bias = MOCK_PERSONA_BIAS[sageId];
  if (!bias) return 0.5;
  let score = bias.base;
  const text = agendaText || "";
  for (const kw of bias.positive) {
    if (text.includes(kw)) score += 0.12;
  }
  for (const kw of bias.negative) {
    if (text.includes(kw)) score -= 0.14;
  }
  // 議題ごとの決定論的ノイズを加える（人格ごとにsaltを変える）
  score += seededNoise(text, sageId);
  return Number(clamp01(score).toFixed(2));
}

/**
 * モックの Strands Decider レスポンスを生成する（実モデルと同じ形式）。
 */
function mockDeciderEvaluate(request) {
  const answers = {};
  const agendaText =
    typeof request.state === "string"
      ? request.state
      : JSON.stringify(request.state);

  for (const id of Object.keys(request.questions)) {
    answers[id] = {
      type: "noul",
      noul: mockNoulForSage(id, agendaText),
    };
  }

  // トークン数もそれっぽく見積もる（表示用）。
  // Strands Decider は文章を生成しないので output_tokens は 0。
  const inputTokens = Math.max(20, Math.round(agendaText.length / 2));

  return {
    model: "strands-decider-2B-mock",
    answers: answers,
    usage: { input_tokens: inputTokens, output_tokens: 0 },
  };
}

/**
 * Strands Decider を呼び出す（mock / live を自動切替）。通信の生データも返す。
 * @param {string|Object} state 議題
 * @param {Object} config MAGI_CONFIG
 * @param {string} [lang] 表示言語 ("ja" | "en")。instructions/criteriaの言語に反映
 * @returns {Promise<{request:Object, response:Object, latencyMs:number, mode:string, endpoint:string}>}
 */
async function callDecider(state, config, lang) {
  const request = buildDeciderRequest(state, config, lang);
  const started = performance.now();

  if (config.mode === "live") {
    // ---- バックエンド経由で Strands Decider を呼ぶ ----
    // state と questions だけ送り、バックエンドが
    // ローカルの strands-decider を実行して noul を返す。
    // Strands Decider はオープンソースのローカルモデルなので APIキーは不要。
    const res = await fetch(config.decider.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        state: request.state,
        questions: request.questions,
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error("バックエンドエラー " + res.status + ": " + errText);
    }
    // バックエンドの返り値: {request, response, latencyMs, endpoint}
    const data = await res.json();
    if (data.error) {
      throw new Error(data.error);
    }
    return {
      // ログには バックエンドが実際にモデルへ渡した request（criteria正規化後）を使う
      request: data.request || request,
      response: data.response,
      latencyMs:
        typeof data.latencyMs === "number"
          ? data.latencyMs
          : Math.round(performance.now() - started),
      mode: "live",
      endpoint: data.endpoint || config.decider.endpoint,
    };
  }

  // ---- モック呼び出し ----
  // Strands Decider 2B のローカル推論レイテンシ（おおよそ 100〜160ms）を再現して待つ。
  const fakeLatency = 100 + Math.floor(Math.random() * 80);
  await new Promise((r) => setTimeout(r, fakeLatency));
  const response = mockDeciderEvaluate(request);
  const latencyMs = Math.round(performance.now() - started);
  return {
    request,
    response,
    latencyMs,
    mode: "mock",
    endpoint: "(local mock engine)",
  };
}

/**
 * Strands Decider のnoul回答群を、MAGIの合議結果に変換する。
 * @returns {{sages:Array, verdict:string, verdictLabel:string, tally:Object}}
 */
function deliberate(response, config) {
  const { approveAt, rejectAt } = config.thresholds;
  const sages = config.sages.map((sage) => {
    const noul = response.answers[sage.id]?.noul ?? 0.5;
    let vote, voteLabel;
    if (noul >= approveAt) {
      vote = "approve";
      voteLabel = "賛成";
    } else if (noul <= rejectAt) {
      vote = "reject";
      voteLabel = "反対";
    } else {
      vote = "hold";
      voteLabel = "保留";
    }
    return { ...sage, noul, vote, voteLabel };
  });

  const tally = { approve: 0, reject: 0, hold: 0 };
  for (const s of sages) tally[s.vote]++;

  let verdict, verdictLabel;
  if (tally.approve >= 2) {
    verdict = "approval";
    verdictLabel = "可決 / APPROVAL";
  } else if (tally.reject >= 2) {
    verdict = "rejection";
    verdictLabel = "否決 / REJECTION";
  } else {
    verdict = "deliberation";
    verdictLabel = "審議未了 / DELIBERATION";
  }

  return { sages, verdict, verdictLabel, tally };
}

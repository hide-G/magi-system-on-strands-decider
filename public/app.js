// ============================================================
// MAGI System on Strands Decider 2B - アプリ本体（オーケストレーション）
// ------------------------------------------------------------
// 入力(音声/文字) -> Strands Decider呼出(モック/実モデル) -> 合議判定 -> 描画
// -> 通信ログの記録・表示 までを担当する。
// 多言語(i18n: 日本語/英語)に対応。
// ============================================================

(function () {
  "use strict";

  const config = MAGI_CONFIG;
  const logHistory = []; // 通信ログの履歴
  let lastDecision = null; // 直近の判定（言語切替時の再描画用）

  // ---- 言語状態 ----
  const LANG_KEY = "magi.lang";
  let lang =
    localStorage.getItem(LANG_KEY) || config.defaultLang || "ja";

  // i18n参照ヘルパー。{key}形式のプレースホルダを置換できる。
  function t(key, vars) {
    const dict = MAGI_I18N[lang] || MAGI_I18N.ja;
    let s = dict[key] != null ? dict[key] : key;
    if (vars) {
      for (const k of Object.keys(vars)) {
        s = s.replace(new RegExp("\\{" + k + "\\}", "g"), vars[k]);
      }
    }
    return s;
  }

  // 賢者の言語別プロパティを取り出す
  function sageText(sage, field) {
    const v = sage[field];
    if (v && typeof v === "object") return v[lang] || v.ja;
    return v;
  }

  // ---- DOM参照 ----
  const els = {
    sages: document.getElementById("sages"),
    verdict: document.getElementById("verdict"),
    verdictLabel: document.getElementById("verdict-label"),
    verdictTally: document.getElementById("verdict-tally"),
    agendaInput: document.getElementById("agenda-input"),
    micBtn: document.getElementById("mic-btn"),
    submitBtn: document.getElementById("submit-btn"),
    logBtn: document.getElementById("log-btn"),
    micStatus: document.getElementById("mic-status"),
    logPanel: document.getElementById("log-panel"),
    logClose: document.getElementById("log-close"),
    logContent: document.getElementById("log-content"),
    modeBadge: document.getElementById("mode-badge"),
    footerInfo: document.getElementById("footer-info"),
    langBtn: document.getElementById("lang-btn"),
    langLabel: document.getElementById("lang-label"),
    shareBtn: document.getElementById("share-btn"),
  };

  let lastAgenda = ""; // 直近の議題（シェア文生成用）

  // ============================================================
  // i18n: data-i18n / data-i18n-attr 属性を一括適用
  // ============================================================
  function applyStaticI18n() {
    document.documentElement.lang = lang;
    // テキスト差し替え
    document.querySelectorAll("[data-i18n]").forEach(function (el) {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    // 属性差し替え（例: "placeholder:input.placeholder"）
    document.querySelectorAll("[data-i18n-attr]").forEach(function (el) {
      const spec = el.getAttribute("data-i18n-attr");
      const [attr, key] = spec.split(":");
      el.setAttribute(attr, t(key));
    });
  }

  // ============================================================
  // 初期描画: 3賢者パネルを生成
  // ============================================================
  function renderSagePanels() {
    els.sages.innerHTML = "";
    for (const sage of config.sages) {
      const div = document.createElement("div");
      div.className = "sage sage-" + sage.id;
      div.id = "sage-" + sage.id;
      div.style.setProperty("--corner", "var(--grid)");
      div.innerHTML =
        '<div class="sage-index">' + sage.codeName + "</div>" +
        '<div class="sage-name" style="color:' + sage.color + '">' + sage.name + "</div>" +
        '<div class="sage-persona" data-persona>' + sageText(sage, "persona") + "</div>" +
        '<div class="sage-noul" data-noul>--</div>' +
        '<div class="sage-status-label" data-status>' + t("sage.status") + "</div>" +
        '<div class="sage-vote vote-standby" data-vote>' + t("vote.standby") + "</div>" +
        '<div class="sage-bar"><div class="sage-bar-fill" data-bar style="background:' + sage.color + ';color:' + sage.color + '"></div></div>';
      els.sages.appendChild(div);
    }
  }

  // モードバッジ・フッター更新
  function renderMode() {
    const isLive = config.mode === "live";
    els.modeBadge.textContent = isLive ? t("mode.live") : t("mode.mock");
    els.modeBadge.classList.toggle("live", isLive);
    els.footerInfo.textContent = isLive ? t("footer.live") : t("footer.mock");
  }

  // ============================================================
  // 審議開始
  // ============================================================
  async function deliberateAgenda() {
    const agenda = els.agendaInput.value.trim();
    if (!agenda) {
      els.micStatus.textContent = t("input.needAgenda");
      return;
    }

    lastAgenda = agenda;
    setThinking(true);
    els.shareBtn.classList.add("hidden"); // 審議中はシェアボタンを隠す
    els.verdict.className = "verdict thinking";
    els.verdictLabel.textContent = t("verdict.deliberating");
    els.verdictTally.textContent = t("verdict.thinking");

    // Strands Deciderへ渡すstate（構造化しておくと実モデルでも扱いやすい）
    // キー名は表示言語に合わせる（英語UIのときは英語キー）
    const state =
      lang === "en"
        ? { matter: agenda, inquiredAt: new Date().toISOString() }
        : { 議題: agenda, 諮問日時: new Date().toISOString() };

    try {
      const result = await callDecider(state, config, lang);
      const decision = deliberate(result.response, config);
      lastDecision = decision;
      renderDecision(decision);
      recordLog(agenda, result, decision);
      els.shareBtn.classList.remove("hidden"); // 判定が出たらシェア可能に
    } catch (err) {
      els.verdict.className = "verdict rejection";
      els.verdictLabel.textContent = t("verdict.error");
      els.verdictTally.textContent = String(err.message || err);
      recordErrorLog(agenda, err);
      els.shareBtn.classList.add("hidden");
    } finally {
      setThinking(false);
    }
  }

  // 思考中アニメーション
  function setThinking(on) {
    els.submitBtn.disabled = on;
    for (const sage of config.sages) {
      const el = document.getElementById("sage-" + sage.id);
      if (!el) continue;
      el.className = on ? "sage sage-" + sage.id + " thinking" : "sage sage-" + sage.id;
      if (on) {
        el.querySelector("[data-noul]").textContent = "…";
        const voteEl = el.querySelector("[data-vote]");
        voteEl.textContent = "";
        voteEl.className = "sage-vote vote-standby";
      }
    }
  }

  // ============================================================
  // 判定結果を描画
  // ============================================================
  function renderDecision(decision) {
    for (const sage of decision.sages) {
      const el = document.getElementById("sage-" + sage.id);
      if (!el) continue;
      el.className = "sage sage-" + sage.id + " " + sage.vote;
      el.querySelector("[data-noul]").textContent = sage.noul.toFixed(2);
      const voteEl = el.querySelector("[data-vote]");
      voteEl.textContent = t("vote." + sage.vote);
      voteEl.className = "sage-vote vote-" + sage.vote;
      el.querySelector("[data-bar]").style.width =
        Math.round(sage.noul * 100) + "%";
    }
    renderVerdictText(decision);
  }

  // 判定の総合ラベル・集計を（現在の言語で）描画
  function renderVerdictText(decision) {
    els.verdict.className = "verdict " + decision.verdict;
    els.verdictLabel.textContent = t("verdict." + decision.verdict);
    els.verdictTally.textContent =
      t("tally.format", {
        approve: decision.tally.approve,
        reject: decision.tally.reject,
        hold: decision.tally.hold,
      }) + (decision.verdict === "deliberation" ? t("tally.needHuman") : "");
  }

  // ============================================================
  // 通信ログの記録と表示
  // ============================================================
  function recordLog(agenda, result, decision) {
    logHistory.unshift({
      time: new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ja-JP"),
      agenda: agenda,
      mode: result.mode,
      endpoint: result.endpoint,
      latencyMs: result.latencyMs,
      request: result.request,
      response: result.response,
      verdictKey: decision.verdict,
    });
    renderLog();
  }

  function recordErrorLog(agenda, err) {
    logHistory.unshift({
      time: new Date().toLocaleTimeString(lang === "en" ? "en-US" : "ja-JP"),
      agenda: agenda,
      mode: config.mode,
      endpoint: config.decider.endpoint,
      error: String(err.message || err),
    });
    renderLog();
  }

  function safeJson(obj) {
    const clone = JSON.parse(JSON.stringify(obj));
    return JSON.stringify(clone, null, 2);
  }

  function renderLog() {
    if (logHistory.length === 0) {
      els.logContent.innerHTML =
        '<p class="log-empty">' + t("log.empty") + "</p>";
      return;
    }
    els.logContent.innerHTML = logHistory
      .map(function (entry) {
        if (entry.error) {
          return (
            '<div class="log-entry">' +
            '<div class="log-entry-title">⚠ ' + entry.time + " " + t("log.error") + "</div>" +
            '<div class="log-meta">' + t("log.agenda") + escapeHtml(entry.agenda) + "</div>" +
            '<div class="log-block">' + escapeHtml(entry.error) + "</div>" +
            "</div>"
          );
        }
        return (
          '<div class="log-entry">' +
          '<div class="log-entry-title">🕒 ' + entry.time + " / " + t("verdict." + entry.verdictKey) + "</div>" +
          '<div class="log-meta">mode: ' + entry.mode +
          " | endpoint: " + escapeHtml(entry.endpoint) +
          " | latency: " + entry.latencyMs + "ms</div>" +
          '<div class="log-arrow">▶ ' + t("log.request") + "</div>" +
          '<div class="log-block">' + escapeHtml(safeJson(entry.request)) + "</div>" +
          '<div class="log-arrow">◀ ' + t("log.response") + "</div>" +
          '<div class="log-block">' + escapeHtml(safeJson(entry.response)) + "</div>" +
          "</div>"
        );
      })
      .join("");
  }

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // ============================================================
  // 言語切替
  // ============================================================
  function setLang(newLang) {
    lang = newLang;
    localStorage.setItem(LANG_KEY, lang);
    applyStaticI18n();
    renderMode();
    // 賢者パネルのペルソナ・状態ラベルを更新
    for (const sage of config.sages) {
      const el = document.getElementById("sage-" + sage.id);
      if (!el) continue;
      el.querySelector("[data-persona]").textContent = sageText(sage, "persona");
      el.querySelector("[data-status]").textContent = t("sage.status");
    }
    // 判定表示・ログを現在の言語で描き直す
    if (lastDecision) {
      renderDecision(lastDecision);
    } else {
      els.verdictLabel.textContent = t("verdict.standby");
      els.verdictTally.textContent = t("verdict.prompt");
    }
    renderLog();
    // 音声認識の言語も切替
    if (recognition) recognition.lang = lang === "en" ? "en-US" : "ja-JP";
  }

  function toggleLang() {
    setLang(lang === "ja" ? "en" : "ja");
  }

  // ============================================================
  // 音声入力（Web Speech API）
  // ============================================================
  let recognition = null;
  let recognizing = false;

  function micLabel() {
    return recognizing ? "⏺ " + t("btn.recording") : "🎤 " + t("btn.mic");
  }

  function setupSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) {
      els.micBtn.disabled = true;
      els.micStatus.textContent = t("mic.unsupported");
      return;
    }
    recognition = new SR();
    recognition.lang = lang === "en" ? "en-US" : "ja-JP";
    recognition.interimResults = true;
    recognition.continuous = false;

    recognition.onstart = function () {
      recognizing = true;
      els.micBtn.classList.add("recording");
      els.micBtn.innerHTML = micLabel();
      els.micStatus.textContent = t("mic.speak");
    };
    recognition.onresult = function (e) {
      let text = "";
      for (let i = 0; i < e.results.length; i++) {
        text += e.results[i][0].transcript;
      }
      els.agendaInput.value = text;
    };
    recognition.onerror = function (e) {
      els.micStatus.textContent = t("mic.error") + e.error;
    };
    recognition.onend = function () {
      recognizing = false;
      els.micBtn.classList.remove("recording");
      els.micBtn.innerHTML = micLabel();
      if (els.micStatus.textContent === t("mic.speak")) {
        els.micStatus.textContent = "";
      }
    };
  }

  function toggleMic() {
    if (!recognition) return;
    if (recognizing) {
      recognition.stop();
    } else {
      els.agendaInput.value = "";
      try {
        recognition.start();
      } catch (e) {
        // 連続クリック時のInvalidStateError対策
      }
    }
  }

  // ============================================================
  // Xシェア: 判定結果からポスト文を組み立て、投稿画面を開く
  // ============================================================
  function buildShareText() {
    if (!lastDecision) return "";
    // 判定の見出し（【可決】など）
    const head = t("share." + lastDecision.verdict);
    // 3賢者の結果を1行に（名前 noul 判定）
    const sagesLine = lastDecision.sages
      .map(function (s) {
        return s.name + " " + s.noul.toFixed(2) + " " + t("vote." + s.vote);
      })
      .join(" / ");
    // 議題（長すぎる場合は切り詰め）
    let agenda = lastAgenda || "";
    if (agenda.length > 80) agenda = agenda.slice(0, 77) + "…";
    // 本文（URLとhashtagsはintentの別パラメータで付くので本文には入れない）
    return (
      head +
      "\n「" +
      agenda +
      "」\n" +
      sagesLine +
      "\n" +
      t("share.tagline")
    );
  }

  function shareOnX() {
    if (!lastDecision) return;
    // ページURLにクエリを付けて X に「新しいURL」として扱わせ、
    // カード情報を取り直させる（古いキャッシュ回避）。
    // 議題ごとに決まる短いハッシュを使うので、同じ議題は同じURLになる。
    const shareUrl = MAGI_SHARE_URL + "?q=" + shareHash(lastAgenda);
    const params = new URLSearchParams({
      text: buildShareText(),
      url: shareUrl,
      hashtags: t("share.hashtags"),
    });
    // X の新しい intent エンドポイント。新規タブで1回だけ開く。
    const intent = "https://x.com/intent/post?" + params.toString();
    window.open(intent, "_blank", "noopener,noreferrer");
  }

  // 議題テキストから短い決定論的ハッシュ（36進数）を作る
  function shareHash(text) {
    let h = 2166136261;
    const s = String(text || "");
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  // ============================================================
  // ログパネルの開閉
  // ============================================================
  function toggleLogPanel() {
    els.logPanel.classList.toggle("hidden");
  }

  // ============================================================
  // イベント登録
  // ============================================================
  function bindEvents() {
    els.submitBtn.addEventListener("click", deliberateAgenda);
    els.micBtn.addEventListener("click", toggleMic);
    els.logBtn.addEventListener("click", toggleLogPanel);
    els.logClose.addEventListener("click", toggleLogPanel);
    els.langBtn.addEventListener("click", toggleLang);
    els.shareBtn.addEventListener("click", shareOnX);
    els.agendaInput.addEventListener("keydown", function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        deliberateAgenda();
      }
    });
  }

  // ============================================================
  // 起動
  // ============================================================
  function init() {
    applyStaticI18n();
    renderSagePanels();
    renderMode();
    setupSpeech();
    bindEvents();
  }

  init();
})();

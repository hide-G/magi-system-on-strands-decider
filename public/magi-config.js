// ============================================================
// MAGI System on Strands Decider 2B - 設定ファイル
// ------------------------------------------------------------
// 3賢者（MAGI）の定義、合議の閾値、Strands Decider バックエンドの
// エンドポイント、および多言語(i18n: 日本語/英語)辞書を一元管理します。
// 実モデル（ローカルの strands-decider）へ切り替える際もこのファイルを編集します。
//
// Strands Decider 2B は AWS の Strands チームによるオープンソースの
// 「意思決定モデル（decision model）」です。文章を生成せず、
// Yes/No（noul）や選択肢（choice）に 0〜1 の確率を返します。
//   - GitHub / Hugging Face で公開（Qwen3.5-2B ベース + pointer head）
//   - ローカルの CPU/GPU で動作（pip install strands-decider）
// ここでは MAGI の各賢者を「noul（Yes/No 確率）」の質問として扱います。
// ============================================================

const MAGI_CONFIG = {
  // ------------------------------------------------------------
  // 既定の表示言語: "ja" または "en"
  // （画面右上のトグルで切替。localStorageに保存される）
  // ------------------------------------------------------------
  defaultLang: "ja",

  // ------------------------------------------------------------
  // モード: "mock" = ローカルのモックエンジンを使用
  //         "live" = バックエンド経由で実 Strands Decider 2B を使用
  // ------------------------------------------------------------
  mode: "mock",

  // ------------------------------------------------------------
  // Strands Decider 2B 呼び出しの設定
  //   endpoint : バックエンド（strands-decider をローカル実行して noul を返す
  //              HTTPエンドポイント / Lambda Function URL など）を指す。
  //   model    : 使用するモデルID（Hugging Face のリポジトリID）。
  //
  // ★Strands Decider はオープンソースのローカルモデルなので、
  //   Jev のような API キーや Secrets Manager は不要。
  //   バックエンドが {state, questions} を受け取り、
  //   strands-decider を実行して {request, response, latencyMs, endpoint} を返す。
  // ------------------------------------------------------------
  decider: {
    // ローカル検証時は http://localhost:8787 など、
    // 本番は Lambda Function URL / API エンドポイントに置き換える。
    endpoint: "http://localhost:8787/deliberate",
    model: "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610",
  },

  // ------------------------------------------------------------
  // 合議の閾値（Strands Decider の noul は 0〜1 の確率）
  //   noul >= approveAt          -> 賛成(承認)
  //   noul <= rejectAt           -> 反対(拒否)
  //   rejectAt < noul < approveAt -> 保留(審議中)
  // ------------------------------------------------------------
  thresholds: {
    approveAt: 0.6,
    rejectAt: 0.4,
  },

  // ------------------------------------------------------------
  // 3賢者（MAGI）の定義
  //   id            : questionsキー（レスポンスもこのキーで返る）
  //   name          : 画面表示名（言語共通）
  //   codeName      : サブ表示（EVA風コードネーム）
  //   persona       : { ja, en } 人格の説明
  //   instructions  : { ja, en } Strands Decider へ渡す質問文
  // ------------------------------------------------------------
  sages: [
    {
      id: "melchior",
      name: "MELCHIOR",
      codeName: "MELCHIOR · 1",
      color: "#33ff66",
      persona: {
        ja: "科学者としての人格",
        en: "The Scientist",
      },
      instructions: {
        ja: "あなたは科学者の人格です。技術的な合理性・リスクとメリットの比較・論理的整合性の観点から、この議題を承認すべきか判断してください。",
        en: "You embody the scientist. Judge whether this matter should be approved from the standpoint of technical rationality, risk-benefit balance, and logical consistency.",
      },
    },
    {
      id: "balthasar",
      name: "BALTHASAR",
      codeName: "BALTHASAR · 2",
      color: "#33ccff",
      persona: {
        ja: "母としての人格",
        en: "The Mother",
      },
      instructions: {
        ja: "あなたは母親の人格です。人命・安全・倫理・長期的な保護の観点を最優先し、この議題を承認すべきか判断してください。",
        en: "You embody the mother. Prioritizing human life, safety, ethics, and long-term protection, judge whether this matter should be approved.",
      },
    },
    {
      id: "casper",
      name: "CASPER",
      codeName: "CASPER · 3",
      color: "#ffcc33",
      persona: {
        ja: "女としての人格",
        en: "The Woman",
      },
      instructions: {
        ja: "あなたは現実的で直感的な女性の人格です。実利・現実的な妥当性・人間関係の観点から、この議題を承認すべきか判断してください。",
        en: "You embody the pragmatic, intuitive woman. Judge whether this matter should be approved from the standpoint of practicality, real-world validity, and human relationships.",
      },
    },
  ],
};

// ============================================================
// i18n 辞書（UIテキスト）
// t(key) で参照する。{n} などのプレースホルダはapp.js側で置換。
// ============================================================
const MAGI_I18N = {
  ja: {
    "app.title": "MAGI SYSTEM",
    "app.subtitle": "on Strands Decider 2B",
    "header.classified": "極秘 · CLASSIFIED",
    "header.org": "特務機関 NERV",
    "mode.mock": "MOCK",
    "mode.live": "LIVE",
    "verdict.standby": "STANDBY",
    "verdict.deliberating": "審議中…",
    "verdict.prompt": "議題を入力してください",
    "verdict.thinking": "MAGI が審議しています",
    "verdict.approval": "可決 / APPROVAL",
    "verdict.rejection": "否決 / REJECTION",
    "verdict.deliberation": "審議未了 / DELIBERATION",
    "verdict.error": "通信エラー",
    "tally.format": "賛成 {approve} / 反対 {reject} / 保留 {hold}",
    "tally.needHuman": "（人間の判断が必要）",
    "vote.approve": "賛成",
    "vote.reject": "反対",
    "vote.hold": "保留",
    "vote.standby": "STANDBY",
    "sage.status": "決議",
    "input.placeholder": "MAGIに諮る議題を入力（例: 深夜に外部業者のサーバー室緊急入室を許可すべきか）",
    "input.needAgenda": "議題を入力してください。",
    "btn.mic": "音声",
    "btn.recording": "録音中",
    "btn.submit": "審議開始",
    "btn.log": "ログ表示",
    "mic.speak": "話してください…",
    "mic.unsupported": "※このブラウザは音声入力(Web Speech API)に非対応です。文字入力をご利用ください。",
    "mic.error": "音声認識エラー: ",
    "log.title": "DECIDER 通信ログ",
    "log.empty": "まだ通信はありません。審議を開始すると Strands Decider との送受信がここに表示されます。",
    "log.request": "REQUEST (POST /deliberate)",
    "log.response": "RESPONSE",
    "log.error": "エラー",
    "log.agenda": "議題: ",
    "footer.mock": "MODE: MOCK ｜ モデル未接続時はモックエンジンで動作します",
    "footer.live": "MODE: LIVE ｜ Strands Decider 2B に接続しています",
    "lang.toggle": "EN",
    "btn.share": "Xでシェア",
    "share.approval": "【可決】",
    "share.rejection": "【否決】",
    "share.deliberation": "【審議未了】",
    "share.hashtags": "MAGIシステム,StrandsDecider",
    "share.tagline": "AI3賢者(Strands Decider 2B)があなたの議題を審議します",
  },
  en: {
    "app.title": "MAGI SYSTEM",
    "app.subtitle": "on Strands Decider 2B",
    "header.classified": "TOP SECRET · CLASSIFIED",
    "header.org": "SPECIAL AGENCY NERV",
    "mode.mock": "MOCK",
    "mode.live": "LIVE",
    "verdict.standby": "STANDBY",
    "verdict.deliberating": "DELIBERATING…",
    "verdict.prompt": "Enter a matter to deliberate",
    "verdict.thinking": "MAGI is deliberating",
    "verdict.approval": "APPROVAL",
    "verdict.rejection": "REJECTION",
    "verdict.deliberation": "DELIBERATION",
    "verdict.error": "COMM ERROR",
    "tally.format": "Approve {approve} / Reject {reject} / Hold {hold}",
    "tally.needHuman": " (human judgment required)",
    "vote.approve": "APPROVE",
    "vote.reject": "REJECT",
    "vote.hold": "HOLD",
    "vote.standby": "STANDBY",
    "sage.status": "DECISION",
    "input.placeholder": "Enter the matter to put before MAGI (e.g. Should an outside contractor be allowed emergency server-room access at night?)",
    "input.needAgenda": "Please enter a matter.",
    "btn.mic": "VOICE",
    "btn.recording": "REC",
    "btn.submit": "DELIBERATE",
    "btn.log": "LOG",
    "mic.speak": "Speak now…",
    "mic.unsupported": "* This browser does not support voice input (Web Speech API). Please type instead.",
    "mic.error": "Speech recognition error: ",
    "log.title": "DECIDER COMM LOG",
    "log.empty": "No communication yet. Start a deliberation to see the exchange with Strands Decider here.",
    "log.request": "REQUEST (POST /deliberate)",
    "log.response": "RESPONSE",
    "log.error": "ERROR",
    "log.agenda": "Matter: ",
    "footer.mock": "MODE: MOCK | Running on the local mock engine while the model is not connected",
    "footer.live": "MODE: LIVE | Connected to Strands Decider 2B",
    "lang.toggle": "日本語",
    "btn.share": "Share on X",
    "share.approval": "[APPROVED]",
    "share.rejection": "[REJECTED]",
    "share.deliberation": "[UNDECIDED]",
    "share.hashtags": "MAGISystem,StrandsDecider",
    "share.tagline": "3 AI sages (Strands Decider 2B) deliberate your question",
  },
};

// 共有時にポスト文へ含めるサイトURL（本番配信URLの差し替えポイント）
// ------------------------------------------------------------
// フロント public/ は静的配信（S3 + CloudFront 等）される想定で、
// バックエンド server.mjs は strands-decider serve への中継のみを担います。
// 本番デプロイ時は、この値をフロントの公開配信URL（CloudFront ディストリ
// ビューション等）に差し替えてください。既定値はローカル確認用の
// プレースホルダです。app.js は `MAGI_SHARE_URL + "?q=" + hash` の形で
// 使うため、末尾スラッシュを含む文字列の形は変えないでください。
const MAGI_SHARE_URL = "http://localhost:8080/";

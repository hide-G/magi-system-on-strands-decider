# MAGI SYSTEM on Strands Decider 2B

[English](README.en.md) | [日本語](README.ja.md)

新世紀エヴァンゲリオンの **MAGIシステム** を、AWS Strands チームによる小さな
オープンソース「意思決定モデル」**Strands Decider 2B** で再現する Web アプリです。
3賢者（MELCHIOR / BALTHASAR / CASPER）が同一議題を独立して判断し、
確率つきの多数決で結論を出します。

> これは [magi-system-on-jev](https://github.com/hide-G/magi-system-on-jev)（Jev / TypeSafe AI 版）を
> フォークし、意思決定モデルを **Strands Decider 2B**（AWS・オープンソース）に差し替えた版です。

- **スマホ対応**（レスポンシブ）
- **日本語 / 英語 UI 切替**（🌐 ボタン。localStorage に保存され、賢者ペルソナ・判定文言・音声認識言語まで連動）
- **音声入力**（ブラウザの Web Speech API）＋ **文字入力**
- **ログ表示ボタン**で Strands Decider との通信過程（送信JSON・受信JSON・レイテンシ）を可視化
- **エヴァ風UI**: MAGIの三角配置、ヘキサゴン型パネル、CRTスキャンライン、TOP SECRET帯、決議グロー
- **Xでシェア**（議題・判定・3賢者noul・サイトURLを含むポスト）

---

## Strands Decider 2B とは

Strands Decider 2B は、AWS の Strands チームが公開したオープンソースの
**意思決定モデル（decision model）**です。通常の LLM のように文章を生成せず、
開発者が与えた選択肢（Yes/No や複数候補）に対して **0〜1 の確率** を返します。

- Qwen3.5-2B をベースに、文章生成用のヘッドを「選択肢を採点する pointer head」に置き換えた構成
- **20億パラメータ**で、ローカルの CPU/GPU でも動作（ミリ秒単位の低レイテンシ）
- コード・モデル重み・学習データ・学習スクリプトまで公開（GitHub / Hugging Face）

このアプリでは、MAGI の各賢者を **noul（Yes/No の確率）** 質問として扱います。
3つの質問を Strands Decider に渡し、返ってきた noul を閾値で 賛成/反対/保留 に分け、
多数決で総合判定を出します。

> 出典内容はライセンス上の制約に配慮し、言い換えています。

---

## ファイル構成

```
magi-decider/
├─ public/                  # 静的フロント（S3 + CloudFront 等へ配信）
│  ├─ index.html            # MAGI風UI + OGPメタ
│  ├─ styles.css            # エヴァ風・スマホ対応
│  ├─ app.js                # 入力→Decider→判定→描画→ログ→シェア
│  ├─ decider-client.js     # Strands Deciderクライアント（モック / バックエンド経由live）＋合議
│  ├─ magi-config.js        # 賢者定義・閾値・エンドポイント・i18n辞書
│  ├─ ogp.png / ogp.svg     # OGPカード画像（1200x630）
├─ backend/                 # strands-decider serve へ中継する薄いサーバー
│  ├─ server.mjs            # Node.js 標準httpサーバー（追加依存なし）
│  ├─ package.json
│  └─ requirements.txt      # 推論担当マシン側に入れる strands-decider（Python）
└─ README*.md
```

> 本番デプロイ（S3 + CloudFront / App Runner）の手順は [docs/DEPLOY.ja.md](docs/DEPLOY.ja.md) を参照してください。

---

## ローカルでの起動

### 1. フロント（モックで試す）

まずはモードが `mock` の状態（`magi-config.js` の既定）で、モデル無しに動かせます。
`public/` を静的配信するだけです。

```bash
cd public
python -m http.server 8080   # または: npx serve -l 8080
```

ブラウザで <http://localhost:8080> を開く。

> 音声入力(Web Speech API)は `http://localhost` では許可されますが、本番の平文HTTPでは動きません。

### 2. 実モデル（Strands Decider 2B）で動かす

実モデルを使う場合、構成は次の2段になります。

```
[ブラウザ public/] --POST /deliberate--> [server.mjs(中継)] --POST /v1/systemone--> [strands-decider serve]
```

**server.mjs はモデルを直接動かしません。** `strands-decider serve` が公開する
`/v1/systemone` へ、3賢者の質問を **1リクエストにまとめて** 中継する薄い役です。
重いモデル推論は serve 側（GPU機 or クラウド）が担当するので、非力なPCでも
server.mjs だけなら動かせます。

```bash
# (A) 推論担当マシン（GPU機 or クラウド）で Strands Decider のサーバーを起動
#     ※ このマシンにだけ strands-decider を入れる
pip install "strands-decider[cpu]"   # または [cuda]（Linux+NVIDIA GPU）
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8000

# (B) 中継バックエンド（Node.js）を起動。serve の場所を DECIDER_URL で指す
cd backend
DECIDER_URL=http://localhost:8000 node server.mjs    # 既定: http://localhost:8787
#   クラウドに serve を置いた場合は:
#   DECIDER_URL=https://<your-endpoint> node server.mjs
```

> `strands-decider serve` は既定で `127.0.0.1` バインド・認証なしです。別マシンや
> クラウドで公開する場合は、前段（リバースプロキシ / App Runner / ALB 等）で
> 公開アドレスへのバインドとHTTPS・認証を付けてください（`DECIDER_TOKEN` 対応）。

次に `public/magi-config.js` を編集:

```js
mode: "live",                       // "mock" から "live" に
decider: {
  endpoint: "http://localhost:8787/deliberate",
  model: "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610",
},
```

フロントを再読み込みして審議開始すると、各賢者の noul が実モデルから返ります。

> まだ serve を用意できない段階でフロント〜中継の疎通だけ確認したい場合は、
> `ALLOW_MOCK_FALLBACK=1 node server.mjs` で、上流未起動時に擬似 noul を
> 返させることもできます（デモ用）。

### 3. 実モデル接続の結合テスト手順（live）

公開エンドポイント（`DECIDER_URL`）と認証トークン（`DECIDER_TOKEN`）は
**別途用意されるもの**です。以下の `<...>` は必ず自分の値に置き換えてください。
**URL もトークンもプレースホルダであり、リポジトリには一切コミットしません**（鍵不要の設計）。

```bash
# (A) 推論担当マシンで上流を起動（まだ無い場合）
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8000

# (B) 中継バックエンドに、別途渡された接続先とトークンを環境変数で渡して起動
#     ※ 値はプレースホルダ。実際の URL / トークンはシェル履歴や config に残さない運用を推奨
cd backend
DECIDER_URL=https://<your-decider-endpoint> \
DECIDER_TOKEN=<your-token> \
node server.mjs
```

次に `public/magi-config.js` の `mode` を `"live"` にしてフロントを再読み込みし、
議題を審議します。各賢者の **noul が実モデルから返る**（モックのフォールバックではない）
ことを、ログパネルの受信JSON で確認してください。判定の決め手は `response.model` です。上流に
到達した場合はプレーンなモデルID `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610` のままですが、
モックのフォールバック時は中継が末尾に ` (mock-fallback)` を付与します
（例: `...-qwen3.5-v1-2610 (mock-fallback)`）。つまり `(mock-fallback)` が付いていなければ実上流からの
応答です。（レイテンシや `usage.input_tokens` が0以外であることは補助的な手がかりに過ぎません。
`input_tokens` はモックのフォールバック経路でも0以外になるため、それだけでは実/モックを区別できません。）

> `DECIDER_TOKEN` を設定すると、中継は上流へ `Authorization: Bearer <your-token>` を付けます。
> トークンはサーバー側の環境変数としてのみ渡し、フロントや Git には置かないでください。

---

## 使い方

1. 議題を入力（例:「唐揚げにレモンをかけるのはアリか？」）。🎤 音声入力も可（Chrome推奨）
2. **審議開始** を押す（Ctrl+Enter でも可）
3. 3賢者がそれぞれ **noul**（0〜1の確率）で 賛成/反対/保留 を表示し、総合判定が出る
4. **ログ表示** で Strands Decider への送受信JSONと所要時間を確認できる

### 合議ルール（`magi-config.js` の thresholds）
| noul | 賢者の判定 |
|---|---|
| ≧ 0.60 | 賛成 |
| ≦ 0.40 | 反対 |
| その間 | 保留 |

- 賛成2以上 → **可決**、反対2以上 → **否決**、それ以外 → **審議未了（人間の判断が必要）**

---

## バックエンドの役割（`backend/server.mjs`）

1. フロントから `{state, questions}` を受け取る
2. questions の `criteria` を `{true,false}` 形式に正規化（`yes/no` で来ても吸収）
3. 3賢者ぶんの質問を **1リクエストにまとめて** 上流 `strands-decider serve` の
   `POST /v1/systemone` へ中継し、各賢者の noul を取得
4. Jev版と同じ形のレスポンス（`answers` に noul）に整形して返す
5. 審議サマリ（議題・各賢者の noul・判定）を標準出力に1行ログ

> なぜ1リクエストにまとめるか: Strands Decider は state（議題）を一度だけ
> エンコードし、質問だけを前進させる共有プレフィックスキャッシュを持つため、
> 複数質問を1回で送るのが最も速く・軽いためです（質問ごとにCLIを起動していた
> 旧実装は毎回モデルをロードし直すため実用に向きませんでした）。

### Jev版との違い

| 観点 | Jev版（元） | Strands Decider 2B版（本リポジトリ） |
| --- | --- | --- |
| モデル | TypeSafe AI の Jev（ホスト型API） | AWS の Strands Decider 2B（オープンソース） |
| 接続 | `api.typesafe.ai` へHTTP | `strands-decider serve` の `/v1/systemone` へHTTP |
| APIキー | 必要（Secrets Managerで保護） | **不要**（任意で `DECIDER_TOKEN` を付与可） |
| バックエンド | Lambda（キー中継） | Node.js httpサーバー（systemoneへ中継） |

APIキーもSecretsManagerも不要になったため、Jev版のキー管理に関する記述は削除しています。

### 環境変数（`server.mjs`）
| 変数 | 既定 | 説明 |
| --- | --- | --- |
| `PORT` | `8787` | この中継サーバーの待受ポート |
| `DECIDER_URL` | `http://localhost:8000` | 上流 `strands-decider serve` のベースURL |
| `DECIDER_PATH` | `/v1/systemone` | systemone エンドポイントのパス |
| `DECIDER_MODEL` | `StrandsAgents/strands-decider-2B-qwen3.5-v1-2610` | ログ/表示用モデルID |
| `DECIDER_TOKEN` | （未設定） | 上流に認証を付けた場合の Bearer トークン |
| `DECIDER_TIMEOUT` | `60000` | 上流への待受タイムアウト(ms) |
| `ALLOWED_ORIGIN` | `*` | CORS 許可オリジン（本番は配信元に限定推奨） |
| `APPROVE_AT` / `REJECT_AT` | `0.6` / `0.4` | 合議の閾値（フロント既定と合わせる） |
| `ALLOW_MOCK_FALLBACK` | （未設定） | `1` のとき上流失敗時に擬似noulで応答（デモ用） |

---

## 送受信のデータ形式

**リクエスト** `POST /deliberate`
```json
{
  "state": { "議題": "...", "諮問日時": "..." },
  "questions": {
    "melchior":  { "type": "noul", "instructions": "...", "criteria": { "true": "...", "false": "..." } },
    "balthasar": { "type": "noul", "instructions": "..." },
    "casper":    { "type": "noul", "instructions": "..." }
  }
}
```

**レスポンス**
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

> Strands Decider は文字列を生成せず、型付きの判断（noul=Yes/No確率）を返すモデルです。
> 「型として有効＝意味的に正しい」ではないため、保留帯は人間にエスカレーションする設計にしています。

---

## クレジット・注記

- Strands Decider 2B は [AWS Strands チーム](https://strandsagents.com/blog/introducing-strands-decider/) によるオープンソースの意思決定モデルです。
- 元となった Jev / System One モデルは [TypeSafe AI](https://typesafe.ai/) によるものです。
- MAGI・エヴァンゲリオンはオマージュとして参照しているファン制作物で、公式とは関係ありません。
- このリポジトリに秘密情報は含まれません（APIキー等は使用しません）。

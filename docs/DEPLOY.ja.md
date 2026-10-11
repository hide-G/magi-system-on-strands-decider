# デプロイ手順書（LT 本番用ランブック）

MAGI SYSTEM on Strands Decider 2B を AWS に本番デプロイするための、
**上から順に実行していくチェックリスト** です。LT 会場で時間に追われながら
実行する前提なので、コマンドはすべてコピペ可能な形にしてあります。

> **プレースホルダの約束**
> `<...>` や `<YOUR_...>` はすべて自分の値に置き換えてください。
> このリポジトリには **実在のアカウントID・バケット名・ドメイン・トークンを一切コミットしません**（鍵不要の設計）。
> シェル履歴や設定ファイルに実トークンを残さない運用を推奨します。

> **重要（コミットしない編集がある）**
> このランブック中で `public/magi-config.js` を `mode: "live"` に書き換える手順がありますが、
> それは **デプロイ時にローカルで行う一時的な編集** です。リポジトリの既定（`mode: "mock"` /
> `endpoint: "http://localhost:8787/deliberate"` / `MAGI_SHARE_URL: "http://localhost:8080/"`）は
> **そのまま**にしておき、コミットはしません。

---

## 0. 構成（3段）と実行順序

```
[ブラウザ public/]
     │  POST /deliberate
     ▼
[中継リレー backend/server.mjs]   ← AWS App Runner（本手順の主役）
     │  POST /v1/systemone
     ▼
[上流モデル strands-decider serve] ← 別途提供される DECIDER_URL / DECIDER_TOKEN
```

- **(1) フロント `public/`** … 静的ホスティング（Amazon S3 + CloudFront）。ビルド工程はなく、配信前にローカルで `magi-config.js` を数行編集するだけ。
- **(2) 中継リレー `backend/server.mjs`** … Node.js 標準ライブラリのみの薄い中継。追加依存なし。App Runner に載せる。
- **(3) 上流モデル `strands-decider serve`** … **本番では別途提供される** エンドポイント（`DECIDER_URL`）とトークン（`DECIDER_TOKEN`）を使う。**GPU マシンを本番で立てる必要はありません**（自前ホストは任意・後述）。

### ⚠ 鶏と卵の順序（必ずこの順で）

フロントの `magi-config.js` には **リレーの公開URL** を書き込む必要があるため、
リレーを先にデプロイして URL を確定させないとフロントを配信できません。

1. **先に 中継リレー（App Runner）をデプロイ** → 公開URLを控える
2. その URL を使って **ローカルで `public/magi-config.js` を編集**（コミットしない）
3. **フロントを S3 へ同期 → CloudFront で配信**

---

## 1. 前提 / Prerequisites

- [ ] **AWS CLI がconfigure済み**（`aws configure` もしくは SSO）で、使うアカウントとリージョンを決めてある
  ```bash
  aws sts get-caller-identity          # 自分のアカウントか確認
  export AWS_REGION=<YOUR_REGION>      # 例: ap-northeast-1。以降のコマンドで使用
  ```
- [ ] **Node.js 20 以上** がローカルに入っている（`node -v`）
- [ ] このリポジトリをチェックアウト済み（`backend/` と `public/` がある）
- [ ] **上流モデルの接続先が手元にある**（別途提供されるプレースホルダ）
  - `DECIDER_URL=https://<your-decider-endpoint>`
  - `DECIDER_TOKEN=<YOUR_DECIDER_TOKEN>`
- [ ] GPU マシンを本番で立てる必要は **ありません**（上流は提供済みの前提）。

---

## 2. ステップB：中継リレー → AWS App Runner（本手順の主役・最初に実行）

`backend/server.mjs` は Node 標準ライブラリのみ・追加依存なしで、`package.json` の
`start` が既に `node server.mjs` です。App Runner に **ランタイム=Node / 起動コマンド=`node server.mjs`**
で載せます。App Runner は **HTTPS** と `https://<random>.<region>.awsapprunner.com` 形式の
サービスURLを自動で用意してくれます。

### 2-1. コンソールで作る場合（最短）

1. App Runner → **Create service**
2. **Source**: Source code repository（GitHub連携）で `backend/` を指す、
   もしくは手元の `backend/` を zip 化してソースにする
   - ※ GitHub連携（Source code repository）を選ぶ場合は、事前に App Runner コンソールで **GitHub 接続（connection）を1回作成** しておく必要があります。zip/コンソール直アップロードの経路では不要です。
3. **Build settings**: Runtime = **Nodejs**（18/20系）、Build command = （なし）、
   **Start command = `node server.mjs`**
4. **Service settings → Port**: `8787`（server.mjs の既定ポート）
5. **環境変数** を設定（下表、プレースホルダ）
6. Create → 数分で **サービスURL** `https://<random>.<region>.awsapprunner.com` が出る → **控える**

### 2-2. 設定する環境変数（本番で上書きするもの）

| 変数 | 本番で入れる値（プレースホルダ） | 用途 |
| --- | --- | --- |
| `DECIDER_URL` | `https://<your-decider-endpoint>` | 上流モデルのベースURL（別途提供） |
| `DECIDER_TOKEN` | `<YOUR_DECIDER_TOKEN>` | 上流が認証付きなら Bearer トークン |
| `ALLOWED_ORIGIN` | `https://<your-cloudfront-domain>` | CORS 許可元（CloudFront ドメインに限定） |
| `ALLOW_MOCK_FALLBACK` | `1`（任意・デモ保険） | 上流に繋がらない時に擬似noulで応答 |

> `PORT` は既定 `8787` のままで良いので App Runner のポート設定を `8787` に合わせます。

### 2-3. CLI で作る場合（代表例・プレースホルダ）

> 下記は構文の目安です。実際には ARN 等を自分の値に置き換えてください。

```bash
# ソースコードリポジトリ連携で作成する例
aws apprunner create-service \
  --service-name magi-relay \
  --region "$AWS_REGION" \
  --source-configuration '{
    "AutoDeploymentsEnabled": true,
    "AuthenticationConfiguration": { "ConnectionArn": "<YOUR_GITHUB_CONNECTION_ARN>" },
    "CodeRepository": {
      "RepositoryUrl": "https://github.com/<YOUR_ORG>/<YOUR_REPO>",
      "SourceCodeVersion": { "Type": "BRANCH", "Value": "main" },
      "SourceDirectory": "backend",
      "CodeConfiguration": {
        "ConfigurationSource": "API",
        "CodeConfigurationValues": {
          "Runtime": "NODEJS_20",
          "BuildCommand": "",
          "StartCommand": "node server.mjs",
          "Port": "8787",
          "RuntimeEnvironmentVariables": {
            "DECIDER_URL": "https://<your-decider-endpoint>",
            "DECIDER_TOKEN": "<YOUR_DECIDER_TOKEN>",
            "ALLOWED_ORIGIN": "https://<your-cloudfront-domain>",
            "ALLOW_MOCK_FALLBACK": "1"
          }
        }
      }
    }
  }'

# 作成後、サービスURLを控える（フロントの endpoint に使う）
aws apprunner list-services --region "$AWS_REGION" \
  --query "ServiceSummaryList[?ServiceName=='magi-relay'].ServiceUrl" --output text
```

- 出力された `https://<random>.<region>.awsapprunner.com` が **リレーの公開URL**。
- **フロントの endpoint 値 = そのURL + `/deliberate`**（例: `https://<your-relay-domain>/deliberate`）。

### 2-4. 他の載せ方（簡単に）

- **ECS Fargate**: タスク定義でコンテナを `node server.mjs` 起動、ALB で HTTPS 終端。常駐サーバー向けで安定。
- **EC2**: 1台に Node を入れて `node server.mjs`、前段に Nginx/ALB で HTTPS。最も手数が多い。
- **Lambda + Function URL は不向き**: `server.mjs` は `http.createServer` で待ち受ける **常駐HTTPサーバー** のため、リクエスト駆動の Lambda には素直に載りません（App Runner を推奨）。

---

## 3. `server.mjs` の環境変数（既定一覧）

`server.mjs` が読む環境変数の **既定値** は次の通りです（README.ja.md と同じ）。
本番で上書きすべきは **`DECIDER_URL` / `DECIDER_TOKEN` / `ALLOWED_ORIGIN`** です。

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

リレーが公開するエンドポイント:

- `GET /health` … 生存確認。`{ok, model, upstream, mockFallback}` を返す
- `POST /deliberate` … 審議本体。フロントからの `{state, questions}` を受けて上流へ中継

---

## 4. ステップA：フロント → S3 + CloudFront（リレーURL確定後に実行）

### 4-1. まず `public/magi-config.js` をローカル編集（コミットしない）

ステップBで控えた **リレーの公開URL** と **CloudFront ドメイン** を使って、
次の3箇所だけ書き換えます。

```js
// public/magi-config.js（デプロイ時のローカル編集・コミットしない）

mode: "live",                                            // "mock" → "live"

decider: {
  endpoint: "https://<your-relay-domain>/deliberate",    // App Runner のURL + /deliberate
  model: "StrandsAgents/strands-decider-2B-qwen3.5-v1-2610",
},

// ファイル末尾付近。末尾スラッシュは必ず残す
const MAGI_SHARE_URL = "https://<your-cloudfront-domain>/";
```

> ⚠ **この編集はコミットしません。** リポジトリの既定は `mode: "mock"` /
> `endpoint: "http://localhost:8787/deliberate"` / `MAGI_SHARE_URL: "http://localhost:8080/"` のままにします。
> （LT 後に `git checkout -- public/magi-config.js` で元に戻せます。）

### 4-2. S3 バケット作成とアップロード

```bash
# バケット作成（配信は CloudFront 経由。S3 自体はパブリックにしない）
aws s3 mb s3://<YOUR_BUCKET> --region "$AWS_REGION"

# 編集済みの public/ をアップロード（--delete で古い資産も掃除）
aws s3 sync public/ s3://<YOUR_BUCKET>/ --delete
```

### 4-3. CloudFront ディストリビューションを作成（OAC 推奨）

S3 は **パブリックにせず**、CloudFront + **OAC（Origin Access Control）** でのみ配信します。

**コンソール手順（最短）:**

1. CloudFront → **Create distribution**
2. **Origin domain** = `<YOUR_BUCKET>.s3.<YOUR_REGION>.amazonaws.com`
3. **Origin access** = **Origin access control settings (recommended)** → OAC を新規作成
4. **Default root object** = `index.html`
5. **Viewer protocol policy** = **Redirect HTTP to HTTPS**
6. 作成後、提示される **バケットポリシー** を S3 に適用（この CloudFront からのみ読める設定）
7. 払い出された **ディストリビューションドメイン** `https://<your-cloudfront-domain>` を控える

**CLI の形（代表例・プレースホルダ）:**

```bash
# OAC を作成
aws cloudfront create-origin-access-control \
  --origin-access-control-config '{
    "Name": "magi-oac",
    "SigningProtocol": "sigv4",
    "SigningBehavior": "always",
    "OriginAccessControlOriginType": "s3"
  }'

# ディストリビューションを作成（設定JSONはプレースホルダ。ドメイン等は自分の値へ）
aws cloudfront create-distribution \
  --distribution-config file://<YOUR_DISTRIBUTION_CONFIG_JSON>
```

> 控えた `https://<your-cloudfront-domain>` を、ステップBの App Runner 環境変数
> `ALLOWED_ORIGIN` と、`magi-config.js` の `MAGI_SHARE_URL` に反映します。

### 4-4. 更新時のキャッシュ無効化（再配信）

`public/` を再 sync したら、CloudFront のキャッシュを無効化して反映させます。

```bash
aws s3 sync public/ s3://<YOUR_BUCKET>/ --delete
aws cloudfront create-invalidation \
  --distribution-id <YOUR_DISTRIBUTION_ID> --paths '/*'
```

> ※ CloudFront のディストリビューション作成や `create-invalidation` の反映には **数分かかることがあります**。会場では少し待つ前提で、すぐ反映されなくても障害と判断しないでください。

---

## 5. ステップC（任意・後回し可）：上流モデルを自前ホストする場合

**LT では通常これは不要**で、別途提供される `DECIDER_URL` / `DECIDER_TOKEN` を
ステップBのリレーに差すだけで済みます。どうしても自前で立てる場合のみ参照してください。

```bash
# 推論担当マシン（GPU機 or クラウド）にだけ入れる
pip install "strands-decider[cpu]"     # または [cuda]（Linux + NVIDIA GPU）
strands-decider serve StrandsAgents/strands-decider-2B-qwen3.5-v1-2610 --port 8000
```

- `strands-decider serve` は **既定で `127.0.0.1` バインド・認証なし** です。
  外部公開するなら前段に **リバースプロキシ + HTTPS + トークン** を置いてください。
- その公開アドレスとトークンを、ステップBの `DECIDER_URL` / `DECIDER_TOKEN` に設定します。

---

## 6. 動作確認（本番チェックリスト）

- [ ] **(1) リレーの疎通**
  ```bash
  curl https://<your-relay-domain>/health
  ```
  `{"ok":true,"model":"StrandsAgents/strands-decider-2B-qwen3.5-v1-2610","upstream":"...","mockFallback":false}`
  のような JSON が返ること（`model` が **プレーンなモデルID** であること）。

- [ ] **(2) フロントの表示**
  CloudFront の URL `https://<your-cloudfront-domain>` を開き、
  フッター/モード表示が **LIVE** になっていること。

- [ ] **(3) 実モデル vs モックの判別（最重要）**
  議題を1件審議し、ログパネルの受信JSONで `response.model` を確認する。
  - **決め手**: `response.model` に **` (mock-fallback)` が付いていなければ実上流からの応答**。
    モックのフォールバック時はリレーが末尾に ` (mock-fallback)` を付ける
    （例: `...-qwen3.5-v1-2610 (mock-fallback)`）。
  - 補助情報: `usage.input_tokens` が0以外であることは **実/モックの両経路で起こる** ため、
    それ **だけでは判別できない**（あくまで二次的な手がかり）。

- [ ] **(4) 既存機能の確認**
  日本語/英語トグル、ログパネル（送受信JSON + レイテンシ）、Xでシェア がすべて動くこと。

---

## 7. 【LT本番の保険】上流に繋がらない時

会場で実モデルのエンドポイントに到達できない場合でも、**審議の割れた結果（split verdict）** を
見せられるように保険を用意しておきます。どちらか一方で復旧できます。

- **方法A（推奨）: リレー側で `ALLOW_MOCK_FALLBACK=1`**
  App Runner のサービス環境変数に `ALLOW_MOCK_FALLBACK=1` を追加して再デプロイ。
  上流失敗時でもリレーが **賢者ごとに割れた擬似noul** を返すので、デモが成立します。
  ```bash
  # コンソール: App Runner → サービス → Configuration → 環境変数に ALLOW_MOCK_FALLBACK=1 → Deploy
  # もしくはサービス更新で RuntimeEnvironmentVariables に ALLOW_MOCK_FALLBACK=1 を含めて再デプロイ
  ```

- **方法B: フロントを一時的に `mode: "mock"`**
  `public/magi-config.js` を `mode: "mock"` に戻して再 sync + 無効化。
  ```bash
  aws s3 sync public/ s3://<YOUR_BUCKET>/ --delete
  aws cloudfront create-invalidation --distribution-id <YOUR_DISTRIBUTION_ID> --paths '/*'
  ```

> いずれの場合も、各賢者は 賛成/反対/保留 に割れた結果を返すため、
> MAGI らしい「割れた多数決」の画面を見せられます。

---

## 8. CORS と HTTPS の注意

- **`ALLOWED_ORIGIN` は `*` のままにしない。** 本番は **CloudFront の正確なドメイン**
  `https://<your-cloudfront-domain>` に限定する（ステップBの環境変数で設定）。
- **音声入力（Web Speech API）は HTTPS 必須。** CloudFront が HTTPS を提供するので動作しますが、
  平文 HTTP だとマイクが使えません。CloudFront のビューワポリシーは
  **Redirect HTTP to HTTPS** にしておくこと。

---

## 9. 後片付け / コスト注意（LT 終了後）

> **App Runner と CloudFront は起動している間、課金が発生します。** LT が終わったら片付けましょう。

```bash
# 1) CloudFront ディストリビューションを無効化 → 削除
#    （無効化が反映されてから削除。コンソールの Disable → Delete が確実）
aws cloudfront get-distribution-config --id <YOUR_DISTRIBUTION_ID>   # ETag を控える
#   Disabled に更新してから:
aws cloudfront delete-distribution --id <YOUR_DISTRIBUTION_ID> --if-match <ETAG>

# 2) S3 バケットを空にして削除
aws s3 rm s3://<YOUR_BUCKET>/ --recursive
aws s3 rb s3://<YOUR_BUCKET>

# 3) App Runner サービスを削除
aws apprunner delete-service --service-arn <YOUR_SERVICE_ARN> --region "$AWS_REGION"
```

- 自前で上流（`strands-decider serve`）を立てた場合は、その GPU マシン/コンテナも忘れず停止・削除してください。
- ローカルの `public/magi-config.js` を編集していた場合は `git checkout -- public/magi-config.js` で既定に戻します。

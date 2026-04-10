## デプロイ

### Downstream APIの準備

Azure FunctionsでDownstream APIのアクセストークンを取得するにはFunctionsのアプリ登録に対してDownstream APIへのアクセス許可を付与する必要があります。

今回は、証明書を使ってAzure Functions自身をEntra IDに認証する方式を用います。これにより、Functionsは自分が正当なアプリであることを示すことでDownstream APIのトークンを取得できるようになります。

Key Vaultで証明書を作成し、その証明書をDownstream APIのアプリ登録に証明書を登録するという処理を行います。

#### アプリ登録

(TBD)

#### 証明書作成

Key Vaultが未作成の場合は、次のコマンドを実行して作成します。

```bash
cd azure/

# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# Key Vault作成
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/keyvault.bicep \
```

作成したKey Vaultで証明書を生成します。

(画像TBD)

#### アプリ登録に証明書を登録

```bash
az ad app credential reset \
  --id "$APP_ID" \
  --keyvault "$KV_NAME" \
  --cert "$CERT_NAME" \
  --append
```

### Azureリソースデプロイ

`example.bicepparam` から `param.bicepparam` を作成し、以下の変数を設定してください。

| 変数名                                          | 概要                                                        |
| ----------------------------------------------- | ----------------------------------------------------------- |
| `easyAuthClientSecret`                          | Easy Auth用のアプリケーションのクライアントシークレット     |
| `oboClientCertificateSecretUri`                 | OBO用証明書を保存したKey Vault secretのSecretUri            |
| `oboClientCertificateKeyVaultResourceGroupName` | OBO用証明書を保存したKey Vault が存在するリソースグループ名 |

```bash
# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# リソース作成
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/main.bicep \
  -p infra/param.bicepparam
```

#### Easy Auth用アプリ登録のシークレットを生成する

(TBD) Easy Auth用のシークレットはポータルから設定すれば環境変数にも設定してくれて楽そう

この構成では、ブラウザにはトークンを持たせず、Easy Authが保持したトークンをFunctionから `/.auth/me` 経由で取得してOBOに使います。

Easy Authから `/.auth/me` でアクセストークンを取得する場合は、Easy Auth用アプリ登録のクライアントシークレットをFunctionsに設定する必要があるため、事前に手動でアプリ登録を実行します。ここで生成したシークレットを、リソースデプロイの際にパラメータ (`easyAuthClientSecret`) としてBicepに渡します (https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-oauth-tokens)

### アプリケーションのデプロイ

#### Azure Functions

リソース作成後、Azure Functionsをビルドしデプロイしてください。

```bash
cd azure/functions
npm install
npm run build # ビルド
func azure functionapp publish <FunctionAppName> # デプロイ
```

#### SPA

`az deployment` 実行後に出力される `functionAppUrl` と `spaStorageName` を使ってビルド済みファイルを配置します。
アップロード後、`spaStaticWebsiteUrl` へアクセスしてください。

初回セットアップでは、`spa/.env.production.example` をコピーして `spa/.env.production` を作成し、Function App の URL を設定してください。

アップロードするためには以下のロールのいずれかが必要です。

- `Storage Blob Data Contributor`
- `Storage Blob Data Owner`

```bash
cd spa

# .env.production を編集して VITE_API_BASE_URL を設定
cp .env.production.example .env.production

# ビルド
npm install
npm run build

# dist/ を $web コンテナへアップロード
az storage blob upload-batch \
  --account-name <spaStorageName> \
  --destination '$web' \
  --source dist \
  --auth-mode login \
  --overwrite
```

## 認証フロー

- SPAは `https://<function-app>.azurewebsites.net/.auth/login/aad?post_login_redirect_uri=<SPA URL>` に遷移してサインイン
- Easy AuthはFunctionsのドメインにCookie(`AppServiceAuthSession`)を保存
- SPAは `fetch("https://<function-app>/api/profile", { credentials: "include" })` でAPIを呼び出し
- Functionsは `/.auth/me` からトークンを取得し、OBOでMicrosoft Graph用アクセストークンを取得し、Graph APIを呼び出し

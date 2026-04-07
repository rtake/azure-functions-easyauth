## デプロイ

このリポジトリは次の分離構成を前提にしています。

- SPA: Azure Storage Static Website
- Backend API: Azure Functions
- 認証セッション: Azure Functions の Easy Auth

SPA はアクセストークンを保持しません。ブラウザは Function App の `AppServiceAuthSession` cookie だけを使って `GET /api/profile` を呼び出し、Function 側で `/.auth/me` からトークンを取り出して OBO を実行します。

### Downstrem APIの準備

- アプリ登録

### Key Vaultの作成とクライアントシークレットの登録

以下のコマンドでKey Vaultを作成します。
`infra/keyvault.bicep` は、`main.bicep` が参照する既存 Key Vault を先に用意するためのテンプレートです。
証明書 PEM の secret は別途 Key Vault に登録し、その `SecretUri` を `infra/main.bicep` の `oboClientCertificateSecretUri` に設定します。

```
# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# Key Vault 作成
cd azure/
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/keyvault.bicep \
```

作成後、Key ValutにDownstrema API用のクライアントシークレットを登録します。
![](/docs/keyvault-create-secret.png)

この構成では、OBO 用の証明書は `Key Vault certificate` ではなく `Key Vault secret` として登録します。
Function App は Key Vault から secret 値を取得し、その内容を PEM ファイルとして保存して `OnBehalfOfCredential` に渡します。

- 登録先は `Certificates` ではなく `Secrets`
- secret の値は PEM 形式の文字列
- PEM には公開証明書だけでなく秘密鍵も含める

証明書をまだ持っていない場合は、まず秘密鍵と自己署名証明書を作成します。

```bash
# 秘密鍵を作成
openssl genrsa -out obo-client.key 2048

# 自己署名証明書を作成
openssl req -new -x509 \
  -key obo-client.key \
  -out obo-client.crt \
  -days 365 \
  -subj "/CN=obo-client"

# Key Vault に登録する PEM を作成
cat obo-client.crt obo-client.key > obo-client-combined.pem
```

Azure AD のアプリ登録には、公開証明書だけをアップロードします。
ポータルでアップロードする場合は `obo-client.crt` を使ってください。

![](/docs/upload-cert.png)

その後、Key Vault secret として PEM を登録します。

```bash
az keyvault secret set \
  --vault-name <KeyVaultName> \
  --name oboClientCertificateSecret \
  --file obo-client-combined.pem
```

Azure Portal から secret を手入力で登録する場合は、PEM の改行を維持したまま貼り付けてください。
改行が `\n` を含む1行文字列に変わると、実行時に証明書として読み取れないことがあります。
可能であれば `az keyvault secret set --file ...` で登録するほうが安全です。

`param.bicepparam` の `oboClientCertificateSecretUri` に作成したシークレットのURIを設定します。
Key Vault を別のリソースグループに置く場合は、`oboClientCertificateKeyVaultResourceGroupName` にそのリソースグループ名も設定します。

### リソースデプロイ

```
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

Easy Auth から `/.auth/me` でアクセストークンを取得したい場合は、Easy Auth 用アプリ登録にも client secret が必要です。
この構成では、ブラウザにはトークンを持たせず、Easy Auth が保持したトークンを Function から `/.auth/me` 経由で取得して OBO に使います。
そのため `infra/main.bicep` の `easyAuthClientSecret` には、Easy Auth 用アプリ登録に発行した client secret を設定してください。

- `easyAuthClientSecret`
  Easy Auth が ID プロバイダーからユーザートークンを取得し、token store (`/.auth/me`) に保持するために使います
- `oboClientCertificateSecretUri`
  既存 Key Vault secret の `SecretUri` です
- `oboClientCertificateKeyVaultResourceGroupName`
  既存 Key Vault が存在するリソースグループ名です。省略時はデプロイ先と同じリソースグループを使います

Function App は証明書 PEM を app setting に展開せず、managed identity で Key Vault の secret を実行時に直接取得して OBO に使います。
公開証明書は、OBO に使うアプリ登録へ事前に登録しておいてください。

参考:

- https://learn.microsoft.com/en-us/azure/app-service/configure-authentication-oauth-tokens
- https://learn.microsoft.com/en-gb/azure/app-service/overview-authentication-authorization

### Azure Functionsのデプロイ

リソース作成後、Azure Functionsをビルドしデプロイしてください。

```
cd azure/functions
npm install
npm run build # ビルド
func azure functionapp publish <FunctionAppName> # デプロイ
```

### SPA の配置

`spa/` は React + Vite で構成しています。デプロイ完了後、出力された `functionAppUrl` と `spaStorageName` を使ってビルド済みファイルを配置します。`spaStorageName` は Azure Functions の `AzureWebJobsStorage` に使っているものと同じ Storage Account です。

#### SPA の作成と設定

SPA のソースコードは `spa/` 配下にあります。

- `spa/src/App.jsx`
  Easy Auth へのサインイン、サインアウト、`/api/profile` 呼び出しを行う React コンポーネントです
- `spa/src/main.jsx`
  React のエントリポイントです
- `spa/src/styles.css`
  サンプル画面のスタイルです
- `spa/.env.production.example`
  本番ビルド用の環境変数サンプルです

初回セットアップでは、`spa/.env.production.example` をコピーして `spa/.env.production` を作成し、Function App の URL を設定してください。

1. `spa/.env.production` を作成して `VITE_API_BASE_URL=<functionAppUrl>` を設定
2. React SPA をビルド
3. `dist/` を `$web` コンテナへアップロード

```bash
cd spa
npm install
cp .env.production.example .env.production
# .env.production を編集して VITE_API_BASE_URL を設定
npm run build

az storage blob upload-batch \
  --account-name <spaStorageName> \
  --destination '$web' \
  --source dist \
  --auth-mode login \
  --overwrite
```

`.env.production` の例:

```bash
VITE_API_BASE_URL=https://func-xxxxxx.azurewebsites.net
```

アップロード後、`spaStaticWebsiteUrl` へアクセスしてください。

重要:

- `easyAuthLoginBaseUrl` は Function App 側のログインエンドポイントです
- この URL をブラウザで直接開くと、サインイン後に `https://<function-app>.azurewebsites.net/` へ戻ることがあります
- SPA からは `post_login_redirect_uri` を付けてログインさせるため、必ず `spaStaticWebsiteUrl` 側を開いてから `Sign in` ボタンを使ってください
- `Sign in` ボタンの実装は `spa/src/App.jsx` にあり、現在開いている SPA の URL を `post_login_redirect_uri` に自動設定します

#### Static Website へのアップロード権限

`az storage blob upload-batch --auth-mode login` を使う場合は、Azure RBAC のデータプレーン権限が必要です。サブスクリプションやリソースグループの `Owner` だけでは足りず、Storage Account に対して少なくとも次のいずれかが必要です。

- `Storage Blob Data Contributor`
- `Storage Blob Data Owner`

今回のように `共同作成者` 相当の Blob データロールを付与すると、`--auth-mode login` で `$web` コンテナへアップロードできます。

### SPA の認証フロー

- SPA は `https://<function-app>.azurewebsites.net/.auth/login/aad?post_login_redirect_uri=<SPA URL>` に遷移してサインイン
- Easy Auth は Function App ドメインに認証 cookie を保存
- SPA は `fetch("https://<function-app>/api/profile", { credentials: "include" })` で API を呼び出し
- Function App は `/.auth/me` からトークンを取得し、OBO で Microsoft Graph を呼び出し

この方式ではトークンは常に Function App 側で扱われ、SPA からは見えません。

Function App の `authsettingsV2` では、Static Website の URL を `allowedExternalRedirectUrls` に登録しています。これがないと、サインイン後に `/.auth/login/done#token=...` へ遷移して SPA に戻れません。
また、URL の末尾 `/` 有無で判定がずれないよう、Bicep では両方を許可しています。

注意:

- SPA と Function App は別オリジンなので、Function App 側の CORS は Bicep で Static Website の URL のみに絞っています
- この構成は「トークンを SPA に露出させない」要件は満たしますが、クロスサイト cookie に依存します
- 将来的に本番構成へ寄せるなら、Front Door やカスタムドメインで単一オリジン化するのがより堅実です

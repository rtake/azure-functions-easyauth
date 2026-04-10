## デプロイ

### Azureリソースデプロイ

```bash
# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# リソース作成
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/main.bicep \
```

Easy Auth用アプリ登録への認証はマネージドIDで行います [Easily add login to your Azure app with Bicep](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/easily-add-login-to-your-azure-app-with-bicep/4386493)

([Microsoft Learn](https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-oauth-tokens)には下記のような記載がありましたが、マネージドIDでの認証でもトークンストアが利用可能になったようです(プレビュー))

> アクセス トークンはプロバイダー リソースにアクセスするためのものであるため、クライアント シークレットを使用してプロバイダーを構成した場合にのみ存在します。

こちらにも記載があります: [シークレットの代わりにマネージド ID を使用する (プレビュー)](https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-provider-aad?tabs=workforce-configuration#use-a-managed-identity-instead-of-a-secret-preview)

Azure FunctionsでDownstream APIのアクセストークンを取得するには、Functionsのアプリ登録に対してDownstream APIへのアクセス許可を付与する必要があります。

ユーザー割り当てマネージドIDを使って、Azure Functions自身をEntra IDに認証します (参考: [Create on behalf of token using managed identity](https://learn.microsoft.com/en-us/answers/questions/2113573/create-on-behalf-of-token-using-managed-identity#:~:text=Hi%20%40Ketan%20Joshi%20%2C%20welcome,assigned%20managed%20identity)) 。これにより、Functionsは自分が正当なアプリであることを示すことでDownstream APIのトークンを取得できるようになります。

OBOフローの実装には [@azure/msal-nodeのacquireTokenOnBehalfOf](https://learn.microsoft.com/ja-jp/javascript/api/@azure/msal-node/confidentialclientapplication?view=msal-js-latest#@azure-msal-node-confidentialclientapplication-acquiretokenonbehalfof) を使用しています。

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

## デプロイ

### アプリ登録

#### Easy Auth用アプリ登録

この構成では、ブラウザにはトークンを持たせず、Easy Authが保持したトークンをFunctionから `/.auth/me` 経由で取得してOBOに使います。

Easy Authから `/.auth/me` でアクセストークンを取得する場合は、Easy Auth用アプリ登録のクライアントシークレットをFunctionsに設定する必要があるため、事前に手動でアプリ登録を実行します。ここで生成したシークレットを、リソースデプロイの際にパラメータとしてBicepに渡します (https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-oauth-tokens)

#### Downstrem API用アプリ登録

Function App は証明書 PEM を app setting に展開せず、managed identity で Key Vault の secret を実行時に直接取得して OBO に使います。
公開証明書は、OBO に使うアプリ登録へ事前に登録しておいてください。

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

### Azure Functionsのデプロイ

リソース作成後、Azure Functionsをビルドしデプロイしてください。

```
cd azure/functions
npm install
npm run build # ビルド
func azure functionapp publish <FunctionAppName> # デプロイ
```

### SPAのデプロイ

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

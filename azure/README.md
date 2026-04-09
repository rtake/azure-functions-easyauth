## デプロイ

### Easy Auth用アプリ登録のシークレットを生成する

この構成では、ブラウザにはトークンを持たせず、Easy Authが保持したトークンをFunctionから `/.auth/me` 経由で取得してOBOに使います。

Easy Authから `/.auth/me` でアクセストークンを取得する場合は、Easy Auth用アプリ登録のクライアントシークレットをFunctionsに設定する必要があるため、事前に手動でアプリ登録を実行します。ここで生成したシークレットを、リソースデプロイの際にパラメータ (`easyAuthClientSecret`) としてBicepに渡します (https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-oauth-tokens)

### Downstream APIの認可設定

Azure FunctionsでDownstream APIのアクセストークンを取得するにはFunctionsのアプリ登録に対してDownstream APIへのアクセス許可を付与する必要があります。

今回は、証明書を使ってAzure Functions自身をEntra IDに認証する方式を用います。これにより、Functionsは自分が正当なアプリであることを示すことでDownstream APIのトークンを取得できるようになります。

Key Vaultで証明書を作成し、その証明書をDownstream APIのアプリ登録に証明書を登録するという処理を行います。

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

---

~~1. Downstream API用の秘密鍵・証明書を生成する~~
~~2. 証明書をアプリ登録にアップロードする~~
~~3. 秘密鍵をKey Vaultにアップロードし、Azure Functionsから参照できるように設定する~~

#### 1. 証明書と秘密鍵を作成する

以下のコマンドで秘密鍵と証明書を作成します。

```bash
# 秘密鍵を作成
openssl genrsa -out obo-client.key 2048

# 自己署名証明書を作成
openssl req -new -x509 \
  -key obo-client.key \
  -out obo-client.crt \
  -days 365 \
  -subj "/CN=obo-client"

# Key Vaultに登録するPEMを作成 (PEMには証明書だけでなく秘密鍵も含める)
cat obo-client.crt obo-client.key > obo-client-combined.pem
```

#### 2. 証明書をアプリ登録にアップロードする

Downstream API用のアプリ登録を作成します。

(TBD)

作成したアプリ登録に公開証明書 (`obo-client.crt`) をアップロードします。

![](/docs/upload-cert.png)

#### 3. 秘密鍵をKey VaultにアップロードしFunctionsから参照できるようにする

以下のコマンドで、クライアントシークレット用のKey Vaultを作成します。

```bash
cd azure/

# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# Key Vault 作成
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/keyvault.bicep \
```

その後、Key Vault secretとしてPEMを登録します。

```bash
az keyvault secret set \
  --vault-name <KeyVaultName> \
  --name oboClientCertificateSecret \
  --file obo-client-combined.pem
```

Azure Portal から secret を手入力で登録する場合は、PEM の改行を維持したまま貼り付けてください。
改行が `\n` を含む1行文字列に変わると、実行時に証明書として読み取れないことがあります。
可能であれば `az keyvault secret set --file ...` で登録するほうが安全です。

Function App は Key Vault から secret 値を取得し、その内容を PEM ファイルとして保存して `OnBehalfOfCredential` に渡します。

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

### Key Vaultで証明書作成

作成したKey Vaultで証明書を登録します。

(画像TBD)

### Downstream API用アプリ登録に証明書を登録

```bash
az ad app credential reset \
  --id "$APP_ID" \
  --keyvault "$KV_NAME" \
  --cert "$CERT_NAME" \
  --append
```

### Azure Functionsのデプロイ

リソース作成後、Azure Functionsをビルドしデプロイしてください。

```bash
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

## デプロイ

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

---

# 背景・目的

- OIDC/OAuth2.0のトークンをブラウザに保存することは推奨されない
  - XSSによってトークンが詐取され、攻撃(アクセストークンの場合)や個人情報の流出(IDトークンの場合; トークンは暗号化されていない)につながる
- 一般的に、トークンをサーバ側に残し、ブラウザにはトークンではなくそれに紐づいているセッション(認証セッション)のIDを返す方式が取られることが多い
  - この文脈でBFFパターンの利用が検討されることがある: https://auth0.com/blog/jp-the-backend-for-frontend-pattern-bff/
- 認証セッション管理機能を提供するAzureのマネージドサービスについて調査する

# 要件

- SPAで構築したフロントエンドと、Web APIを提供するバックエンドサーバからなるシステムを前提とする
- 認証済ユーザーだけが後段のAPIを実行できること
- トークンではなくCookieベースで認証セッションを管理できること
- バックエンドサーバとは別のサービスで認証セッションを管理できること

# ソリューション

- EasyAuth (App Service/Functions)

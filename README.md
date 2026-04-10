# azure-easyauth-oauth2-proxy

OIDCやOAuth 2.0でSPAに認証・認可機能を実装する場合には、バックエンドサーバの導入によってセキュリティを高めることができる一方、構成や実装が複雑になるというトレードオフがあります。

このリポジトリでは、複雑さを軽減しつつセキュリティを確保するために、Azureのマネージドサービスを利用することで、認証セッション管理機能を簡便に実装する方法を提供します。

以下の要件・前提を満たす構成について検討しました。

- SPAで構築したフロントエンドと、Web APIを提供するバックエンドサーバからなるシステムを前提とする(以下、認証機能を実装するサービスの後段に配置するAPIをDownstream APIと呼びます)
- 認証済ユーザーだけがDownstream APIを実行できること
- トークンはサーバで管理し、Cookieベースで認証セッションを管理できること(SPAにトークンを置かないこと)
- 認証セッション管理はDownstream APIとできるだけ分離したサービスとして管理できること(任意のバックエンドサーバと統合できるようにするため)

## アーキテクチャ概要

本システムは、Azure Functionsが認証・認可のプロキシとして中心的な役割を果たす構成となっています。
各コンポーネントの詳細については [/azure/README.md](/azure/README.md) を参照してください。

![](/docs/concept.drawio.png)

### 認証

ユーザーがSPAでサインインを要求すると、Functionsが認証処理を実行します。認証にはAzure FunctionsとApp Serviceで提供されている組み込みの認証・認可機能である**Easy Auth**を利用しています。(参考: [Azure App Service および Azure Functions での認証と承認](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization))

Easy Authを有効化すると、専用のミドルウェアがIDプロバイダーと連携してトークンを取得し、[トークン ストア](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization#token-store)(組み込みのローカルファイルストレージ)に保存します。また、ブラウザに対してはトークンに紐づくCookieを発行することで、認証セッションを管理します。

![](https://learn.microsoft.com/ja-jp/azure/app-service/media/app-service-authentication-overview/architecture.png#lightbox)

### 委任アクセス

SPAからのAPI呼び出しもFunctionsが代理で実行しますが、そのためにはFunctionsでDownstream API用のアクセストークンを取得する必要があります。

Entra IDでは、アプリケーションがユーザーの代理としてDownstream APIを呼び出すための仕組みである[On-Behalf-Of (OBO) フロー](https://learn.microsoft.com/ja-jp/entra/identity-platform/v2-oauth2-on-behalf-of-flow)が提供されています。OBOフローを利用することで、ユーザーから受け取ったアクセストークンをユーザーの代理としての証明として使い、Downstream API向けの新しいアクセストークンを取得することができます。

そこで、FunctionsでOBOフローに基づくトークン交換を実施し、Cookieベースの認証セッション管理を維持しつつ、認証済みユーザーの代理として下流APIを呼び出す構成としました。

(\*認証済・未認証を単に区別するだけであれば、FunctionsのマネージドIDに対してアクセス許可を設定するだけで十分です。ただし、その場合はDownstream APIでユーザーの情報を取得することは難しくなります)

#### OBOフローの処理詳細

1. アプリケーション(今回の構成ではSPA)がバックエンド(Easy Authを有効化したAzure Functions)に対してリクエストを送る。このとき、ブラウザは保持しているCookie(Easy Authで発行されたもの; `AppServiceAuthSession`)を自動送信する
2. バックエンドはCookieに対応するセッションからユーザー由来のトークンを取得し、そのトークンを使って、Entra IDに対し下流API用のアクセストークンを要求する
3. Entra IDから下流API用のアクセストークンがバックエンドに渡される
4. 取得したアクセストークンを使って、バックエンドが下流APIを呼び出す

![](https://learn.microsoft.com/ja-jp/entra/identity-platform/media/v2-oauth2-on-behalf-of-flow/protocols-oauth-on-behalf-of-flow.png)

## デプロイ方法

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

### Azure Functionsのデプロイ

```bash
cd azure/functions
npm install
npm run build # ビルド
func azure functionapp publish <FunctionAppName> # デプロイ
```

### SPAのデプロイ

`az deployment` 実行後に出力される `functionAppUrl` と `spaStorageName` を使ってビルド済みファイルを配置します。

初回セットアップでは、`spa/.env.production.example` をコピーして `spa/.env.production` を作成し、Function App の URL を設定してください。

アップロードするためには以下のロールのいずれかが必要です。

- `Storage Blob Data Contributor`
- `Storage Blob Data Owner`

```bash
cd spa

# .env.production を編集して VITE_API_BASE_URL を設定
cp .env.production.example .env.production

npm install
npm run build # ビルド

# dist/ を $web コンテナへアップロード
az storage blob upload-batch \
  --account-name <spaStorageName> \
  --destination '$web' \
  --source dist \
  --auth-mode login \
  --overwrite
```

アップロード後、`spaStaticWebsiteUrl` でアプリケーションにアクセスできます。
![](/docs/spa.png)

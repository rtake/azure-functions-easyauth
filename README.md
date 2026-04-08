## 背景・目的

### SPAで認証・認可機能を実装する際のセキュリティリスク

- ブラウザのストレージ(localStorageやsessionStorage)に保存したデータはXSSで窃取される可能性がある。よって、OIDCやOAuth 2.0の認証・認可フローの中で発行されるトークンをブラウザに保存することにはセキュリティ上のリスクがある
- SPAでOIDC・OAuth 2.0に基づく認証機能を実装する場合、認証セッションを保持するためにブラウザのストレージにトークンを保存することになるが、上述したセキュリティリスクがある

### SPAのセキュアなデザインパターン

- バックエンドサーバがSPAの代わりにトークンを保持し、セッションIDを入れたCookieをSPAに送る、という方式が取られることがある ([BFFパターン](https://auth0.com/blog/jp-the-backend-for-frontend-pattern-bff/))。
- SPAがバックエンドサーバに対してリクエストを送信するときに、ブラウザに保持しているCookieを一緒に送信することで、バックエンドでセッションIDとトークンを突き合わせ、認証状態を検証することが可能になる
- SPAに送られたCookieはブラウザに保持されるが、CookieはXSS耐性があるためトークンに比べてリスクが小さい

### このリポジトリの目的

- このように、OIDC・OAuth 2.0による認証・認可機能を実装するSPAではバックエンドサーバの導入によってセキュリティを高めることができるが、その場合には構成や実装が複雑になるというトレードオフがある
- そこで、複雑さを軽減しつつセキュリティを確保する手段として、Azureのマネージドサービスを使い、認証セッション管理機能を簡便に実装する方法について調査し、ソースコードおよびIaCとして提供する

## 要件・前提

以下の要件・前提を満たす構成について調査する。

- SPAで構築したフロントエンドと、Web APIを提供するバックエンドサーバからなるシステムを前提とする
- 認証済ユーザーだけが後段のAPIを実行できること
- トークンではなくCookieベースで認証セッションを管理できること
- 認証セッション管理はバックエンドサーバと分離したサービスとして管理できること(任意のバックエンドサーバと統合できるようにするため)

## ソリューション概要

- Azure App ServiceとAzure Functionsでは組み込みの認証・認可(**Easy Auth**)が提供されており、これを有効化することで、OIDCフローにおけるIDプロバイダーとのプロセスや認可の処理、トークンの管理などを簡略化できる。そこで、**Easy Authを有効化したAzure Functionsを認証・認可プロキシとして使う構成**とする
- 一方で、Easy Authによって認証済みセッションを保持できても、それだけでは下流のAPIを「認証済みユーザーの代理」として呼び出すことはできない。下流のAPIに対しては、そのAPI向けに発行されたアクセストークンが別途必要となる
- よって、Easy Authを有効化したAzure Functionsで**OBOフローに基づくトークン交換**を実施し、Cookieベースの認証セッション管理を維持しつつ、認証済みユーザーの代理として下流APIを呼び出す構成とする

以下、ソリューションを構成する技術要素についての詳細について記載する。

### Easy Auth

- Easy Authを有効化すると、App Service/FunctionsをホストするVMの入り口に認証・認可を担うミドルウェアが起動する([Azure App Service および Azure Functions での認証と承認](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization))
- ミドルウェアによって取得されたトークンは[トークン ストア](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization#token-store)に格納され、トークンの取得・保存・更新などの実装負担を軽減できる

![](https://learn.microsoft.com/ja-jp/azure/app-service/media/app-service-authentication-overview/architecture.png#lightbox)

### On-Behalf-Ofフロー

- Entra IDで提供されている**On-Behalf-Of(OBO)フロー**では、バックエンドサーバが、ユーザーから受け取ったアクセストークンを「ユーザーの代理としての証明」として使い、下流のAPI向けの新しいアクセストークンを取得できる ([]())
- これにより、下流APIは「この呼び出しは、認証済みユーザーの代理として実行されている」と判断できる。つまり、誰の権限で実行された呼び出しかを扱いやすい

OBOフローにおける実際の処理は以下のようになる。

1. アプリケーション(今回の構成ではSPA)がバックエンド(Easy Authを有効化したAzure Functions)に対してリクエストを送る。このとき、ブラウザは保持しているCookie(Easy Authで発行されたもの; `AppServiceAuthSession`)を自動送信する
2. バックエンドはCookieに対応するセッションからユーザー由来のトークンを取得し、そのトークンを使って、Entra IDに対し下流API用のアクセストークンを要求する
3. Entra IDから下流API用のアクセストークンがバックエンドに渡される
4. 取得したアクセストークンを使って、バックエンドが下流APIを呼び出す

![](https://learn.microsoft.com/ja-jp/entra/identity-platform/media/v2-oauth2-on-behalf-of-flow/protocols-oauth-on-behalf-of-flow.png)

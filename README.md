## 背景

- OIDCのトークンをブラウザのlocalStorageやsessionStorageに保存すると、XSSによって攻撃者に取得されるリスクがあるため推奨されない
- 一方、ブラウザで動作するSPAはトークンを安全に保管することができず、したがって認証状態を保持することができない
- そこで、バックエンドサーバがSPAの代わりにトークンを保持し、セッションIDを入れたCookieをSPAに送る、という方式が取られることがある。SPAに送られたCookieはブラウザに保持されるが、CookieはXSS耐性があるためトークンに比べてリスクが小さい
  - この文脈でBFFパターンの利用が検討されることがある: https://auth0.com/blog/jp-the-backend-for-frontend-pattern-bff/
- SPAがバックエンドサーバに対してリクエストを送信するときに、ブラウザに保持しているCookieを一緒に送信することで、バックエンドでセッションIDとトークンを突き合わせ、認証状態を検証することが可能になる

## 目的

- SPAにOIDC認証を実装する際、バックエンドサーバの導入によってセキュリティを高めることができるが、その場合は構成や実装が複雑になるというトレードオフがある
- そこで、複雑さを軽減しつつセキュリティを確保する手段として、Azureのマネージドサービスを使い、認証セッション管理機能を簡便に実装する方法について調査した

## 要件

- SPAで構築したフロントエンドと、Web APIを提供するバックエンドサーバからなるシステムを前提とする
- 認証済ユーザーだけが後段のAPIを実行できること
- トークンではなくCookieベースで認証セッションを管理できること
- 認証セッション管理はバックエンドサーバと分離したサービスとして管理できること(任意のバックエンドサーバと統合できるようにするため)

## ソリューション

### Easy Auth

- App ServiceとAzure Functionsでは組み込みの認証・認可(**Easy Auth**)が提供されている
- Easy Authを有効化すると、App Service/FunctionsをホストするVMの入り口に認証・認可を担うミドルウェアが起動する([Azure App Service および Azure Functions での認証と承認](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization))
- ミドルウェアによって取得されたトークンは[トークン ストア](https://learn.microsoft.com/ja-jp/azure/app-service/overview-authentication-authorization#token-store)に格納される
  ![](https://learn.microsoft.com/ja-jp/azure/app-service/media/app-service-authentication-overview/architecture.png#lightbox)
- **Easy Authを有効化することで、トークンの取得・保存・更新などの実装負担を軽減できる**

### On-Behalf-Ofフロー

- Easy Authで認証したユーザーが下流のAPIを実行するためには、ユーザーの認証・認可の情報を下流のAPIに流す必要がある
- Entra IDで提供されている**On-Behalf-Of(OBO)フロー**では、バックエンドサーバが、ユーザーから受け取ったアクセストークンを「ユーザーの代理としての証明」として使い、下流のAPI向けの新しいアクセストークンを取得できる
- このとき、元のトークンをそのまま下流APIに渡すのではなく、バックエンドがEntra IDに対してトークン交換を行う
- これにより、下流APIは「この呼び出しは、認証済みユーザーの代理として実行されている」と判断できる
- SPAはトークンを保持し続ける必要がなく、認証セッションはCookieで維持しつつ、API呼び出しに必要なトークン処理はバックエンド側に閉じ込めることができる

#### OBOフローの詳細

- SPAがバックエンドに対してリクエストを送る
- ブラウザはCookieを自動送信する
- バックエンドはCookieに対応するセッションから、ユーザー由来のトークンを取得する
- バックエンドはそのトークンを使って、Entra IDに対し下流API用のアクセストークンを要求する
- 取得したアクセストークンを使って、バックエンドが下流APIを呼び出す

![](https://learn.microsoft.com/ja-jp/entra/identity-platform/media/v2-oauth2-on-behalf-of-flow/protocols-oauth-on-behalf-of-flow.png)

![alt text](image.png)

#### OBOフローを使う利点

- SPAにアクセストークンを保持させずに済む
- バックエンドから下流APIへのアクセスを、ユーザー単位で委譲できる
- 下流API側で、誰の権限で実行された呼び出しかを扱いやすい
- Easy Authと組み合わせることで、認証セッション管理とトークン交換処理を比較的少ない実装で実現できる

### ソリューションのまとめ

- Easy Authは「認証セッションの保持」を簡単にし、OBOフローは「その認証済みユーザーの代理として下流APIを呼ぶ」ための仕組みである
- したがって、SPA + バックエンド + 下流API という構成において、Cookieベースのセッション管理とユーザー委譲型のAPI呼び出しを両立したい場合に、両者の組み合わせは有力な選択肢となる

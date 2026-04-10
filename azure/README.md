## Azure Functions

### Easy Auth

- Azure FunctionsでEasy Authを有効化するには、Easy Auth用アプリ登録がFunctionsを信頼できるように構成する必要があります。そこで、Easy Auth用のアプリ登録のフェデレーション資格情報としてAzure Functionsに割り当てたマネージドIDを登録しています
  - [Easily add login to your Azure app with Bicep](https://techcommunity.microsoft.com/blog/azuredevcommunityblog/easily-add-login-to-your-azure-app-with-bicep/4386493)
- [Microsoft Learn](https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-oauth-tokens) には _アクセストークンを利用するにはクライアントシークレットで認証する必要がある_ と記載がありましたが、アプリ登録でマネージドID認証が利用可能になったことに伴い、マネージドID認証でもトークン取得が可能になったようです
  - [シークレットの代わりにマネージド ID を使用する (プレビュー)](https://learn.microsoft.com/ja-jp/azure/app-service/configure-authentication-provider-aad?tabs=workforce-configuration#use-a-managed-identity-instead-of-a-secret-preview)

### OBOフロー

- OBOフローは `@azure/msal-node` の `acquireTokenOnBehalfOf` で実装しています ([SDK reference](https://learn.microsoft.com/ja-jp/javascript/api/@azure/msal-node/confidentialclientapplication?view=msal-js-latest#@azure-msal-node-confidentialclientapplication-acquiretokenonbehalfof))
- Downstream API用のアプリ登録のフェデレーション資格情報としてAzure Functionsに割り当てたマネージドIDを登録しています。これによって、FunctionsはEntra IDに対してトークン交換の認証を行い、Easy Authで取得したアクセストークンをDownstream APIと交換することができます (参考: [Create on behalf of token using managed identity](https://learn.microsoft.com/en-us/answers/questions/2113573/create-on-behalf-of-token-using-managed-identity#:~:text=Hi%20%40Ketan%20Joshi%20%2C%20welcome,assigned%20managed%20identity))

## SPA (Static Web Apps)

(TBD)

## 認証フロー

- SPAは `https://<function-app>.azurewebsites.net/.auth/login/aad?post_login_redirect_uri=<SPA URL>` に遷移してサインイン
- Easy AuthはFunctionsのドメインにCookie(`AppServiceAuthSession`)を保存
- SPAは `fetch("https://<function-app>/api/profile", { credentials: "include" })` でAPIを呼び出し
- Functionsは `/.auth/me` からトークンを取得し、OBOでMicrosoft Graph用アクセストークンを取得し、Graph APIを呼び出し

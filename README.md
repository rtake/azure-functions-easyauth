```
# リソースグループ作成
az group create \
  --name <ResourceGroupName> \
  -l <RegionName>

# リソース作成
cd azure/
az deployment group create \
  --resource-group <ResourceGroupName> \
  --template-file infra/main.bicep \
  -p infra/param.bicepparam
```

デプロイ前に構成の変更をレビューしたい場合は以下のDry-run用コマンドを実行してください。

```
cd azure/
az deployment group what-if \
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

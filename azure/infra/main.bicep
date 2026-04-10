extension microsoftGraphV1

param location string = resourceGroup().location

@description('Function runtime')
param runtime string = 'node'

@description('Runtime version')
param runtimeVersion string = '20'

var resourceToken = take(toLower(uniqueString(resourceGroup().id, location)), 6)
var ownerObjectId = deployer().objectId
var tenantId = subscription().tenantId

// Function AppがEntra IDに対してトークン交換や認証を行うためのアイデンティティ
resource functionAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'uami-func-${resourceToken}'
  location: location
}

// APIアプリケーション (Entra IDアプリ登録)
module apiApp './modules/api-app-registration.bicep' = {
  name: 'apiAppRegistration'
  params: {
    resourceToken: resourceToken
    ownerObjectId: ownerObjectId
    tenantId: tenantId
    functionAppIdentityId: functionAppIdentity.id
  }
}

// EasyAuthのクライアントアプリケーション (Entra IDアプリ登録)
module easyAuthApp './modules/easyauth-app-registration.bicep' = {
  name: 'easyAuthAppRegistration'
  params: {
    resourceToken: resourceToken
    ownerObjectId: ownerObjectId
    tenantId: tenantId
    functionAppPrincipalId: functionAppIdentity.id
    apiAppId: apiApp.outputs.appId
    userImpersonationScopeId: apiApp.outputs.userImpersonationScopeId
  }
}

resource easyAuthAdminConsent 'Microsoft.Graph/oauth2PermissionGrants@v1.0' = {
  clientId: easyAuthApp.outputs.servicePrincipalId
  consentType: 'AllPrincipals'
  resourceId: apiApp.outputs.servicePrincipalId
  scope: 'user_impersonation'
}

module storageAccount './modules/storage-account.bicep' = {
  name: 'storageAccount'
  params: {
    location: location
    storageName: 'storage${resourceToken}'
  }
}

var spaStaticWebsiteUrl = storageAccount.outputs.staticWebsiteUrl
// Remove trailing slash if exists for consistent CORS origin configuration
var spaStaticWebsiteOrigin = endsWith(spaStaticWebsiteUrl, '/')
  ? substring(spaStaticWebsiteUrl, 0, max(length(spaStaticWebsiteUrl) - 1, 0))
  : spaStaticWebsiteUrl

module functionApp './modules/function-app.bicep' = {
  name: 'functionApp'
  params: {
    location: location
    resourceToken: resourceToken
    runtime: runtime
    runtimeVersion: runtimeVersion
    tenantId: tenantId
    easyAuthClientId: easyAuthApp.outputs.appId
    oboClientId: apiApp.outputs.appId
    audience: apiApp.outputs.audience
    storageConnectionString: storageAccount.outputs.storageConnectionString
    identityId: functionAppIdentity.id
    allowedOrigins: [
      spaStaticWebsiteOrigin // CORS for API calls from the SPA static website
    ]
    allowedExternalRedirectUrls: [
      spaStaticWebsiteOrigin
      spaStaticWebsiteUrl
    ]
  }
}

output spaStaticWebsiteUrl string = spaStaticWebsiteUrl
output spaStorageName string = storageAccount.outputs.storageName
output functionAppUrl string = 'https://${functionApp.name}.azurewebsites.net'

extension microsoftGraphV1

param location string = resourceGroup().location

@description('Function runtime')
param runtime string = 'node'

@description('Runtime version')
param runtimeVersion string = '20'

var resourceToken = take(toLower(uniqueString(resourceGroup().id, location)), 6)
var ownerObjectId = deployer().objectId
var tenantId = subscription().tenantId

// For downstream API
var apiApplicationUniqueName = 'api-${resourceToken}'
var apiApplicationDisplayName = 'API ${resourceToken}'
var userImpersonationScopeId = guid(apiApplicationUniqueName, 'user_impersonation')
var audience = 'api://${apiApplicationUniqueName}'

var microsoftGraphAppId = '00000003-0000-0000-c000-000000000000'
var microsoftGraphUserReadScopeId = 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'

resource apiAppRegistration 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: apiApplicationUniqueName
  displayName: apiApplicationDisplayName
  signInAudience: 'AzureADMyOrg'
  identifierUris: [
    audience
  ]
  api: {
    requestedAccessTokenVersion: 2
    oauth2PermissionScopes: [
      {
        id: userImpersonationScopeId
        adminConsentDisplayName: 'Access ${apiApplicationDisplayName}'
        adminConsentDescription: 'Allows the application to access ${apiApplicationDisplayName} on behalf of the signed-in user.'
        userConsentDisplayName: 'Access ${apiApplicationDisplayName}'
        userConsentDescription: 'Allows the application to access ${apiApplicationDisplayName} on your behalf.'
        isEnabled: true
        type: 'User'
        value: 'user_impersonation'
      }
    ]
  }
  requiredResourceAccess: [
    {
      resourceAppId: microsoftGraphAppId
      resourceAccess: [
        {
          id: microsoftGraphUserReadScopeId
          type: 'Scope'
        }
      ]
    }
  ]
  owners: {
    relationshipSemantics: 'append'
    relationships: empty(ownerObjectId)
      ? []
      : [
          ownerObjectId
        ]
  }
  resource clientAppFic 'federatedIdentityCredentials@v1.0' = {
    name: '${apiAppRegistration.uniqueName}/miAsFicForObo'
    audiences: [
      'api://AzureADTokenExchange'
    ]
    subject: functionApp.outputs.functionPrincipalId
    issuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
    // issuer: 'https://login.microsoftonline.com/${tenantId}/v2.0'
  }
}

resource apiServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: apiAppRegistration.appId
}

resource microsoftGraphServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' existing = {
  appId: microsoftGraphAppId
}

resource apiToMicrosoftGraphAdminConsent 'Microsoft.Graph/oauth2PermissionGrants@v1.0' = {
  clientId: apiServicePrincipal.id
  consentType: 'AllPrincipals'
  resourceId: microsoftGraphServicePrincipal.id
  scope: 'User.Read'
}

// For Easy Auth on the Function app
var easyAuthApplicationUniqueName = 'web-${resourceToken}'
var easyAuthApplicationDisplayName = 'Web ${resourceToken}'
var functionAppAuthCallbackUrl = 'https://func-${resourceToken}.azurewebsites.net/.auth/login/aad/callback'

resource easyAuthAppRegistration 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: easyAuthApplicationUniqueName
  displayName: easyAuthApplicationDisplayName
  signInAudience: 'AzureADMyOrg'
  web: {
    redirectUris: [
      functionAppAuthCallbackUrl
    ]
    implicitGrantSettings: {
      enableIdTokenIssuance: true
      enableAccessTokenIssuance: false
    }
  }
  owners: {
    relationshipSemantics: 'append'
    relationships: empty(ownerObjectId)
      ? []
      : [
          ownerObjectId
        ]
  }
  requiredResourceAccess: [
    {
      resourceAppId: apiAppRegistration.appId
      resourceAccess: [
        {
          id: userImpersonationScopeId
          type: 'Scope'
        }
      ]
    }
  ]
  resource clientAppFic 'federatedIdentityCredentials@v1.0' = {
    name: '${easyAuthAppRegistration.uniqueName}/miAsFic'
    audiences: [
      'api://AzureADTokenExchange'
    ]
    subject: functionApp.outputs.functionPrincipalId
    issuer: '${environment().authentication.loginEndpoint}${tenant().tenantId}/v2.0'
    // issuer: 'https://login.microsoftonline.com/${tenantId}/v2.0'
  }
}

resource easyAuthServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: easyAuthAppRegistration.appId
}

resource easyAuthAdminConsent 'Microsoft.Graph/oauth2PermissionGrants@v1.0' = {
  clientId: easyAuthServicePrincipal.id
  consentType: 'AllPrincipals'
  resourceId: apiServicePrincipal.id
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
    easyAuthClientId: easyAuthAppRegistration.appId
    oboClientId: apiAppRegistration.appId
    audience: audience
    storageConnectionString: storageAccount.outputs.storageConnectionString
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
output functionAppName string = functionApp.outputs.functionName
output functionAppUrl string = 'https://${functionApp.outputs.functionDefaultHostname}'
output easyAuthLoginBaseUrl string = 'https://${functionApp.outputs.functionDefaultHostname}/.auth/login/aad'

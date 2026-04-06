extension microsoftGraphV1

param location string = resourceGroup().location

@description('Function runtime')
@allowed([
  'node'
  'python'
  'dotnet-isolated'
])
param runtime string = 'node'

@description('Runtime version')
param runtimeVersion string = '20'

@description('Client secret of the API app registration used by the Function app for OBO token exchange.')
@secure()
param oboClientSecret string

var resourceToken = take(toLower(uniqueString(resourceGroup().id, location)), 6)

var tenantId = subscription().tenantId
var ownerObjectId = deployer().objectId
var apiApplicationUniqueName = 'api-${resourceToken}'
var apiApplicationDisplayName = 'API ${resourceToken}'
var easyAuthApplicationUniqueName = 'web-${resourceToken}'
var easyAuthApplicationDisplayName = 'Web ${resourceToken}'
var audience = 'api://${apiApplicationUniqueName}'
var functionAppName = 'func-${resourceToken}'
var functionAppAuthCallbackUrl = 'https://${functionAppName}.azurewebsites.net/.auth/login/aad/callback'
var userImpersonationScopeId = guid(apiApplicationUniqueName, 'user_impersonation')
var microsoftGraphAppId = '00000003-0000-0000-c000-000000000000'
var microsoftGraphUserReadScopeId = 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'

// For downstream API
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
}

resource apiServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: apiAppRegistration.appId
}

// For Easy Auth on the Function app
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
    oboClientSecret: oboClientSecret
    storageConnectionString: storageAccount.outputs.storageConnectionString
  }
}

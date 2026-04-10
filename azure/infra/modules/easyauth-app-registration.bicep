extension microsoftGraphV1

param resourceToken string
param ownerObjectId string
param tenantId string
param functionAppPrincipalId string
param apiAppId string
param userImpersonationScopeId string

var easyAuthApplicationUniqueName = 'easyauth-${resourceToken}'
var easyAuthApplicationDisplayName = 'Easy Auth ${resourceToken}'
var functionAppAuthCallbackUrl = 'https://func-${resourceToken}.azurewebsites.net/.auth/login/aad/callback'

resource functionAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: last(split(functionAppPrincipalId, '/'))
}

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
      resourceAppId: apiAppId
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
    subject: functionAppIdentity.properties.principalId
    issuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
  }
}

resource easyAuthServicePrincipal 'Microsoft.Graph/servicePrincipals@v1.0' = {
  appId: easyAuthAppRegistration.appId
}

output appId string = easyAuthAppRegistration.appId
output servicePrincipalId string = easyAuthServicePrincipal.id

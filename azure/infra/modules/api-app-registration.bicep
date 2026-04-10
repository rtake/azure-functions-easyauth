extension microsoftGraphV1

param resourceToken string
param ownerObjectId string
param tenantId string
param functionAppIdentityId string

var apiApplicationUniqueName = 'backendapi-${resourceToken}'
var apiApplicationDisplayName = 'Backend API ${resourceToken}'
var userImpersonationScopeId = guid(apiApplicationUniqueName, 'user_impersonation')
var audience = 'api://${apiApplicationUniqueName}'

var microsoftGraphAppId = '00000003-0000-0000-c000-000000000000'
var microsoftGraphUserReadScopeId = 'e1fe6dd8-ba31-4d61-89e7-88639da4683d'

resource functionAppIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: last(split(functionAppIdentityId, '/'))
}

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
    subject: functionAppIdentity.properties.principalId
    issuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
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

output appId string = apiAppRegistration.appId
output servicePrincipalId string = apiServicePrincipal.id
output userImpersonationScopeId string = userImpersonationScopeId
output audience string = audience

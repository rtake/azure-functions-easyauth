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

var resourceToken = take(toLower(uniqueString(resourceGroup().id, location)), 6)

var tenantId = subscription().tenantId
var ownerObjectId = deployer().objectId
var applicationUniqueName = 'app-${resourceToken}'
var applicationDisplayName = 'App ${resourceToken}'
var audience = 'api://${applicationUniqueName}'

resource appRegistration 'Microsoft.Graph/applications@v1.0' = {
  uniqueName: applicationUniqueName
  displayName: applicationDisplayName
  signInAudience: 'AzureADMyOrg'
  identifierUris: [
    audience
  ]
  api: {
    requestedAccessTokenVersion: 2
  }
  owners: {
    relationshipSemantics: 'append'
    relationships: empty(ownerObjectId)
      ? []
      : [
          ownerObjectId
        ]
  }
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
    clientId: appRegistration.appId
    audience: audience
    storageConnectionString: storageAccount.outputs.storageConnectionString
  }
}

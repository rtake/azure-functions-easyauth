param location string = resourceGroup().location

@description('Object ID that should be allowed to manage secrets in the Key Vault.')
param keyVaultAdminObjectId string = deployer().objectId

var resourceToken = take(toLower(uniqueString(resourceGroup().id, location)), 6)
var keyVaultName = 'kv-${resourceToken}'
var tenantId = subscription().tenantId

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: keyVaultName
  location: location
  properties: {
    tenantId: tenantId
    sku: {
      family: 'A'
      name: 'standard'
    }
    enableRbacAuthorization: false
    enabledForDeployment: false
    enabledForDiskEncryption: false
    enabledForTemplateDeployment: false
    accessPolicies: empty(keyVaultAdminObjectId)
      ? []
      : [
          {
            tenantId: tenantId
            objectId: keyVaultAdminObjectId
            permissions: {
              secrets: [
                'get'
                'list'
                'set'
                'delete'
                'recover'
                'backup'
                'restore'
                'purge'
              ]
            }
          }
        ]
    publicNetworkAccess: 'Enabled'
  }
}

output keyVaultName string = keyVault.name
output keyVaultUri string = keyVault.properties.vaultUri

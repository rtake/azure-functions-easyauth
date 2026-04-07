param location string
param storageName string

var storageConnectionString = 'DefaultEndpointsProtocol=https;AccountName=${storage.name};EndpointSuffix=${environment().suffixes.storage};AccountKey=${storage.listKeys().keys[0].value}'

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: {
    name: 'Standard_LRS'
  }
  kind: 'StorageV2'
  properties: {
    minimumTlsVersion: 'TLS1_2'
    allowBlobPublicAccess: false
  }
}

resource staticWebsite 'Microsoft.Storage/storageAccounts/blobServices@2025-08-01' = {
  parent: storage
  name: 'default'
  properties: any({
    staticWebsite: {
      enabled: true
      indexDocument: 'index.html'
      error404Document: 'index.html'
    }
  })
}

output storageConnectionString string = storageConnectionString
output staticWebsiteUrl string = storage.properties.primaryEndpoints.web
output storageName string = storage.name

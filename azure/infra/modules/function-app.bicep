param location string
param resourceToken string
param runtime string
param runtimeVersion string
param tenantId string
param easyAuthClientId string
param oboClientId string
param audience string
@secure()
param oboClientSecret string
param storageConnectionString string

var planName = 'plan-${resourceToken}'
var functionName = 'func-${resourceToken}'
var appInsightsName = 'appi-${resourceToken}'

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: appInsightsName
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
  }
}

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: planName
  location: location
  sku: {
    tier: 'Consumption'
    name: 'Y1'
  }
  kind: 'functionapp'
  properties: {
    reserved: true
  }
}

resource functionApp 'Microsoft.Web/sites@2024-04-01' = {
  name: functionName
  location: location
  kind: 'functionapp,linux'
  identity: {
    type: 'SystemAssigned'
  }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    siteConfig: {
      linuxFxVersion: '${runtime}|${runtimeVersion}'
      minTlsVersion: '1.2'
    }
  }

  resource appsettings 'config' = {
    name: 'appsettings'
    properties: {
      AzureWebJobsStorage: storageConnectionString
      FUNCTIONS_WORKER_RUNTIME: runtime
      FUNCTIONS_EXTENSION_VERSION: '~4'
      APPLICATIONINSIGHTS_CONNECTION_STRING: appInsights.properties.ConnectionString
      OBO_TENANT_ID: tenantId
      OBO_CLIENT_ID: oboClientId
      OBO_CLIENT_SECRET: oboClientSecret
      GRAPH_SCOPE: 'https://graph.microsoft.com/User.Read'
      GRAPH_ENDPOINT: 'https://graph.microsoft.com/v1.0/me'
      WEBSITE_RUN_FROM_PACKAGE: '1'
    }
  }
}

resource auth 'Microsoft.Web/sites/config@2022-09-01' = {
  parent: functionApp
  name: 'authsettingsV2'
  properties: {
    globalValidation: {
      requireAuthentication: true
      unauthenticatedClientAction: 'RedirectToLoginPage'
    }
    identityProviders: {
      azureActiveDirectory: {
        enabled: true
        registration: {
          clientId: easyAuthClientId
          openIdIssuer: '${environment().authentication.loginEndpoint}${tenantId}/v2.0'
        }
        login: {
          loginParameters: [
            'scope=openid profile email offline_access ${audience}/user_impersonation'
          ]
        }
        validation: {
          allowedAudiences: [
            audience
          ]
        }
      }
    }
    login: {
      tokenStore: {
        enabled: true
      }
    }
  }
}

output functionName string = functionApp.name
output functionPrincipalId string = functionApp.identity.principalId

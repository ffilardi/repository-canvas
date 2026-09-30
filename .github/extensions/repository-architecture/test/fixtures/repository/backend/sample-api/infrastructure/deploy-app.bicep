param environmentName string
param domain string
param appName string = 'sampleapi'
param appInsightsName string
param keyVaultName string
param serviceBusName string

var envName = toLower(environmentName)

resource appInsights 'Microsoft.Insights/components@2020-02-02' existing = {
  name: appInsightsName
}

module containerApp './container-app.module.bicep' = {
  name: 'container-app'
  params: {
    containerAppName: 'ctap${appName}${domain}${environmentName}'
  }
}

module productionWorker './container-app.module.bicep' = if (envName == 'prd') {
  name: 'production-worker'
  params: {
    containerAppName: 'ctapworker${domain}${environmentName}'
  }
}

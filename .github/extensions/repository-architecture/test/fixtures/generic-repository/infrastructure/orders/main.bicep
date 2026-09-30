param containerAppName string
resource app 'Microsoft.App/containerApps@2023-05-01' = {
  name: containerAppName
}

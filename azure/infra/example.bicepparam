using './main.bicep'

param easyAuthClientSecret = ''
param oboClientCertificateKeyVaultResourceGroupName = '<existing-key-vault-resource-group-name>'
param oboClientCertificateSecretUri = 'https://<existing-key-vault-name>.vault.azure.net/secrets/oboClientCertificateSecret'

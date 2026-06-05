import {
  SecretsManagerClient,
  GetSecretValueCommand
} from "@aws-sdk/client-secrets-manager"

import {
  createLogger,
  createChildLogger,
  serializeError
} from "@api-hub/logger"

const baseLogger = createLogger({
  service: "sso-integration",
  redactPII: true
})

const logger = createChildLogger(baseLogger, {
  component: "SecretsService"
})

const SERVICE_TOKEN_SECRET_ID = process.env.SERVICE_TOKEN_SECRET_ID
if (!SERVICE_TOKEN_SECRET_ID) {
  throw new Error("Missing required env var: SERVICE_TOKEN_SECRET_ID")
}

/**
 * AWS Secrets Manager Client
 */
const secretsClient = new SecretsManagerClient({
  region: "us-east-1"
})

/**
 * Cached secret to avoid repeated AWS calls
 */
let cachedSecret: string | null = null

/**
 * Track ongoing fetch to avoid duplicate requests
 */
let loadingPromise: Promise<string> | null = null

/**
 * Fetch service token secret from Secrets Manager
 */
async function fetchSecret(): Promise<string> {
  try {
    logger.info({
      event: "fetching_secret_from_secrets_manager"
    })

    const command = new GetSecretValueCommand({
      SecretId: SERVICE_TOKEN_SECRET_ID
    })

    const response = await secretsClient.send(command)

    if (!response.SecretString) {
      throw new Error("SecretString is empty")
    }

    /**
     * Secret can be JSON or plain string
     */
    let secretValue: string

    try {
      const parsed = JSON.parse(response.SecretString)

      secretValue =
        parsed.service_token_secret ||
        parsed.SERVICE_TOKEN_SECRET ||
        parsed.secret ||
        ""

      if (!secretValue) {
        throw new Error("service_token_secret not found in secret JSON")
      }
    } catch {
      /**
       * Secret stored as plain string
       */
      secretValue = response.SecretString
    }

    logger.info({
      event: "secret_loaded_successfully"
    })

    return secretValue
  } catch (error) {
    logger.error({
      event: "secret_fetch_failed",
      err: serializeError(error)
    })

    throw error
  }
}

/**
 * Public method used by services
 */
export async function getServiceTokenSecret(): Promise<string> {

  /**
   * Return cached value if available
   */
  if (cachedSecret) {
    return cachedSecret
  }

  /**
   * Prevent parallel AWS calls
   */
  if (!loadingPromise) {
    loadingPromise = fetchSecret()
  }

  cachedSecret = await loadingPromise

  return cachedSecret
}
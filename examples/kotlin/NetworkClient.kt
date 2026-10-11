package com.example.network

/**
 * Status of network response.
 */
enum class NetworkStatus {
    SUCCESS,
    ERROR,
    PENDING,
    TIMEOUT
}

/**
 * Network client demonstrating suspend functions, when expression, and null safety.
 */
class NetworkClient(val baseUrl: String, val timeoutMs: Long = 5000) {

    suspend fun executeRequest(endpoint: String, token: String?): String {
        val authHeader = token ?: "Bearer anonymous"
        return "Response from $baseUrl$endpoint with $authHeader"
    }

    fun describeStatus(status: NetworkStatus): String {
        return when (status) {
            NetworkStatus.SUCCESS -> "Request completed successfully"
            NetworkStatus.ERROR -> "Request failed with error"
            NetworkStatus.PENDING -> "Request is still in progress"
            NetworkStatus.TIMEOUT -> "Request timed out"
        }
    }

    fun parsePayload(payload: String?): String {
        val safePayload = payload?.trim() ?: "empty"
        return safePayload
    }
}

package com.aice.golden

data class Request(val id: String, val retries: Int)

class Handler(private val prefix: String) {
    fun handle(req: Request): String {
        return "$prefix:${req.id}:${req.retries}"
    }
}

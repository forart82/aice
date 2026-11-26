package com.aice.sync

interface SyncTransport {
    fun pushBatch(records: List<MutationRecord>): Long
}

class SyncViewModel(private val transport: SyncTransport) {
    private var state: SyncState = SyncState()

    fun currentState(): SyncState = state

    fun enqueueMutation(record: MutationRecord) {
        if (record.id.isBlank()) {
            state = reduceSyncState(state, SyncAction.MarkFailure("Mutation id must not be blank", false))
            return
        }
        state = reduceSyncState(state, SyncAction.Enqueue(record))
    }

    fun flushPending(): SyncState {
        if (state.queue.isEmpty()) {
            state = reduceSyncState(state, SyncAction.StartSync)
            return state
        }
        state = reduceSyncState(state, SyncAction.StartSync)
        return try {
            val rev = transport.pushBatch(state.queue)
            val ids = state.queue.map { it.id }.toSet()
            state = reduceSyncState(state, SyncAction.MarkSuccess(rev, ids))
            state
        } catch (err: IllegalStateException) {
            state = reduceSyncState(
                state,
                SyncAction.MarkFailure(err.message ?: "Transient sync conflict", true),
            )
            state
        } catch (err: IllegalArgumentException) {
            state = reduceSyncState(
                state,
                SyncAction.MarkFailure(err.message ?: "Invalid mutation payload", false),
            )
            state
        }
    }

    fun pendingCount(): Int = state.queue.size

    fun clearFailedBanner() {
        if (state.errorBanner != null) {
            state = state.copy(errorBanner = null, phase = SyncPhase.Idle)
        }
    }

    fun dropMutation(id: String): Boolean {
        val before = state.queue.size
        val remaining = state.queue.filterNot { it.id == id }
        if (remaining.size == before) {
            return false
        }
        state = state.copy(queue = remaining)
        return true
    }

    fun hasPendingForEntity(entityType: String): Boolean {
        return state.queue.any { it.entityType == entityType }
    }
}

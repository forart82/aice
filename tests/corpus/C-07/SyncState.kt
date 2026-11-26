package com.aice.sync

sealed class SyncPhase {
    object Idle : SyncPhase()
    data class Syncing(val pendingCount: Int) : SyncPhase()
    data class Complete(val syncedCount: Int, val revision: Long) : SyncPhase()
    data class Failed(val reason: String, val retryable: Boolean) : SyncPhase()
}

data class MutationRecord(
    val id: String,
    val entityType: String,
    val payloadJson: String,
    val version: Long,
    val createdAtMs: Long,
)

data class SyncState(
    val phase: SyncPhase = SyncPhase.Idle,
    val queue: List<MutationRecord> = emptyList(),
    val lastSyncedRevision: Long = 0L,
    val errorBanner: String? = null,
)

sealed class SyncAction {
    data class Enqueue(val record: MutationRecord) : SyncAction()
    object StartSync : SyncAction()
    data class MarkSuccess(val revision: Long, val clearedIds: Set<String>) : SyncAction()
    data class MarkFailure(val reason: String, val retryable: Boolean) : SyncAction()
}

fun reduceSyncState(state: SyncState, action: SyncAction): SyncState {
    return when (action) {
        is SyncAction.Enqueue -> {
            val updated = state.queue.filterNot { it.id == action.record.id } + action.record
            state.copy(queue = updated, errorBanner = null)
        }
        is SyncAction.StartSync -> {
            if (state.queue.isEmpty()) {
                state.copy(phase = SyncPhase.Complete(0, state.lastSyncedRevision))
            } else {
                state.copy(phase = SyncPhase.Syncing(state.queue.size), errorBanner = null)
            }
        }
        is SyncAction.MarkSuccess -> {
            val remaining = state.queue.filterNot { action.clearedIds.contains(it.id) }
            state.copy(
                phase = SyncPhase.Complete(action.clearedIds.size, action.revision),
                queue = remaining,
                lastSyncedRevision = action.revision,
                errorBanner = null,
            )
        }
        is SyncAction.MarkFailure -> {
            state.copy(
                phase = SyncPhase.Failed(action.reason, action.retryable),
                errorBanner = action.reason,
            )
        }
    }
}

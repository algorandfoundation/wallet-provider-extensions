package co.algorand.digitalcredentials

import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Deferred

/**
 * Process-wide rendezvous between [GetCredentialActivity] (which the platform
 * launches to fulfill a Digital Credentials request) and the JS layer that
 * actually builds the presentation.
 *
 * The activity [publish]es an event and awaits the returned [Deferred]; the JS
 * layer resolves it through [complete] or [abort]. Events published before JS
 * subscribes are queued and flushed as soon as a listener attaches, which
 * covers the "activity started before the RN runtime finished booting" case.
 * It does **not** cover a cold process where JS never attaches a listener at
 * all — then the activity's timeout aborts the flow (see the activity KDoc).
 */
object PresentationRequestBroker {
  /** Outcome of a routed request, produced by the JS layer. */
  sealed interface Result {
    /** The protocol response JSON to hand back to the platform. */
    data class Success(val responseJson: String) : Result

    /** A human-readable failure reason. */
    data class Failure(val message: String) : Result
  }

  /** The event shape mirrored by the JS `PresentationRequestEvent` type. */
  data class Event(
    val requestId: String,
    val protocol: String,
    val dataJson: String,
    val origin: String?,
    val selectedEntryId: String?,
  )

  private val pending = ConcurrentHashMap<String, CompletableDeferred<Result>>()
  private val queued = ArrayDeque<Event>()

  @Volatile
  private var listener: ((Event) -> Unit)? = null

  /**
   * Registers the event [listener] (the RN module) and flushes anything that
   * was published while nobody was listening.
   */
  fun setListener(listener: (Event) -> Unit) {
    this.listener = listener
    val flushed = synchronized(queued) {
      val events = queued.toList()
      queued.clear()
      events
    }
    flushed.forEach(listener)
  }

  /** Detaches the current listener; later events are queued again. */
  fun clearListener() {
    listener = null
  }

  /**
   * Publishes [event] to the JS layer (queueing it when no listener is
   * attached yet).
   *
   * @return the deferred outcome, resolved by [complete] or [abort].
   */
  fun publish(event: Event): Deferred<Result> {
    val deferred = CompletableDeferred<Result>()
    pending[event.requestId] = deferred
    val current = listener
    if (current == null) {
      synchronized(queued) { queued.addLast(event) }
    } else {
      current(event)
    }
    return deferred
  }

  /** Resolves the flow identified by [requestId] with [responseJson]. */
  fun complete(requestId: String, responseJson: String) {
    pending.remove(requestId)?.complete(Result.Success(responseJson))
  }

  /** Fails the flow identified by [requestId] with [message]. */
  fun abort(requestId: String, message: String) {
    pending.remove(requestId)?.complete(Result.Failure(message))
  }

  /** Drops any bookkeeping for [requestId] (the activity is going away). */
  fun forget(requestId: String) {
    pending.remove(requestId)
  }
}

from typing import Any, Optional, Union, TypedDict

from .data_pipeline_models import Dimension, MetricPoint, SensorReading, DeviceMetadata, LogRecord, SpanContext, BatchMetadata, AggregationBucket, TimeSeriesSummary, AnomalyThreshold, AlertRule, SinkConfig, PipelineCheckpoint, RetryPolicy, ThroughputStats, SinkHealthRecord, DeadLetterRecord, createDimension, createMetricPoint, formatMetricKey, parseLogLevel, sanitizeLogMessage, computeMovingAverage, isOutlierReading, createAggregationBucket, updateAggregationBucket, computeBucketMean, createAnomalyThreshold, checkThresholdViolation, createAlertRule, createSinkConfig, createPipelineCheckpoint, createRetryPolicy, computeExponentialBackoff, isSinkHealthy, createSinkHealthRecord, isSinkDegraded, buildDeadLetterRecord, shouldQuarantineDeadLetter, validatePartitionDistribution, estimatePartitionCapacity

class StreamProcessingWindow(TypedDict):
    windowId: str
    metricName: str
    bucketStartNano: int
    bucketEndNano: int
    recordCount: int
    sumTotal: float
    minimumValue: float
    maximumValue: float
    isClosed: bool

class WatermarkTracker(TypedDict):
    streamId: str
    currentWatermarkNano: int
    maxAllowedLatenessNano: int
    totalLateEventsDropped: int
    lastUpdatedTimestamp: int

class SlidingWindowConfig(TypedDict):
    windowDurationSeconds: int
    slideIntervalSeconds: int
    maxAllowedLatenessSeconds: int
    enableZeroPadding: bool

class EmaState(TypedDict):
    alphaRate: float
    currentEma: float
    sampleCount: int
    varianceEma: float
    lastTimestampNano: int

class ZScoreAnomaly(TypedDict):
    metricName: str
    observedValue: float
    meanReference: float
    standardDeviation: float
    zScoreValue: float
    isAnomaly: bool
    detectionTimeMs: int

class AlertDispatchQueue(TypedDict):
    channelName: str
    pendingAlertCount: int
    maxQueueCapacity: int
    droppedAlertCount: int
    isThrottled: bool

class TokenBucketLimiter(TypedDict):
    bucketCapacity: int
    tokensAvailable: float
    refillRatePerSec: float
    lastRefillTimestampMs: int

class BackpressureSignal(TypedDict):
    streamId: str
    congestionLevelPercent: int
    throttleDelayMs: int
    isEnginePaused: bool
    timestampMs: int

class StreamProcessorTelemetry(TypedDict):
    engineId: str
    uptimeSeconds: int
    totalIngestedPoints: int
    totalAnomaliesDetected: int
    totalLateEventsDropped: int
    totalSinksActive: int
    averageThroughputRps: int

class PartitionWorkerState(TypedDict):
    workerId: str
    assignedPartitionId: int
    lastCommittedOffset: int
    currentHeadOffset: int
    lagRecordCount: int
    isWorkerAlive: bool
    lastHeartbeatTimeMs: int

class AggregationAccumulator(TypedDict):
    metricName: str
    count: int
    sumVal: float
    minVal: float
    maxVal: float
    squaredSumVal: float

class EnrichedSensorTelemetry(TypedDict):
    sensorId: str
    deviceType: str
    tempCelsius: float
    tempFahrenheit: float
    isOverheating: bool
    isBatteryLow: bool
    readingQuality: str
    processedAtTimestamp: int

class StreamExecutionResult(TypedDict):
    statusMessage: str
    processedBatches: int
    emittedPoints: int
    anomaliesFlagged: int
    elapsedTimeMs: int
    isSuccessful: bool

def createStreamWindow(wId: str, metric: str, startNano: int, endNano: int) -> StreamProcessingWindow:
    window = {"windowId": wId, "metricName": metric, "bucketStartNano": startNano, "bucketEndNano": endNano, "recordCount": 0, "sumTotal": 0, "minimumValue": 9999999, "maximumValue": (-9999999), "isClosed": False}
    return window

def addPointToWindow(w: StreamProcessingWindow, point: MetricPoint) -> StreamProcessingWindow:
    if w.isClosed:
        return w
    minV = w.minimumValue
    if (point.metricValue < minV):
        minV = point.metricValue
    maxV = w.maximumValue
    if (point.metricValue > maxV):
        maxV = point.metricValue
    updated = {"windowId": w.windowId, "metricName": w.metricName, "bucketStartNano": w.bucketStartNano, "bucketEndNano": w.bucketEndNano, "recordCount": (w.recordCount + 1), "sumTotal": (w.sumTotal + point.metricValue), "minimumValue": minV, "maximumValue": maxV, "isClosed": w.isClosed}
    return updated

def closeStreamWindow(w: StreamProcessingWindow) -> StreamProcessingWindow:
    closed = {"windowId": w.windowId, "metricName": w.metricName, "bucketStartNano": w.bucketStartNano, "bucketEndNano": w.bucketEndNano, "recordCount": w.recordCount, "sumTotal": w.sumTotal, "minimumValue": w.minimumValue, "maximumValue": w.maximumValue, "isClosed": True}
    return closed

def calculateWindowMean(w: StreamProcessingWindow) -> float:
    if (w.recordCount <= 0):
        return 0
    return (w.sumTotal / (w.recordCount * 1))

def createWatermarkTracker(sId: str, maxLatenessSec: int, nowNano: int) -> WatermarkTracker:
    tracker = {"streamId": sId, "currentWatermarkNano": nowNano, "maxAllowedLatenessNano": (maxLatenessSec * 1000000000), "totalLateEventsDropped": 0, "lastUpdatedTimestamp": nowNano}
    return tracker

def advanceWatermark(tracker: WatermarkTracker, eventTimestampNano: int) -> WatermarkTracker:
    candidateWatermark = (eventTimestampNano - tracker.maxAllowedLatenessNano)
    newWatermark = tracker.currentWatermarkNano
    if (candidateWatermark > newWatermark):
        newWatermark = candidateWatermark
    updated = {"streamId": tracker.streamId, "currentWatermarkNano": newWatermark, "maxAllowedLatenessNano": tracker.maxAllowedLatenessNano, "totalLateEventsDropped": tracker.totalLateEventsDropped, "lastUpdatedTimestamp": eventTimestampNano}
    return updated

def isEventLate(tracker: WatermarkTracker, eventTimestampNano: int) -> bool:
    return (eventTimestampNano < tracker.currentWatermarkNano)

def recordLateEventDropped(tracker: WatermarkTracker) -> WatermarkTracker:
    updated = {"streamId": tracker.streamId, "currentWatermarkNano": tracker.currentWatermarkNano, "maxAllowedLatenessNano": tracker.maxAllowedLatenessNano, "totalLateEventsDropped": (tracker.totalLateEventsDropped + 1), "lastUpdatedTimestamp": tracker.lastUpdatedTimestamp}
    return updated

def createSlidingWindowConfig(durationSec: int, slideSec: int, latenessSec: int) -> SlidingWindowConfig:
    cfg = {"windowDurationSeconds": durationSec, "slideIntervalSeconds": slideSec, "maxAllowedLatenessSeconds": latenessSec, "enableZeroPadding": False}
    return cfg

def validateSlidingWindowConfig(cfg: SlidingWindowConfig) -> bool:
    if (cfg.windowDurationSeconds <= 0):
        return False
    if (cfg.slideIntervalSeconds <= 0):
        return False
    if (cfg.slideIntervalSeconds > cfg.windowDurationSeconds):
        return False
    return True

def calculateWindowCountInSpan(cfg: SlidingWindowConfig, spanSeconds: int) -> int:
    if (cfg.slideIntervalSeconds <= 0):
        return 0
    if (spanSeconds < cfg.windowDurationSeconds):
        return 0
    return (int(((spanSeconds - cfg.windowDurationSeconds) / cfg.slideIntervalSeconds)) + 1)

def createEmaState(alpha: float) -> EmaState:
    ema = {"alphaRate": alpha, "currentEma": 0, "sampleCount": 0, "varianceEma": 0, "lastTimestampNano": 0}
    return ema

def updateEma(ema: EmaState, newValue: float, timestampNano: int) -> EmaState:
    if (ema.sampleCount == 0):
        initial = {"alphaRate": ema.alphaRate, "currentEma": newValue, "sampleCount": 1, "varianceEma": 0, "lastTimestampNano": timestampNano}
        return initial
    diff = (newValue - ema.currentEma)
    updatedEma = (ema.currentEma + (ema.alphaRate * diff))
    diffSq = (diff * diff)
    updatedVar = (ema.varianceEma + (ema.alphaRate * (diffSq - ema.varianceEma)))
    updated = {"alphaRate": ema.alphaRate, "currentEma": updatedEma, "sampleCount": (ema.sampleCount + 1), "varianceEma": updatedVar, "lastTimestampNano": timestampNano}
    return updated

def computeStandardDeviationFromVariance(varianceVal: float) -> float:
    if (varianceVal <= 0):
        return 0
    guess = (varianceVal / 2)
    if (guess == 0):
        guess = 1
    iterCount = 0
    currentGuess = guess
    while (iterCount < 8):
        nextGuess = (0.5 * (currentGuess + (varianceVal / currentGuess)))
        currentGuess = nextGuess
        iterCount = (iterCount + 1)
    return currentGuess

def detectZScoreAnomaly(metric: MetricPoint, ema: EmaState, sigmaMultiplier: float, nowMs: int) -> ZScoreAnomaly:
    if (ema.sampleCount < 5):
        emptyResult = {"metricName": metric.metricName, "observedValue": metric.metricValue, "meanReference": ema.currentEma, "standardDeviation": 0, "zScoreValue": 0, "isAnomaly": False, "detectionTimeMs": nowMs}
        return emptyResult
    stdDev = computeStandardDeviationFromVariance(ema.varianceEma)
    if (stdDev <= 0.0001):
        zeroDev = {"metricName": metric.metricName, "observedValue": metric.metricValue, "meanReference": ema.currentEma, "standardDeviation": stdDev, "zScoreValue": 0, "isAnomaly": False, "detectionTimeMs": nowMs}
        return zeroDev
    diff = (metric.metricValue - ema.currentEma)
    zScore = (diff / stdDev)
    absZ = zScore
    if (absZ < 0):
        absZ = (0 - absZ)
    flagged = (absZ >= sigmaMultiplier)
    anomaly = {"metricName": metric.metricName, "observedValue": metric.metricValue, "meanReference": ema.currentEma, "standardDeviation": stdDev, "zScoreValue": zScore, "isAnomaly": flagged, "detectionTimeMs": nowMs}
    return anomaly

def createAlertDispatchQueue(channel: str, capacity: int) -> AlertDispatchQueue:
    queue = {"channelName": channel, "pendingAlertCount": 0, "maxQueueCapacity": capacity, "droppedAlertCount": 0, "isThrottled": False}
    return queue

def enqueueAlert(q: AlertDispatchQueue) -> AlertDispatchQueue:
    if (q.pendingAlertCount >= q.maxQueueCapacity):
        dropped = {"channelName": q.channelName, "pendingAlertCount": q.pendingAlertCount, "maxQueueCapacity": q.maxQueueCapacity, "droppedAlertCount": (q.droppedAlertCount + 1), "isThrottled": True}
        return dropped
    enqueued = {"channelName": q.channelName, "pendingAlertCount": (q.pendingAlertCount + 1), "maxQueueCapacity": q.maxQueueCapacity, "droppedAlertCount": q.droppedAlertCount, "isThrottled": q.isThrottled}
    return enqueued

def drainAlertQueue(q: AlertDispatchQueue, countToDrain: int) -> AlertDispatchQueue:
    remaining = (q.pendingAlertCount - countToDrain)
    if (remaining < 0):
        remaining = 0
    drained = {"channelName": q.channelName, "pendingAlertCount": remaining, "maxQueueCapacity": q.maxQueueCapacity, "droppedAlertCount": q.droppedAlertCount, "isThrottled": q.isThrottled}
    return drained

def createTokenBucketLimiter(capacity: int, refillRatePerSec: float, nowMs: int) -> TokenBucketLimiter:
    limiter = {"bucketCapacity": capacity, "tokensAvailable": (capacity * 1), "refillRatePerSec": refillRatePerSec, "lastRefillTimestampMs": nowMs}
    return limiter

def refillTokenBucket(limiter: TokenBucketLimiter, nowMs: int) -> TokenBucketLimiter:
    elapsedMs = (nowMs - limiter.lastRefillTimestampMs)
    if (elapsedMs <= 0):
        return limiter
    elapsedSeconds = (elapsedMs / 1000)
    tokensToAdd = (elapsedSeconds * limiter.refillRatePerSec)
    newTokens = (limiter.tokensAvailable + tokensToAdd)
    capFloat = (limiter.bucketCapacity * 1)
    if (newTokens > capFloat):
        newTokens = capFloat
    updated = {"bucketCapacity": limiter.bucketCapacity, "tokensAvailable": newTokens, "refillRatePerSec": limiter.refillRatePerSec, "lastRefillTimestampMs": nowMs}
    return updated

def tryConsumeTokens(limiter: TokenBucketLimiter, tokensRequested: int) -> bool:
    reqFloat = (tokensRequested * 1)
    return (limiter.tokensAvailable >= reqFloat)

def consumeTokensIfAvailable(limiter: TokenBucketLimiter, tokensRequested: int) -> TokenBucketLimiter:
    reqFloat = (tokensRequested * 1)
    if (limiter.tokensAvailable >= reqFloat):
        consumed = {"bucketCapacity": limiter.bucketCapacity, "tokensAvailable": (limiter.tokensAvailable - reqFloat), "refillRatePerSec": limiter.refillRatePerSec, "lastRefillTimestampMs": limiter.lastRefillTimestampMs}
        return consumed
    return limiter

def computeCongestionLevel(availableTokens: float, capacity: int) -> int:
    if (capacity <= 0):
        return 100
    capFloat = (capacity * 1)
    usedTokens = (capFloat - availableTokens)
    pct = int(((usedTokens * 100) / capFloat))
    if (pct < 0):
        return 0
    if (pct > 100):
        return 100
    return pct

def buildBackpressureSignal(sId: str, limiter: TokenBucketLimiter, nowMs: int) -> BackpressureSignal:
    congestion = computeCongestionLevel(limiter.tokensAvailable, limiter.bucketCapacity)
    delayMs = 0
    paused = False
    if (congestion > 90):
        delayMs = 200
        paused = True
    else:
        if (congestion > 70):
            delayMs = 50
    signal = {"streamId": sId, "congestionLevelPercent": congestion, "throttleDelayMs": delayMs, "isEnginePaused": paused, "timestampMs": nowMs}
    return signal

def createPartitionWorker(workerId: str, partitionId: int, nowMs: int) -> PartitionWorkerState:
    worker = {"workerId": workerId, "assignedPartitionId": partitionId, "lastCommittedOffset": 0, "currentHeadOffset": 0, "lagRecordCount": 0, "isWorkerAlive": True, "lastHeartbeatTimeMs": nowMs}
    return worker

def advanceWorkerOffset(worker: PartitionWorkerState, newHeadOffset: int, commitOffset: int) -> PartitionWorkerState:
    lag = (newHeadOffset - commitOffset)
    validLag = lag
    if (validLag < 0):
        validLag = 0
    updated = {"workerId": worker.workerId, "assignedPartitionId": worker.assignedPartitionId, "lastCommittedOffset": commitOffset, "currentHeadOffset": newHeadOffset, "lagRecordCount": validLag, "isWorkerAlive": worker.isWorkerAlive, "lastHeartbeatTimeMs": worker.lastHeartbeatTimeMs}
    return updated

def heartbeatWorker(worker: PartitionWorkerState, nowMs: int) -> PartitionWorkerState:
    updated = {"workerId": worker.workerId, "assignedPartitionId": worker.assignedPartitionId, "lastCommittedOffset": worker.lastCommittedOffset, "currentHeadOffset": worker.currentHeadOffset, "lagRecordCount": worker.lagRecordCount, "isWorkerAlive": True, "lastHeartbeatTimeMs": nowMs}
    return updated

def isWorkerHealthy(worker: PartitionWorkerState, nowMs: int, maxHeartbeatTimeoutMs: int) -> bool:
    if (worker.isWorkerAlive == False):
        return False
    elapsed = (nowMs - worker.lastHeartbeatTimeMs)
    return (elapsed <= maxHeartbeatTimeoutMs)

def createAccumulator(metricName: str) -> AggregationAccumulator:
    acc = {"metricName": metricName, "count": 0, "sumVal": 0, "minVal": 9999999, "maxVal": (-9999999), "squaredSumVal": 0}
    return acc

def accumulateValue(acc: AggregationAccumulator, v: float) -> AggregationAccumulator:
    minV = acc.minVal
    if (v < minV):
        minV = v
    maxV = acc.maxVal
    if (v > maxV):
        maxV = v
    sq = (v * v)
    updated = {"metricName": acc.metricName, "count": (acc.count + 1), "sumVal": (acc.sumVal + v), "minVal": minV, "maxVal": maxV, "squaredSumVal": (acc.squaredSumVal + sq)}
    return updated

def computeAccumulatorVariance(acc: AggregationAccumulator) -> float:
    if (acc.count <= 1):
        return 0
    countF = (acc.count * 1)
    mean = (acc.sumVal / countF)
    varianceVal = ((acc.squaredSumVal / countF) - (mean * mean))
    if (varianceVal < 0):
        return 0
    return varianceVal

def convertCelsiusToFahrenheit(celsius: float) -> float:
    return ((celsius * 1.8) + 32)

def evaluateSensorQuality(reading: SensorReading) -> str:
    if (reading.batteryVolts < 2.8):
        return "CRITICAL_BATTERY"
    if ((reading.temperatureCelsius < (-40)) or (reading.temperatureCelsius > 85)):
        return "SENSOR_OUT_OF_BOUNDS"
    if ((reading.humidityPercent < 0) or (reading.humidityPercent > 100)):
        return "INVALID_HUMIDITY"
    return "NOMINAL"

def enrichSensorReading(reading: SensorReading, nowSec: int) -> EnrichedSensorTelemetry:
    fahrenheit = convertCelsiusToFahrenheit(reading.temperatureCelsius)
    overheating = (reading.temperatureCelsius > 65)
    lowBattery = (reading.batteryVolts < 3)
    quality = evaluateSensorQuality(reading)
    enriched = {"sensorId": reading.sensorId, "deviceType": reading.deviceType, "tempCelsius": reading.temperatureCelsius, "tempFahrenheit": fahrenheit, "isOverheating": overheating, "isBatteryLow": lowBattery, "readingQuality": quality, "processedAtTimestamp": nowSec}
    return enriched

def shouldRouteToHighPrioritySink(enriched: EnrichedSensorTelemetry) -> bool:
    if enriched.isOverheating:
        return True
    if enriched.isBatteryLow:
        return True
    if (enriched.readingQuality != "NOMINAL"):
        return True
    return False

def calculateStreamingThroughput(pointsProcessed: int, durationSeconds: int) -> int:
    if (durationSeconds <= 0):
        return 0
    return int((pointsProcessed / durationSeconds))

def createTelemetryReport(engineId: str, uptimeSec: int, points: int, anomalies: int, drops: int, sinks: int) -> StreamProcessorTelemetry:
    rps = calculateStreamingThroughput(points, uptimeSec)
    telemetry = {"engineId": engineId, "uptimeSeconds": uptimeSec, "totalIngestedPoints": points, "totalAnomaliesDetected": anomalies, "totalLateEventsDropped": drops, "totalSinksActive": sinks, "averageThroughputRps": rps}
    return telemetry

def formatPipelineStatusLine(telemetry: StreamProcessorTelemetry) -> str:
    part1 = ((("Engine=" + telemetry.engineId) + " Ingested=") + str(telemetry.totalIngestedPoints))
    part2 = (((" Anomalies=" + str(telemetry.totalAnomaliesDetected)) + " Drops=") + str(telemetry.totalLateEventsDropped))
    part3 = (" RPS=" + str(telemetry.averageThroughputRps))
    return ((part1 + part2) + part3)

def processMetricBatch(points: list[MetricPoint], tracker: WatermarkTracker, ema: EmaState, sigma: float, nowMs: int) -> StreamExecutionResult:
    processedCount = 0
    anomalyCount = 0
    currentEma = ema
    currentTracker = tracker
    for point in points:
        isLate = isEventLate(currentTracker, point.timestampNano)
        if isLate:
            currentTracker = recordLateEventDropped(currentTracker)
        else:
            currentTracker = advanceWatermark(currentTracker, point.timestampNano)
            currentEma = updateEma(currentEma, point.metricValue, point.timestampNano)
            anomaly = detectZScoreAnomaly(point, currentEma, sigma, nowMs)
            if anomaly.isAnomaly:
                anomalyCount = (anomalyCount + 1)
            processedCount = (processedCount + 1)
    result = {"statusMessage": "BATCH_PROCESSED_SUCCESSFULLY", "processedBatches": 1, "emittedPoints": processedCount, "anomaliesFlagged": anomalyCount, "elapsedTimeMs": 12, "isSuccessful": True}
    return result

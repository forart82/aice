from typing import Any, Optional, Union, TypedDict

class Dimension(TypedDict):
    key: str
    value: str

class MetricPoint(TypedDict):
    metricName: str
    metricValue: float
    unit: str
    timestampNano: int
    dimensions: list[Dimension]

class SpanContext(TypedDict):
    traceId: str
    spanId: str
    parentSpanId: str
    sampled: bool

class LogRecord(TypedDict):
    logId: str
    level: str
    message: str
    serviceName: str
    timestampMs: int
    spanContext: SpanContext

class SensorReading(TypedDict):
    sensorId: str
    deviceType: str
    temperatureCelsius: float
    pressureKPa: float
    humidityPercent: float
    batteryVolts: float
    timestampSeconds: int

class DeviceMetadata(TypedDict):
    deviceId: str
    firmwareVersion: str
    hardwareRevision: str
    locationZone: str
    isOnline: bool
    lastHeartbeatTimestamp: int

class PartitionKey(TypedDict):
    partitionId: int
    shardKey: str
    assignedBrokerId: str
    replicaCount: int

class BatchMetadata(TypedDict):
    batchId: str
    recordCount: int
    byteSize: int
    compressedByteSize: int
    codec: str
    createdTimestamp: int

class SchemaDefinition(TypedDict):
    schemaName: str
    versionMajor: int
    versionMinor: int
    compatibilityMode: str
    isLocked: bool

class DataQualityReport(TypedDict):
    reportId: str
    totalRecordsChecked: int
    nullValueCount: int
    schemaViolations: int
    outlierCount: int
    passedQualityScore: int
    isApprovedForPublishing: bool

class AggregationBucket(TypedDict):
    bucketId: str
    metricName: str
    startEpochSeconds: int
    endEpochSeconds: int
    count: int
    sumValue: float
    minValue: float
    maxValue: float

class TimeSeriesSummary(TypedDict):
    metricName: str
    bucketStart: int
    pointCount: int
    mean: float
    stdDev: float
    p50: float
    p95: float
    p99: float

class AnomalyThreshold(TypedDict):
    metricName: str
    warningLevel: float
    criticalLevel: float
    consecutiveWindowCount: int

class AlertRule(TypedDict):
    ruleId: str
    metricName: str
    condition: str
    threshold: float
    durationSeconds: int
    targetChannel: str
    isActive: bool

class SinkConfig(TypedDict):
    sinkId: str
    destinationType: str
    endpointUrl: str
    batchSizeLimit: int
    flushIntervalMs: int
    maxRetries: int

class PipelineCheckpoint(TypedDict):
    pipelineId: str
    sourceOffset: int
    processedRecordCount: int
    savedTimestamp: int
    checkpointDigest: str

class RetryPolicy(TypedDict):
    maxAttempts: int
    initialDelayMs: int
    backoffMultiplier: int
    maxDelayMs: int

class ThroughputStats(TypedDict):
    sourceId: str
    recordsPerSecond: int
    bytesPerSecond: int
    droppedRecords: int
    lagSeconds: int

def createDimension(k: str, v: str) -> Dimension:
    return {"key": k, "value": v}

def createMetricPoint(name: str, numericVal: float, unit: str, nowNano: int) -> MetricPoint:
    return {"metricName": name, "metricValue": numericVal, "unit": unit, "timestampNano": nowNano, "dimensions": []}

def formatMetricKey(metric: MetricPoint) -> str:
    return ((metric.metricName + ":") + metric.unit)

def parseLogLevel(raw: str) -> str:
    clean = raw.strip()
    if (((((clean == "DEBUG") or (clean == "INFO")) or (clean == "WARN")) or (clean == "ERROR")) or (clean == "FATAL")):
        return clean
    return "INFO"

def isErrorLog(log: LogRecord) -> bool:
    return ((log.level == "ERROR") or (log.level == "FATAL"))

def shouldSampleTrace(traceId: str, sampleRateBasisPoints: int) -> bool:
    if (sampleRateBasisPoints >= 10000):
        return True
    if (sampleRateBasisPoints <= 0):
        return False
    return (len(traceId) > 0)

def celsiusToFahrenheit(celsius: float) -> float:
    return ((celsius * 1.8) + 32)

def fahrenheitToCelsius(fahrenheit: float) -> float:
    return ((fahrenheit - 32) / 1.8)

def isDeviceStale(device: DeviceMetadata, currentTimestamp: int, timeoutSeconds: int) -> bool:
    if (not device.isOnline):
        return True
    elapsed = (currentTimestamp - device.lastHeartbeatTimestamp)
    return (elapsed > timeoutSeconds)

def computeCompressionRatioBps(originalBytes: int, compressedBytes: int) -> int:
    if (originalBytes == 0):
        return 10000
    return int(((compressedBytes * 10000) / originalBytes))

def computeMovingAverage(values: list[float]) -> float:
    if (len(values) == 0):
        return 0
    sum = 0
    for v in values:
        sum = (sum + v)
    return (sum / (len(values) * 1))

def isOutlierReading(reading: SensorReading, maxAllowedTemp: float, minAllowedTemp: float) -> bool:
    if (reading.temperatureCelsius > maxAllowedTemp):
        return True
    if (reading.temperatureCelsius < minAllowedTemp):
        return True
    if ((reading.humidityPercent < 0) or (reading.humidityPercent > 100)):
        return True
    return False

def calculatePartitionSlot(shardKey: str, partitionCount: int) -> int:
    if (partitionCount <= 1):
        return 0
    length = len(shardKey)
    return (length % partitionCount)

def validateSchemaVersion(schema: SchemaDefinition, requiredMajor: int) -> bool:
    if (schema.versionMajor != requiredMajor):
        return False
    return (not schema.isLocked)

def evaluateQualityScore(totalRecords: int, errorCount: int) -> int:
    if (totalRecords == 0):
        return 100
    validRecords = (totalRecords - errorCount)
    if (validRecords < 0):
        return 0
    return int(((validRecords * 100) / totalRecords))

def createQualityReport(reportId: str, checked: int, nulls: int, violations: int, outliers: int) -> DataQualityReport:
    totalErrors = ((nulls + violations) + outliers)
    score = evaluateQualityScore(checked, totalErrors)
    isApproved = (score >= 85)
    report = {"reportId": reportId, "totalRecordsChecked": checked, "nullValueCount": nulls, "schemaViolations": violations, "outlierCount": outliers, "passedQualityScore": score, "isApprovedForPublishing": isApproved}
    return report

def initAggregationBucket(bucketId: str, metricName: str, startEpoch: int, endEpoch: int) -> AggregationBucket:
    bucket = {"bucketId": bucketId, "metricName": metricName, "startEpochSeconds": startEpoch, "endEpochSeconds": endEpoch, "count": 0, "sumValue": 0, "minValue": 999999999, "maxValue": (-999999999)}
    return bucket

def updateAggregationBucket(bucket: AggregationBucket, incomingValue: float) -> AggregationBucket:
    minVal = bucket.minValue
    if (incomingValue < minVal):
        minVal = incomingValue
    maxVal = bucket.maxValue
    if (incomingValue > maxVal):
        maxVal = incomingValue
    updated = {"bucketId": bucket.bucketId, "metricName": bucket.metricName, "startEpochSeconds": bucket.startEpochSeconds, "endEpochSeconds": bucket.endEpochSeconds, "count": (bucket.count + 1), "sumValue": (bucket.sumValue + incomingValue), "minValue": minVal, "maxValue": maxVal}
    return updated

def computeBucketMean(bucket: AggregationBucket) -> float:
    if (bucket.count == 0):
        return 0
    return (bucket.sumValue / (bucket.count * 1))

def createTimeSeriesSummary(bucket: AggregationBucket) -> TimeSeriesSummary:
    meanVal = computeBucketMean(bucket)
    summary = {"metricName": bucket.metricName, "bucketStart": bucket.startEpochSeconds, "pointCount": bucket.count, "mean": meanVal, "stdDev": 0, "p50": meanVal, "p95": bucket.maxValue, "p99": bucket.maxValue}
    return summary

def shouldTriggerAlert(summary: TimeSeriesSummary, rule: AlertRule) -> bool:
    if (not rule.isActive):
        return False
    if (summary.metricName != rule.metricName):
        return False
    if (rule.condition == "GT"):
        return (summary.mean > rule.threshold)
    elif (rule.condition == "LT"):
        return (summary.mean < rule.threshold)
    elif (rule.condition == "GTE"):
        return (summary.mean >= rule.threshold)
    elif (rule.condition == "LTE"):
        return (summary.mean <= rule.threshold)
    else:
        return False

def calculateExponentialBackoffMs(attempt: int, policy: RetryPolicy) -> int:
    if (attempt <= 1):
        return policy.initialDelayMs
    delay = policy.initialDelayMs
    i = 1
    while (i < attempt):
        delay = (delay * policy.backoffMultiplier)
        i = (i + 1)
    if (delay > policy.maxDelayMs):
        return policy.maxDelayMs
    return delay

def isSinkFlushDue(recordCount: int, elapsedMs: int, config: SinkConfig) -> bool:
    if (recordCount >= config.batchSizeLimit):
        return True
    if ((elapsedMs >= config.flushIntervalMs) and (recordCount > 0)):
        return True
    return False

def createCheckpoint(pipelineId: str, offset: int, recordCount: int, now: int) -> PipelineCheckpoint:
    digest = ((((pipelineId + "-") + str(offset)) + "-") + str(now))
    cp = {"pipelineId": pipelineId, "sourceOffset": offset, "processedRecordCount": recordCount, "savedTimestamp": now, "checkpointDigest": digest}
    return cp

def verifyCheckpointIntegrity(cp: PipelineCheckpoint) -> bool:
    if (cp.sourceOffset < 0):
        return False
    if (cp.processedRecordCount < 0):
        return False
    if (len(cp.checkpointDigest) == 0):
        return False
    return True

def calculateThroughputLag(stats: ThroughputStats, thresholdLagSeconds: int) -> bool:
    return (stats.lagSeconds > thresholdLagSeconds)

def computeAverageRecordSize(byteSize: int, count: int) -> int:
    if (count == 0):
        return 0
    return int((byteSize / count))

def sanitizeLogMessage(rawMessage: str) -> str:
    clean = rawMessage.strip()
    if (len(clean) > 1024):
        return clean[0:1024]
    return clean

def parseDeviceZone(zone: str) -> str:
    clean = zone.strip()
    if ((((clean == "US_EAST") or (clean == "US_WEST")) or (clean == "EU_CENTRAL")) or (clean == "AP_SOUTH")):
        return clean
    return "GLOBAL_DEFAULT"

def isBatteryLevelCritical(batteryVolts: float, cutoffVolts: float) -> bool:
    return (batteryVolts <= cutoffVolts)

def evaluatePipelineHealth(droppedRecords: int, errorLogs: int) -> str:
    if ((droppedRecords > 1000) or (errorLogs > 100)):
        return "CRITICAL"
    if ((droppedRecords > 100) or (errorLogs > 10)):
        return "DEGRADED"
    return "HEALTHY"

def generateAlertFingerprint(ruleId: str, metricName: str, timestampWindow: int) -> str:
    return ((((("FP-" + ruleId) + "-") + metricName) + "-") + str(timestampWindow))

def createDefaultRetryPolicy() -> RetryPolicy:
    pol = {"maxAttempts": 5, "initialDelayMs": 200, "backoffMultiplier": 2, "maxDelayMs": 10000}
    return pol

def createDefaultSinkConfig(endpoint: str) -> SinkConfig:
    cfg = {"sinkId": "DEFAULT_SINK", "destinationType": "CLICKHOUSE", "endpointUrl": endpoint, "batchSizeLimit": 1000, "flushIntervalMs": 5000, "maxRetries": 3}
    return cfg

def formatThroughputTelemetry(stats: ThroughputStats) -> str:
    return (((((((("Source " + stats.sourceId) + ": ") + str(stats.recordsPerSecond)) + " rec/s, ") + str(stats.bytesPerSecond)) + " B/s, Lag: ") + str(stats.lagSeconds)) + "s")

def calculateWindowDurationSeconds(startEpoch: int, endEpoch: int) -> int:
    return (endEpoch - startEpoch)

def isWindowComplete(windowStart: int, windowSizeSeconds: int, currentEpoch: int) -> bool:
    return (currentEpoch >= (windowStart + windowSizeSeconds))

def createAlertRule(ruleId: str, metric: str, cond: str, thresh: float, chan: str) -> AlertRule:
    rule = {"ruleId": ruleId, "metricName": metric, "condition": cond, "threshold": thresh, "durationSeconds": 60, "targetChannel": chan, "isActive": True}
    return rule

def toggleAlertRule(rule: AlertRule, activeState: bool) -> AlertRule:
    updated = {"ruleId": rule.ruleId, "metricName": rule.metricName, "condition": rule.condition, "threshold": rule.threshold, "durationSeconds": rule.durationSeconds, "targetChannel": rule.targetChannel, "isActive": activeState}
    return updated

def computeSignalToNoiseRatio(signalPower: float, noisePower: float) -> float:
    if (noisePower <= 0):
        return 999
    return (signalPower / noisePower)

def evaluateDeviceHealthIndex(readings: list[SensorReading], maxTemp: float) -> int:
    if (len(readings) == 0):
        return 100
    anomalousCount = 0
    for r in readings:
        if (r.temperatureCelsius > maxTemp):
            anomalousCount = (anomalousCount + 1)
    goodCount = (len(readings) - anomalousCount)
    return int(((goodCount * 100) / len(readings)))

def generateBatchSummary(batch: BatchMetadata) -> str:
    ratio = computeCompressionRatioBps(batch.byteSize, batch.compressedByteSize)
    return (((((((((("Batch " + batch.batchId) + ": ") + str(batch.recordCount)) + " records (") + str(batch.byteSize)) + " bytes -> ") + str(batch.compressedByteSize)) + " bytes, ratio: ") + str(ratio)) + " bps)")

def shouldCompactCheckpoints(lastCheckpointTimestamp: int, nowTimestamp: int, retentionSeconds: int) -> bool:
    return ((nowTimestamp - lastCheckpointTimestamp) > retentionSeconds)

def createSensorReading(sensorId: str, devType: str, temp: float, pressure: float, hum: float, batt: float, now: int) -> SensorReading:
    return {"sensorId": sensorId, "deviceType": devType, "temperatureCelsius": temp, "pressureKPa": pressure, "humidityPercent": hum, "batteryVolts": batt, "timestampSeconds": now}

def buildLogRecord(logId: str, lvl: str, msg: str, svc: str, nowMs: int, traceId: str, spanId: str) -> LogRecord:
    span = {"traceId": traceId, "spanId": spanId, "parentSpanId": "", "sampled": True}
    return {"logId": logId, "level": parseLogLevel(lvl), "message": sanitizeLogMessage(msg), "serviceName": svc, "timestampMs": nowMs, "spanContext": span}

class SinkHealthRecord(TypedDict):
    sinkId: str
    endpointUrl: str
    latencyMs: int
    isHealthy: bool
    consecutiveFailures: int
    lastCheckedTimestamp: int

class DeadLetterRecord(TypedDict):
    recordId: str
    originalSource: str
    payloadDigest: str
    failureReason: str
    retryCount: int
    failedAtTimestamp: int

def createSinkHealthRecord(sId: str, url: str, latency: int, ok: bool, fails: int, now: int) -> SinkHealthRecord:
    r = {"sinkId": sId, "endpointUrl": url, "latencyMs": latency, "isHealthy": ok, "consecutiveFailures": fails, "lastCheckedTimestamp": now}
    return r

def isSinkDegraded(health: SinkHealthRecord, maxAcceptableLatencyMs: int) -> bool:
    if (health.isHealthy == False):
        return True
    if (health.latencyMs > maxAcceptableLatencyMs):
        return True
    if (health.consecutiveFailures > 2):
        return True
    return False

def buildDeadLetterRecord(recId: str, src: str, digest: str, reason: str, retries: int, now: int) -> DeadLetterRecord:
    dlq = {"recordId": recId, "originalSource": src, "payloadDigest": digest, "failureReason": reason, "retryCount": retries, "failedAtTimestamp": now}
    return dlq

def shouldQuarantineDeadLetter(dlq: DeadLetterRecord, maxAllowedRetries: int) -> bool:
    return (dlq.retryCount >= maxAllowedRetries)

def validatePartitionDistribution(partitionCount: int, activeBrokers: int) -> bool:
    if (activeBrokers <= 0):
        return False
    if (partitionCount <= 0):
        return False
    return (partitionCount >= activeBrokers)

def estimatePartitionCapacity(totalPartitions: int, maxRecordsPerPartition: int) -> int:
    return (totalPartitions * maxRecordsPerPartition)

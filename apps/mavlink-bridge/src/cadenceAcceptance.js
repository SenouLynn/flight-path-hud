export function summarizeIntervals(timestampsMs) {
  if (timestampsMs.length < 2) throw new Error('at least two timestamps are required')
  const intervalsMs = timestampsMs.slice(1).map((value, index) => value - timestampsMs[index])
  if (intervalsMs.some((value) => !Number.isFinite(value) || value <= 0)) throw new Error('timestamps must increase')
  const sorted = [...intervalsMs].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  const medianMs = sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
  return { intervalsMs, medianMs, maximumMs: sorted.at(-1) }
}

export function assertCadence(timestampsMs, expectedMs, {
  medianTolerance = 0.25, sampleTolerance = 0.4, minimumPassingFraction = 0.9,
  maximumGapFactor = 3,
} = {}) {
  if (!Number.isFinite(expectedMs) || expectedMs <= 0) throw new Error('expectedMs must be positive')
  const summary = summarizeIntervals(timestampsMs)
  const medianError = Math.abs(summary.medianMs - expectedMs) / expectedMs
  const passing = summary.intervalsMs.filter((interval) => Math.abs(interval - expectedMs) / expectedMs <= sampleTolerance).length
  const passingFraction = passing / summary.intervalsMs.length
  if (medianError > medianTolerance) throw new Error(`median ${summary.medianMs.toFixed(1)}ms is outside tolerance for ${expectedMs}ms`)
  if (passingFraction < minimumPassingFraction) throw new Error(`${(passingFraction * 100).toFixed(0)}% of intervals passed; expected ${(minimumPassingFraction * 100).toFixed(0)}%`)
  if (summary.maximumMs > expectedMs * maximumGapFactor) throw new Error(`maximum gap ${summary.maximumMs.toFixed(1)}ms exceeds limit`)
  return { ...summary, passingFraction }
}

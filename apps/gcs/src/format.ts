/**
 * Shared numeric-readout formatters. Lifted out of App.tsx so MissionPanel.tsx
 * (and any future sidebar panel) can reuse the exact same formatting without
 * either reimplementing it or creating a circular import with App.tsx.
 */

export function formatCoord(value: number | null): string {
  return value === null ? 'N/A' : value.toFixed(6)
}

export function formatNumber(value: number | null, digits = 1, suffix = ''): string {
  return value === null ? 'N/A' : `${value.toFixed(digits)}${suffix}`
}

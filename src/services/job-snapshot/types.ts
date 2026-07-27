export interface ResourceSnapshot {
  capturedAt: string;
  cpuPercent: number;
  memMb: number;
  diskMb: number;
  contextRatio: number;
}

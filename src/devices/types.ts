export interface PowerMetrics {
  battery_level: number; // 0-100
  signal_strength: number; // RSSI in dBm (e.g., -50 to -120)
}

export interface DeviceProfile {
  deviceId: string;
  power: PowerMetrics;
  firmwareVersion: string;
  isFirmwareOutdated: boolean;
  txIntervals: number[]; // historical transmission intervals in milliseconds
  lastSeen: Date;
  createdAt: Date;
}

export interface DeviceStats {
  mean: number;
  stddev: number;
  sampleCount: number;
}

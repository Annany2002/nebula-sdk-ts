/** Recorded counts for one service history bucket. */
export interface ServiceMetricBucket {
  /** Backend bucket label, currently an hour such as "14:00". */
  timestamp: string;
  requests: number;
  warnings: number;
  errors: number;
}

export interface ServiceMetrics {
  name: string;
  requests: number;
  /** Requests with HTTP 4xx responses. */
  warnings: number;
  /** Requests with HTTP 5xx responses. */
  errors: number;
  history: ServiceMetricBucket[];
}

/** A backend schema advisor finding, not a complete security audit. */
export interface AdvisorIssue {
  id: string;
  category: string;
  severity: string;
  title: string;
  description: string;
  tableName?: string;
  suggestion: string;
}

export interface DatabaseAnalytics {
  totalRequests: number;
  /** Percentage from 0 to 100; a database with no recorded requests reports 100. */
  successRate: number;
  /** Backend reporting window, currently "24h". */
  timeframe: string;
  services: ServiceMetrics[];
  advisor: AdvisorIssue[];
}

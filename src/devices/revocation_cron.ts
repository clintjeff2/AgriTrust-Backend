import { CertificateRevocationService } from './revocation_service';

const DEFAULT_REFRESH_MS = 60 * 60 * 1000; // 1 hour

export class RevocationCron {
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly refreshMs: number;

  constructor(
    private readonly service: CertificateRevocationService,
    refreshMs: number = DEFAULT_REFRESH_MS,
  ) {
    this.service = service;
    this.refreshMs = refreshMs;
  }

  public start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(async () => {
      try {
        await this.service.refreshCrl();
      } catch (err) {
        console.error('CRL refresh failed:', err);
      }
    }, this.refreshMs);

    this.timer.unref();
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

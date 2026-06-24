import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    device_id?: string;
    /** Tenant context extracted from JWT auth middleware */
    tenantContext?: {
      tenantId: string;
      tier: 1 | 2 | 3;
    };
  }
}

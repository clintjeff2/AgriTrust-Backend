import 'express-serve-static-core';

declare module 'express-serve-static-core' {
  interface Request {
    device_id?: string;
  }
}

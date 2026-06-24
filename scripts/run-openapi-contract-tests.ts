import express from 'express';
import { AddressInfo } from 'net';
import { spawn } from 'child_process';
import { openApiValidationMiddleware } from '../src/middleware/openapi-validator';
import { createBatchRouter } from '../src/api/routes/batchRoutes';

const app = express();
app.use(express.json());
app.use(openApiValidationMiddleware);

const mintService = {
  async mintCertificate(batchId: string, metadata: any) {
    if (batchId === 'conflict') {
      return { success: false, error: 'Minting already in progress' };
    }
    return { success: true, certificateId: `cert-${batchId}` };
  },
} as any;

app.use('/api/v1/batches', createBatchRouter(mintService));

const server = app.listen(0, async () => {
  const address = server.address() as AddressInfo;
  const port = address.port;
  const dredd = spawn('npx', ['dredd', 'src/openapi/v1.yaml', `http://127.0.0.1:${port}`], {
    stdio: 'inherit',
    shell: false,
  });

  dredd.on('exit', (code) => {
    server.close(() => process.exit(code ?? 1));
  });
});

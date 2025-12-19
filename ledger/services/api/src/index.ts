import 'dotenv/config';
import express, { Request, Response } from 'express';
import cors from 'cors'; // <--- [1] Import CORS
import { invoicesRouter } from './routes/invoices.js';

const app = express();

// --- [2] Enable CORS for All Origins ---
// This tells browsers: "It is okay for the dashboard to read this data."
app.use(cors({ origin: true }));
// -------------------------------------

app.use(express.json({ limit: '1mb' }));

// --- [3] Activity Tracking State (In-Memory) ---
// These reset to 0 if the server restarts, which is fine for monitoring.
let successCount = 0;
let errorCount = 0;

export const trackSuccess = () => { successCount++; };
export const trackError = () => { errorCount++; };

type HealthResponse = { 
  ok: boolean;
  activity?: { success: number; errors: number; } 
};

app.get('/health', (_req: Request, res: Response<HealthResponse>) => {
  // [4] Expose the counters to your dashboard
  res.json({ 
    ok: true, 
    activity: { success: successCount, errors: errorCount } 
  });
});

app.use('/invoices', invoicesRouter);

const port = Number(process.env.PORT ?? 8080);
app.listen(port, () => {
  console.log('API on', port);
});

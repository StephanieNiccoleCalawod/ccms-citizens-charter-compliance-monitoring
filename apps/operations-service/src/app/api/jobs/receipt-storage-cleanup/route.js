import { cronRoute } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { runReceiptStorageCleanup } from '../../../../modules/receipts/receipts.js';
import { receiptStorage } from '../../../../modules/receipts/storage.js';

export const dynamic = 'force-dynamic';

// CC045: Vercel Cron (vercel.json) with "Authorization: Bearer $CRON_SECRET". Deletes the stored objects of deleted receipts and
// of interrupted uploads that are not purged yet: { purged, failed }. Never reachable through the gateway (/api/jobs).
export const GET = cronRoute('receipt-storage-cleanup', async () => runReceiptStorageCleanup(await getDb(), { storage: receiptStorage() }));

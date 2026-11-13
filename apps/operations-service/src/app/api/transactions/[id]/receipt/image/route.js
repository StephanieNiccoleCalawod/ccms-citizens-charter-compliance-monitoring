import { clientIp, requirePermission, route } from 'ccms-shared';
import { getDb } from '../../../../../../lib/data-source.js';
import { RECEIPT_ROLES, readReceiptImage } from '../../../../../../modules/receipts/receipts.js';
import { receiptStorage } from '../../../../../../modules/receipts/storage.js';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// CC045: GET /transactions/:id/receipt/image - the photo bytes, through the application only. Every request needs a valid
// session and re-checks the role and the office; the view is audited before the bytes are read. Never cached, never a
// public or signed provider URL.
const canUse = requirePermission(RECEIPT_ROLES);

export const GET = route(async (request, { params }) => {
  const user = await canUse(request);
  const image = await readReceiptImage(await getDb(), { storage: receiptStorage() }, user, params.id, { ipAddress: clientIp(request) });
  return new Response(image.bytes, {
    status: 200,
    headers: {
      'content-type': image.contentType,
      'content-length': String(image.bytes.length),
      'cache-control': 'private, no-store',
      pragma: 'no-cache',
      'x-content-type-options': 'nosniff',
      'content-disposition': `inline; filename="${image.fileName}"`,
      'content-security-policy': "default-src 'none'; img-src 'self'",
      'cross-origin-resource-policy': 'same-origin',
    },
  });
});

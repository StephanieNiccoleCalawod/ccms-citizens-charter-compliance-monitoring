import { cronRoute } from 'ccms-shared';
import { getDb } from '../../../../lib/data-source.js';
import { trainLateRisk } from '../../../../modules/analytics/late-risk.js';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export const GET = cronRoute('late-risk', async () => trainLateRisk(await getDb()));

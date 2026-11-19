// Singular alias for GET /api/analytics/kpis (spec 2.3): shares the exact handler and RBAC checks.
export const dynamic = 'force-dynamic';
export { GET } from '../kpis/route.js';

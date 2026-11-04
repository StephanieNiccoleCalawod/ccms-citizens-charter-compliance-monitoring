// Shared is source ESM: no generated output or separate compile step is needed.
import * as shared from 'ccms-shared';
import 'ccms-shared/nav';
import 'ccms-shared/roles';
import 'ccms-shared/testing';
if (!shared.createDataSource || !shared.createRateLimiter) throw new Error('Shared exports missing');
console.log('Shared workspace exports resolve');

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { resetMailTransport, setMailer, sendPasswordResetEmail } from '../src/lib/mailer.js';

// S8-10 / DEF-14 evidence for Identity: a named sender ("Name <address>") must reach the SMTP envelope as the bare address.
function fakeSmtp() {
  const commands = [];
  const server = createServer((socket) => {
    let inData = false;
    let buffer = '';
    socket.write('220 fake ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (inData) {
          if (line === '.') { inData = false; socket.write('250 queued\r\n'); }
          continue;
        }
        commands.push(line);
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-fake\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') { inData = true; socket.write('354 go\r\n'); }
        else if (cmd === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, commands, port: server.address().port })));
}

async function envelopeFor(emailFrom) {
  const { server, commands, port } = await fakeSmtp();
  const saved = { ...process.env };
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', EMAIL_FROM: emailFrom });
  delete process.env.SMTP_USER;
  setMailer(null);
  resetMailTransport();
  try {
    await sendPasswordResetEmail({ to: 'juan@example.com', name: 'Juan', link: 'http://localhost:8080/reset-password?token=abc', expiresInMinutes: 60 });
    return commands.filter((c) => /^(MAIL FROM|RCPT TO)/i.test(c));
  } finally {
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'EMAIL_FROM']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetMailTransport();
    server.close();
  }
}

test('a named EMAIL_FROM reaches the SMTP envelope as the bare address (password reset)', async () => {
  const envelope = await envelopeFor('CCMS <noreply@ccms.local>');
  assert.match(envelope[0], /^MAIL FROM:<noreply@ccms\.local>/i);
  assert.match(envelope[1], /^RCPT TO:<juan@example\.com>/i);
});

test('a name with a comma still gives a bare envelope address', async () => {
  const envelope = await envelopeFor('"PUP CCMS, Quezon City" <no-reply@example.edu.ph>');
  assert.match(envelope[0], /^MAIL FROM:<no-reply@example\.edu\.ph>/i);
});

test('an EMAIL_FROM that is already a bare address is unchanged', async () => {
  const envelope = await envelopeFor('noreply@ccms.local');
  assert.match(envelope[0], /^MAIL FROM:<noreply@ccms\.local>/i);
});

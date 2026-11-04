import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { resetMailTransport, setMailer, sendPasswordResetEmail } from '../src/lib/mailer.js';

// A tiny fake SMTP server: records the DATA section so we can check what would be delivered.
function fakeSmtp() {
  const received = [];
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
          if (line === '.') {
            inData = false;
            socket.write('250 queued\r\n');
          } else received.push(line);
          continue;
        }
        const cmd = line.slice(0, 4).toUpperCase();
        if (cmd === 'EHLO') socket.write('250-fake\r\n250 8BITMIME\r\n');
        else if (cmd === 'DATA') {
          inData = true;
          socket.write('354 go\r\n');
        } else if (cmd === 'QUIT') {
          socket.write('221 bye\r\n');
          socket.end();
        } else socket.write('250 ok\r\n');
      }
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port })));
}

test('reset email goes out through SMTP when SMTP_HOST is set', async () => {
  const { server, received, port } = await fakeSmtp();
  const saved = { ...process.env };
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: String(port), SMTP_SECURE: 'false', EMAIL_FROM: 'CCMS <noreply@ccms.local>' });
  delete process.env.SMTP_USER;
  setMailer(null);
  resetMailTransport();
  try {
    await sendPasswordResetEmail({ to: 'juan@example.com', name: 'Juan', link: 'http://localhost:8080/reset-password?token=abc', expiresInMinutes: 60 });
    const raw = received.join('\n');
    assert.match(raw, /To: juan@example\.com/);
    assert.match(raw, /Subject: Reset your CCMS password/);
    assert.match(raw, /reset-password\?token=3Dabc|reset-password\?token=abc/);
  } finally {
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE', 'EMAIL_FROM']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetMailTransport();
    server.close();
  }
});

test('SMTP failure becomes EMAIL_DELIVERY_FAILED', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: '1', SMTP_SECURE: 'false' });
  setMailer(null);
  resetMailTransport();
  try {
    await assert.rejects(
      sendPasswordResetEmail({ to: 'a@b.c', name: 'A', link: 'http://x', expiresInMinutes: 5 }),
      (err) => err.code === 'EMAIL_DELIVERY_FAILED',
    );
  } finally {
    for (const key of ['SMTP_HOST', 'SMTP_PORT', 'SMTP_SECURE']) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    resetMailTransport();
  }
});

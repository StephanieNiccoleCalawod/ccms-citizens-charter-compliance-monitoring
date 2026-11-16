// DEF-14: EMAIL_FROM with a display name ("Name <address>") must not reach MAIL FROM (the mail server answered 553).
import { strict as assert } from 'node:assert';
import { createServer } from 'node:net';
import { describe, it } from 'node:test';
import { buildMessage, createMailer } from '../src/lib/mailer.js';

async function smtpServer() {
  const log = [];
  const server = createServer((socket) => {
    let buffer = '';
    let data = false;
    socket.write('220 test ESMTP\r\n');
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (data) {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) break;
          log.push(`DATA:${buffer.slice(0, end)}`);
          buffer = buffer.slice(end + 5);
          data = false;
          socket.write('250 queued\r\n');
          continue;
        }
        const eol = buffer.indexOf('\r\n');
        if (eol < 0) break;
        const line = buffer.slice(0, eol);
        buffer = buffer.slice(eol + 2);
        log.push(line);
        if (/^EHLO/i.test(line)) socket.write('250-test\r\n250 8BITMIME\r\n');
        else if (/^MAIL FROM:<[^<> ]+@[^<> ]+>$/i.test(line)) socket.write('250 ok\r\n');
        else if (/^MAIL FROM/i.test(line)) socket.write('553 5.1.3 The address is not a valid RFC 5321 address\r\n');
        else if (/^RCPT TO/i.test(line)) socket.write('250 ok\r\n');
        else if (/^DATA/i.test(line)) { data = true; socket.write('354 go\r\n'); } else if (/^QUIT/i.test(line)) socket.end('221 bye\r\n');
        else socket.write('500 what\r\n');
      }
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { log, port: server.address().port, close: () => new Promise((resolve) => { server.closeAllConnections?.(); server.close(resolve); }) };
}

describe('the sender address (DEF-14)', () => {
  it('a sender with a display name is accepted: the envelope is the bare address, the header keeps the name', async () => {
    const smtp = await smtpServer();
    try {
      await createMailer({ host: '127.0.0.1', port: smtp.port, from: 'CCCMS QA <no-reply@ccms-qa.test>', requireTls: false }).send({ to: 'citizen.qa@ccms-qa.test', subject: 'Reference', text: 'hello' });
      assert.ok(smtp.log.includes('MAIL FROM:<no-reply@ccms-qa.test>'));
      assert.ok(smtp.log.includes('RCPT TO:<citizen.qa@ccms-qa.test>'));
      assert.match(smtp.log.find((l) => l.startsWith('DATA:')), /^DATA:From: CCCMS QA <no-reply@ccms-qa\.test>\r\nTo: citizen\.qa@ccms-qa\.test\r\n/);
    } finally { await smtp.close(); }
  });
  it('a bare sender is unchanged and the header carries no stray characters', () => {
    const text = buildMessage({ from: ' <a@b.cd> ', to: 'x@y.zz', subject: 's', text: 't', date: new Date('2026-11-10T00:00:00Z'), messageId: '<id@ccms>' });
    assert.match(text, /^From: a@b\.cd\r\nTo: x@y\.zz\r\n/);
  });
});

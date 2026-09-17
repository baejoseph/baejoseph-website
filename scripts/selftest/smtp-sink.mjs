// A deliberately small SMTP server. Enough of the protocol for nodemailer, with
// hooks so a test can make specific addresses bounce.
import net from 'node:net';

export function startSink({ port = 2525, fail = new Map() } = {}) {
  const deliveries = [];
  const attempts = new Map(); // address -> attempts seen

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let data = '';
    let from = '';
    const rcpt = [];
    let authStage = 0;

    const send = (line) => socket.write(line + '\r\n');
    send('220 sink.local ESMTP ready');

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      let idx;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            deliveries.push({ from, to: [...rcpt], body: data });
            rcpt.length = 0;
            data = '';
            send('250 2.0.0 Ok: queued');
          } else {
            data += line + '\n';
          }
          continue;
        }

        const upper = line.toUpperCase();
        if (authStage === 1) { authStage = 2; send('334 UGFzc3dvcmQ6'); continue; }
        if (authStage === 2) { authStage = 0; send('235 2.7.0 Authentication successful'); continue; }

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          socket.write('250-sink.local\r\n250-AUTH PLAIN LOGIN\r\n250-8BITMIME\r\n250 SIZE 10485760\r\n');
        } else if (upper.startsWith('AUTH PLAIN')) {
          send('235 2.7.0 Authentication successful');
        } else if (upper.startsWith('AUTH LOGIN')) {
          authStage = 1;
          send('334 VXNlcm5hbWU6');
        } else if (upper.startsWith('MAIL FROM')) {
          from = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'));
          send('250 2.1.0 Ok');
        } else if (upper.startsWith('RCPT TO')) {
          const addr = line.slice(line.indexOf('<') + 1, line.lastIndexOf('>'));
          const n = (attempts.get(addr) || 0) + 1;
          attempts.set(addr, n);
          const rule = fail.get(addr);
          if (rule && rule.times === null) {
            send('550 5.1.1 User unknown');
          } else if (rule && n <= rule.times) {
            send(rule.code || '452 4.2.1 Try again later');
          } else {
            rcpt.push(addr);
            send('250 2.1.5 Ok');
          }
        } else if (upper.startsWith('DATA')) {
          inData = true;
          send('354 End data with <CR><LF>.<CR><LF>');
        } else if (upper.startsWith('RSET')) {
          rcpt.length = 0;
          send('250 2.0.0 Ok');
        } else if (upper.startsWith('QUIT')) {
          send('221 2.0.0 Bye');
          socket.end();
        } else {
          send('250 2.0.0 Ok');
        }
      }
    });
    socket.on('error', () => {});
  });

  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => {
      resolve({
        deliveries,
        attempts,
        close: () => new Promise((r) => server.close(r)),
      });
    });
  });
}

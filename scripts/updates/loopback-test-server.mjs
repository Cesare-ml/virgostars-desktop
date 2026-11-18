// Disposable acceptance server; serves ONLY locally generated test artifacts over localhost HTTPS.
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
const root = process.env.VIRGOSTARS_ACCEPTANCE_ROOT;
if (!root || !path.isAbsolute(root)) throw Error('Set VIRGOSTARS_ACCEPTANCE_ROOT to the isolated test folder.');
const read = name => fs.readFileSync(path.join(root, name));
const server = https.createServer({key:read('server.key'),cert:read('server.pem')}, (req,res) => {
  try {
    const mode = read('mode.txt').toString().trim();
    if (mode === 'offline') { req.socket.destroy(); return; }
    if (req.url === '/latest.json') {
      const signature = read(mode === 'invalid' ? '002.exe.sig' : '003.exe.sig').toString().trim();
      const version = mode === 'same' ? '0.0.2' : mode === 'version' ? '0.0.4' : '0.0.3';
      res.writeHead(200, {'Content-Type':'application/json'});
      res.end(JSON.stringify({version,notes:'Synthetic acceptance release',pub_date:'2026-01-01T00:00:00Z',platforms:{'windows-x86_64':{signature,url:'https://localhost:47831/installer.exe'}}})); return;
    }
    if (req.url !== '/installer.exe') { res.writeHead(404); res.end(); return; }
    const file = path.join(root, '003.exe');
    res.writeHead(200, {'Content-Type':'application/octet-stream','Content-Length':fs.statSync(file).size});
    const source = fs.createReadStream(file, {highWaterMark:65536}); let sent = 0;
    source.on('data', chunk => {
      source.pause(); sent += chunk.length;
      if (mode === 'interrupt' && sent > 131072) { source.destroy(); res.destroy(); return; }
      res.write(chunk); setTimeout(() => source.resume(), 10);
    });
    source.on('end', () => res.end());
  } catch { res.writeHead(500); res.end(); }
});
server.listen(47831, 'localhost', () => console.log('Disposable updater test server listening on localhost:47831'));

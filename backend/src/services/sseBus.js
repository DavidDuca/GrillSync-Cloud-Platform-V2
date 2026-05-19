// In-memory SSE bus. One process only; for multi-instance use Redis pub/sub.
const clients = new Set();

function addClient(client) {
  clients.add(client);
  return () => clients.delete(client);
}

function broadcast(event, data, filter = null) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of clients) {
    if (filter && !filter(c)) continue;
    try { c.res.write(payload); } catch { /* ignore */ }
  }
}

function heartbeatAll() {
  for (const c of clients) {
    try { c.res.write(`: ping ${Date.now()}\n\n`); } catch { /* ignore */ }
  }
}
setInterval(heartbeatAll, 25000);

module.exports = { addClient, broadcast };

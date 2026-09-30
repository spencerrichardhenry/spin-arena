import { Peer, type DataConnection, type PeerOptions } from 'peerjs';
import { cleanName, MAX_PLAYERS, normalizeCode, makeCode, PROTOCOL, validCode, type GuestMessage, type HostMessage } from './protocol.ts';

// Adapted from Wildtag's Grandpa network: PeerJS brokers the room, WebRTC carries game data.
const PREFIX = 'spin-arena-v1-';
const TIMEOUT_MS = 15000;
const DEFAULT_ICE: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];
export type RoomStatus = 'idle' | 'opening' | 'open' | 'connecting' | 'connected' | 'error';

function peerOptions(): PeerOptions { return { config: { iceServers: DEFAULT_ICE } }; }

/**
 * The host accepts up to MAX_PLAYERS - 1 guests. Each guest identifies itself with a stable id,
 * so a guest that reconnects gets its old slot back.
 */
export class Room {
  status: RoomStatus = 'idle';
  message = '';
  code = '';
  isHost = false;
  onStatus: () => void = () => {};
  /** Host: a guest completed the handshake. */
  onGuestJoin: (id: string, name: string) => void = () => {};
  onGuestLeave: (id: string) => void = () => {};
  onGuestMessage: (id: string, msg: GuestMessage) => void = () => {};
  /** Guest: a message from the host. */
  onHostMessage: (msg: HostMessage) => void = () => {};
  private peer: Peer | null = null;
  private guests = new Map<string, DataConnection>();
  private hostConn: DataConnection | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastReceived = new Map<DataConnection, number>();
  private generation = 0;
  private heartbeat: ReturnType<typeof setInterval>;

  constructor() {
    this.heartbeat = setInterval(() => this.beat(), 3000);
    window.addEventListener('pagehide', () => this.dispose(), { once: true });
  }
  private beat(): void {
    const now = performance.now();
    if (this.hostConn && this.status === 'connected') {
      if (now - (this.lastReceived.get(this.hostConn) ?? now) > 12000) this.fail('Connection to the host was lost.');
      else this.toHost({ t: 'ping' });
    }
    for (const [id, conn] of this.guests) if (now - (this.lastReceived.get(conn) ?? now) > 12000) { conn.close(); this.dropGuest(id, conn); }
  }
  private change(status: RoomStatus, message: string): void { this.status = status; this.message = message; this.onStatus(); }
  private clearTimer(): void { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private fail(message: string): void {
    this.stop();
    this.change('error', message);
  }
  get guestCount(): number { return this.guests.size; }

  async host(): Promise<void> {
    this.stop();
    const generation = ++this.generation;
    this.isHost = true;
    this.code = makeCode();
    this.change('opening', 'Creating a room…');
    const peer = new Peer(PREFIX + this.code, peerOptions());
    this.peer = peer;
    this.timer = setTimeout(() => this.fail('Could not create a room. Check your connection and try again.'), TIMEOUT_MS);
    peer.on('open', () => { if (generation === this.generation) { this.clearTimer(); this.change('open', 'Room open. Share the code.'); } });
    peer.on('connection', conn => this.acceptGuest(conn, generation));
    peer.on('error', err => {
      if (generation !== this.generation) return;
      if (err.type === 'unavailable-id') { void this.host(); return; }
      if (err.type === 'peer-unavailable') return;
      this.fail(err.type === 'network' ? 'The connection service is unavailable. Try again shortly.' : 'The room closed because of a connection error.');
    });
    peer.on('disconnected', () => { if (generation === this.generation && !peer.destroyed) peer.reconnect(); });
  }

  private acceptGuest(conn: DataConnection, generation: number): void {
    let id = '';
    const handshake = setTimeout(() => { if (!id) conn.close(); }, TIMEOUT_MS);
    conn.on('data', raw => {
      if (generation !== this.generation || !raw || typeof raw !== 'object') return;
      this.lastReceived.set(conn, performance.now());
      const msg = raw as GuestMessage;
      if (!id) {
        if (msg.t !== 'hello') return;
        if (msg.version !== PROTOCOL) { this.reject(conn, 'The games are different versions. Refresh the page.'); return; }
        const want = typeof msg.id === 'string' ? msg.id.slice(0, 40) : '';
        if (!want) { conn.close(); return; }
        if (!this.guests.has(want) && this.guests.size >= MAX_PLAYERS - 1) { this.reject(conn, 'This room is full.'); return; }
        clearTimeout(handshake);
        id = want;
        const old = this.guests.get(id);
        if (old && old !== conn) old.close();
        this.guests.set(id, conn);
        conn.send({ t: 'welcome', id } satisfies HostMessage);
        this.onGuestJoin(id, cleanName(msg.name));
        return;
      }
      if (msg.t === 'ping') { conn.send({ t: 'pong' } satisfies HostMessage); return; }
      this.onGuestMessage(id, msg);
    });
    conn.on('close', () => { clearTimeout(handshake); if (id) this.dropGuest(id, conn); });
    conn.on('error', () => { if (id) this.dropGuest(id, conn); });
  }
  private reject(conn: DataConnection, message: string): void {
    conn.send({ t: 'error', message } satisfies HostMessage);
    setTimeout(() => conn.close(), 250);
  }
  private dropGuest(id: string, conn: DataConnection): void {
    this.lastReceived.delete(conn);
    if (this.guests.get(id) !== conn) return;
    this.guests.delete(id);
    this.onGuestLeave(id);
  }

  join(raw: string, id: string, name: string): void {
    const code = normalizeCode(raw);
    if (!validCode(code)) { this.change('error', 'Enter the eight-character room code.'); return; }
    this.stop();
    const generation = ++this.generation;
    this.isHost = false;
    this.code = code;
    this.change('connecting', 'Joining the room…');
    const peer = new Peer(peerOptions());
    this.peer = peer;
    this.timer = setTimeout(() => this.fail('Could not join. Check the code, and check that the host still has the game open.'), TIMEOUT_MS);
    peer.on('open', () => {
      if (generation !== this.generation) return;
      const conn = peer.connect(PREFIX + code, { reliable: true });
      conn.on('open', () => { conn.send({ t: 'hello', version: PROTOCOL, id, name } satisfies GuestMessage); });
      conn.on('data', raw => {
        if (generation !== this.generation || !raw || typeof raw !== 'object') return;
        this.lastReceived.set(conn, performance.now());
        const msg = raw as HostMessage;
        if (msg.t === 'error') { this.fail(typeof msg.message === 'string' ? msg.message.slice(0, 200) : 'Could not join.'); return; }
        if (msg.t === 'welcome') { this.clearTimer(); this.hostConn = conn; this.change('connected', 'Connected.'); }
        if (msg.t === 'pong') return;
        this.onHostMessage(msg);
      });
      conn.on('close', () => { if (generation === this.generation && this.hostConn === conn) this.fail('The host left the room.'); });
      conn.on('error', () => { if (generation === this.generation) this.fail('The connection to the host failed.'); });
    });
    peer.on('error', err => {
      if (generation !== this.generation) return;
      const friendly: Record<string, string> = {
        'peer-unavailable': 'That room is not open. Check the code.',
        network: 'The connection service is unavailable. Try again shortly.',
        'browser-incompatible': 'This browser cannot connect. Try a current Chrome, Edge, Firefox, or Safari.',
      };
      this.fail(friendly[err.type] ?? 'Could not connect. Try again.');
    });
  }

  toHost(msg: GuestMessage): void {
    const conn = this.hostConn;
    if (!conn?.open) return;
    try { conn.send(msg); } catch { this.fail('The connection to the host failed.'); }
  }
  /** Host: send to every guest. Droppable messages are skipped for a guest whose channel is backed up. */
  broadcast(msg: HostMessage, droppable = false): void {
    for (const conn of this.guests.values()) {
      if (!conn.open || (droppable && conn.dataChannel.bufferedAmount > 64000)) continue;
      try { conn.send(msg); } catch { /* the close handler removes the guest */ }
    }
  }

  stop(): void {
    ++this.generation; this.clearTimer();
    for (const c of this.guests.values()) c.close();
    this.guests.clear();
    this.hostConn?.close(); this.hostConn = null;
    this.peer?.destroy(); this.peer = null;
    this.status = 'idle';
  }
  dispose(): void { clearInterval(this.heartbeat); this.stop(); }
}

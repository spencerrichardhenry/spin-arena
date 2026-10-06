import { beforeAll, describe, expect, it } from 'vitest';
import { initPhysics, REST_MECH } from '../src/sim/arena.ts';
import { HostSession } from '../src/session.ts';
import type { GuestMessage } from '../src/net/protocol.ts';
import type { Room } from '../src/net/room.ts';

beforeAll(async () => { await initPhysics(); });

/** A room that only records what the host broadcasts. */
function fakeRoom() {
  const room = {
    sent: [] as unknown[],
    onGuestJoin: (_id: string, _name: string) => {}, onGuestLeave: (_id: string) => {}, onGuestMessage: (_id: string, _m: GuestMessage) => {},
    broadcast(msg: unknown) { this.sent.push(msg); },
  };
  return room;
}

describe('host lobby', () => {
  it('applies ready and name messages, starts when all are ready, and resets ready after the round', () => {
    const room = fakeRoom();
    const host = new HostSession('h', 'Dad', room as unknown as Room);
    room.onGuestJoin('g', 'Ava');
    const ava = () => host.lobby.players.find(p => p.id === 'g')!;
    expect(ava().team).toBe('top');
    expect(host.canStart).toBe(false);
    room.onGuestMessage('g', { t: 'name', name: '<b>Bo</b>' });
    expect(ava().name).toBe('bBob');
    room.onGuestMessage('g', { t: 'ready', ready: true });
    expect(host.canStart).toBe(false); // the host is not ready yet
    host.setReady(true);
    expect(host.canStart).toBe(true);
    host.setName('Papa');
    expect(host.lobby.players[0]!.name).toBe('Papa');
    host.start(0);
    expect(host.lobby.phase).toBe('playing');
    host.backToLobby();
    expect(host.lobby.players.every(p => !p.ready)).toBe(true);
  });
  it('ignores a ready message that is not a boolean', () => {
    const room = fakeRoom();
    const host = new HostSession('h', 'Dad', room as unknown as Room);
    room.onGuestJoin('g', 'Ava');
    room.onGuestMessage('g', { t: 'ready', ready: 'yes' } as unknown as GuestMessage);
    expect(host.lobby.players.find(p => p.id === 'g')!.ready).toBe(false);
    void REST_MECH;
  });
});

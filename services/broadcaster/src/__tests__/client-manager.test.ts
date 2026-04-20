/* eslint-disable @typescript-eslint/unbound-method */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  registerClient,
  removeClient,
  getClientsForAuction,
  updateLastEventId,
  sendToClient,
  broadcast,
  handlePong,
} from "../client-manager.js";
import type { WebSocket } from "ws";

// ---------------------------------------------------------------------------
// Minimal WebSocket mock
// ---------------------------------------------------------------------------

function mockSocket(readyState = 1): WebSocket {
  return {
    readyState,
    send: vi.fn((_data: unknown, cb?: () => void) => cb?.()),
    close: vi.fn(),
  } as unknown as WebSocket;
}

beforeEach(() => {
  // Clear internal state by removing all registered clients
  // (access via getClientsForAuction across all auctions is not exposed,
  //  so we register+remove a sentinel to force a clean slate)
  registerClient("__cleanup__", mockSocket(), "__cleanup__", "0-0");
  removeClient("__cleanup__");
});

describe("registerClient / removeClient", () => {
  it("registers a client and makes it findable", () => {
    const socket = mockSocket();
    registerClient("c1", socket, "auction-1", "0-0");
    const clients = getClientsForAuction("auction-1");
    expect(clients.some((c) => c.id === "c1")).toBe(true);
    removeClient("c1");
  });

  it("removes a client from the registry", () => {
    const socket = mockSocket();
    registerClient("c2", socket, "auction-2", "0-0");
    removeClient("c2");
    const clients = getClientsForAuction("auction-2");
    expect(clients.some((c) => c.id === "c2")).toBe(false);
  });
});

describe("getClientsForAuction", () => {
  it("returns only clients for the given auction", () => {
    registerClient("ca1", mockSocket(), "a1", "0-0");
    registerClient("ca2", mockSocket(), "a2", "0-0");
    const a1clients = getClientsForAuction("a1");
    expect(a1clients.every((c) => c.auctionId === "a1")).toBe(true);
    removeClient("ca1");
    removeClient("ca2");
  });
});

describe("updateLastEventId", () => {
  it("updates the lastEventId on the client", () => {
    registerClient("c3", mockSocket(), "a1", "0-0");
    updateLastEventId("c3", "1712345678-1");
    const clients = getClientsForAuction("a1");
    const c3 = clients.find((c) => c.id === "c3");
    expect(c3?.lastEventId).toBe("1712345678-1");
    removeClient("c3");
  });
});

describe("sendToClient", () => {
  it("calls socket.send with JSON-serialised message", () => {
    const socket = mockSocket();
    const client = registerClient("c4", socket, "a1", "0-0");
    sendToClient(client, { type: "ping", ts: 123 });
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ type: "ping", ts: 123 }),
      expect.any(Function),
    );
    removeClient("c4");
  });

  it("evicts client when queue is full", () => {
    const socket = mockSocket();
    const client = registerClient("c5", socket, "a1", "0-0");
    // Fill the queue past limit without triggering the send callback
    client.queueSize = 500;
    sendToClient(client, { type: "event" });
    expect(socket.close).toHaveBeenCalledWith(1008, "slow_consumer");
    // Client should be removed after eviction
    expect(getClientsForAuction("a1").some((c) => c.id === "c5")).toBe(false);
  });

  it("does not send to a closed socket", () => {
    const socket = mockSocket(3); // CLOSED
    const client = registerClient("c6", socket, "a1", "0-0");
    sendToClient(client, { type: "ping" });
    expect(socket.send).not.toHaveBeenCalled();
    removeClient("c6");
  });
});

describe("broadcast", () => {
  it("sends to all clients for an auction", () => {
    const s1 = mockSocket();
    const s2 = mockSocket();
    registerClient("b1", s1, "bcast-auction", "0-0");
    registerClient("b2", s2, "bcast-auction", "0-0");
    broadcast("bcast-auction", { type: "event", data: "test" });
    expect(s1.send).toHaveBeenCalled();
    expect(s2.send).toHaveBeenCalled();
    removeClient("b1");
    removeClient("b2");
  });
});

describe("handlePong", () => {
  it("resets heartbeat miss counter to 0", () => {
    const client = registerClient("hp1", mockSocket(), "a1", "0-0");
    client.heartbeatMisses = 2;
    handlePong("hp1");
    expect(client.heartbeatMisses).toBe(0);
    removeClient("hp1");
  });
});

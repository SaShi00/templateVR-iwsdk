import { randomUUID } from "node:crypto";

import { WebSocketServer } from "ws";
import type WebSocket from "ws";

import {
  MULTIPLAYER_SERVER_PORT,
  SHARED_OBJECT_IDS,
  type AvatarPoseState,
  type ClientMessage,
  type PeerSnapshot,
  type ServerMessage,
  type SharedObjectId,
  type SharedObjectState,
  isSharedObjectId,
} from "../src/multiplayerProtocol";

interface ConnectedPeer {
  peerId: string;
  socket: WebSocket;
  pose: AvatarPoseState | null;
}

const peers = new Map<string, ConnectedPeer>();
const objectStates = new Map<SharedObjectId, SharedObjectState>();
const objectOwners = new Map<SharedObjectId, string | null>(
  SHARED_OBJECT_IDS.map((objectId) => [objectId, null]),
);

const server = new WebSocketServer({ port: MULTIPLAYER_SERVER_PORT });

const sendMessage = (socket: WebSocket, message: ServerMessage): void => {
  if (socket.readyState !== socket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(message));
};

const broadcastMessage = (
  message: ServerMessage,
  excludedPeerId?: string,
): void => {
  for (const peer of peers.values()) {
    if (peer.peerId === excludedPeerId) {
      continue;
    }

    sendMessage(peer.socket, message);
  }
};

const getPeerSnapshots = (excludedPeerId: string): PeerSnapshot[] =>
  [...peers.values()]
    .filter((peer) => peer.peerId !== excludedPeerId)
    .map((peer) => ({
      peerId: peer.peerId,
      pose: peer.pose,
    }));

const releaseOwnedObjects = (peerId: string): void => {
  for (const objectId of SHARED_OBJECT_IDS) {
    if (objectOwners.get(objectId) !== peerId) {
      continue;
    }

    objectOwners.set(objectId, null);

    const state = objectStates.get(objectId);

    if (state) {
      objectStates.set(objectId, {
        ...state,
        ownerPeerId: null,
        active: false,
        timestamp: Date.now(),
      });
    }

    broadcastMessage({
      type: "object-release",
      objectId,
      timestamp: Date.now(),
    });
  }
};

const rejectGrab = (
  socket: WebSocket,
  objectId: SharedObjectId,
  ownerPeerId: string | null,
): void => {
  if (ownerPeerId) {
    sendMessage(socket, {
      type: "object-grab",
      objectId,
      ownerPeerId,
      timestamp: Date.now(),
    });
  }

  const state = objectStates.get(objectId);

  if (!state) {
    return;
  }

  sendMessage(socket, {
    type: "object-state",
    state,
  });
};

server.on("connection", (socket) => {
  let peerId: string | null = null;

  socket.on("message", (buffer) => {
    let message: ClientMessage;

    try {
      message = JSON.parse(buffer.toString()) as ClientMessage;
    } catch {
      return;
    }

    if (peerId === null) {
      if (message.type !== "hello") {
        return;
      }

      peerId = randomUUID();
      peers.set(peerId, {
        peerId,
        socket,
        pose: null,
      });

      sendMessage(socket, {
        type: "welcome",
        selfPeerId: peerId,
        peers: getPeerSnapshots(peerId),
        objects: [...objectStates.values()],
      });

      broadcastMessage({ type: "peer-joined", peerId }, peerId);
      return;
    }

    const peer = peers.get(peerId);

    if (!peer) {
      return;
    }

    switch (message.type) {
      case "hello":
        return;
      case "avatar-pose": {
        peer.pose = message.pose;
        broadcastMessage(
          {
            type: "avatar-pose",
            peerId,
            pose: message.pose,
          },
          peerId,
        );
        return;
      }
      case "object-grab": {
        if (!isSharedObjectId(message.objectId)) {
          return;
        }

        const existingOwner = objectOwners.get(message.objectId) ?? null;

        if (existingOwner && existingOwner !== peerId) {
          rejectGrab(socket, message.objectId, existingOwner);
          return;
        }

        objectOwners.set(message.objectId, peerId);

        const existingState = objectStates.get(message.objectId);

        if (existingState) {
          objectStates.set(message.objectId, {
            ...existingState,
            ownerPeerId: peerId,
            active: true,
            timestamp: message.timestamp,
          });
        }

        broadcastMessage({
          type: "object-grab",
          objectId: message.objectId,
          ownerPeerId: peerId,
          timestamp: message.timestamp,
        });
        return;
      }
      case "object-state": {
        if (!isSharedObjectId(message.state.objectId)) {
          return;
        }

        const existingOwner = objectOwners.get(message.state.objectId) ?? null;

        if (existingOwner && existingOwner !== peerId) {
          rejectGrab(socket, message.state.objectId, existingOwner);
          return;
        }

        objectOwners.set(message.state.objectId, peerId);

        const nextState: SharedObjectState = {
          ...message.state,
          ownerPeerId: peerId,
        };

        objectStates.set(nextState.objectId, nextState);
        broadcastMessage({ type: "object-state", state: nextState });
        return;
      }
      case "object-release": {
        if (!isSharedObjectId(message.objectId)) {
          return;
        }

        const existingOwner = objectOwners.get(message.objectId) ?? null;
        const existingState = objectStates.get(message.objectId);

        if (existingOwner !== peerId) {
          rejectGrab(socket, message.objectId, existingOwner);
          return;
        }

        objectOwners.set(message.objectId, null);

        if (existingState) {
          objectStates.set(message.objectId, {
            ...existingState,
            ownerPeerId: null,
            active: false,
            timestamp: message.timestamp,
          });
        }

        broadcastMessage({
          type: "object-release",
          objectId: message.objectId,
          timestamp: message.timestamp,
        });
        return;
      }
    }
  });

  socket.on("close", () => {
    if (!peerId) {
      return;
    }

    peers.delete(peerId);
    releaseOwnedObjects(peerId);
    broadcastMessage({ type: "peer-left", peerId }, peerId);
  });
});

console.log(
  `[multiplayer] WebSocket relay listening on ws://0.0.0.0:${MULTIPLAYER_SERVER_PORT}`,
);

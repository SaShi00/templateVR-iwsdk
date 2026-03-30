import {
  Object3D,
  Quaternion,
  Vector3,
  VisibilityState,
  World,
  createSystem,
} from "@iwsdk/core";

import {
  applyRemoteAvatarPose,
  createRemoteAvatar,
  getLocalAvatarColor,
  setRemoteAvatarColor,
  type RemoteAvatarVisual,
} from "./createUserAvatar";
import {
  MULTIPLAYER_PATH,
  type AvatarPoseState,
  type ClientMessage,
  type ServerMessage,
  type SharedObjectId,
  type SharedObjectState,
  type TransformSnapshot,
} from "./multiplayerProtocol";

const AVATAR_SYNC_INTERVAL_MS = 33;
const OBJECT_SYNC_INTERVAL_MS = 33;
const REMOTE_AVATAR_LERP = 0.6;
const POSITION_EPSILON = 0.001;
const QUATERNION_EPSILON = 0.001;
const SCALE_EPSILON = 0.001;

const managersByWorld = new WeakMap<World, MultiplayerManager>();
const initializedWorlds = new WeakSet<World>();

const sumAbsoluteDiff = (
  left: readonly number[],
  right: readonly number[],
): number =>
  left.reduce(
    (total, value, index) => total + Math.abs(value - (right[index] ?? 0)),
    0,
  );

const transformsEqual = (
  left: TransformSnapshot,
  right: TransformSnapshot,
): boolean =>
  sumAbsoluteDiff(left.position, right.position) <= POSITION_EPSILON &&
  sumAbsoluteDiff(left.quaternion, right.quaternion) <= QUATERNION_EPSILON &&
  sumAbsoluteDiff(left.scale, right.scale) <= SCALE_EPSILON;

const cloneTransform = (snapshot: TransformSnapshot): TransformSnapshot => ({
  position: [...snapshot.position] as TransformSnapshot["position"],
  quaternion: [...snapshot.quaternion] as TransformSnapshot["quaternion"],
  scale: [...snapshot.scale] as TransformSnapshot["scale"],
});

const getSocketUrl = (): string => {
  const protocol = globalThis.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${globalThis.location.host}${MULTIPLAYER_PATH}`;
};

export interface NetworkedSharedObject {
  id: SharedObjectId;
  object: Object3D;
  setActive?: (active: boolean) => void;
}

interface TrackedSharedObject extends NetworkedSharedObject {
  ownerPeerId: string | null;
  locallyOwned: boolean;
  localSequence: number;
  lastAppliedSequence: number;
  lastSentAt: number;
  lastObservedTransform: TransformSnapshot;
  lastSentTransform: TransformSnapshot | null;
  lastRemoteState: SharedObjectState | null;
  lastLocalActivityAt: number;
}

interface RemotePeerState {
  avatarColor: number;
  visual: RemoteAvatarVisual;
  targetPose: AvatarPoseState;
  lastSequence: number;
}

class MultiplayerSystem extends createSystem() {
  update(): void {
    managersByWorld.get(this.world)?.update();
  }
}

class MultiplayerManager {
  private socket: WebSocket | null = null;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private selfPeerId: string | null = null;
  private lastAvatarSyncAt = 0;
  private avatarSequence = 0;
  private tempPosition = new Vector3();
  private tempQuaternion = new Quaternion();
  private tempScale = new Vector3();
  private readonly sharedObjects = new Map<
    SharedObjectId,
    TrackedSharedObject
  >();
  private readonly remotePeers = new Map<string, RemotePeerState>();

  constructor(
    private readonly world: World,
    sharedObjects: NetworkedSharedObject[],
  ) {
    for (const sharedObject of sharedObjects) {
      const trackedObject: TrackedSharedObject = {
        ...sharedObject,
        ownerPeerId: null,
        locallyOwned: false,
        localSequence: 0,
        lastAppliedSequence: 0,
        lastSentAt: 0,
        lastObservedTransform: this.readLocalTransform(sharedObject.object),
        lastSentTransform: null,
        lastRemoteState: null,
        lastLocalActivityAt: 0,
      };

      this.sharedObjects.set(sharedObject.id, trackedObject);
      this.bindObjectEvents(trackedObject);
    }

    this.connect();
  }

  update(): void {
    const now = Date.now();

    this.publishLocalAvatar(now);
    this.syncSharedObjects(now);

    for (const remotePeer of this.remotePeers.values()) {
      applyRemoteAvatarPose(
        remotePeer.visual,
        remotePeer.targetPose,
        REMOTE_AVATAR_LERP,
      );
    }
  }

  private connect(): void {
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    const socket = new WebSocket(getSocketUrl());

    socket.addEventListener("open", () => {
      this.socket = socket;
      this.send({
        type: "hello",
        avatarColor: getLocalAvatarColor(this.world),
      });
    });

    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string") {
        return;
      }

      let message: ServerMessage;

      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch {
        return;
      }

      this.handleMessage(message);
    });

    socket.addEventListener("close", () => {
      this.handleDisconnect();
    });

    socket.addEventListener("error", () => {
      socket.close();
    });

    this.socket = socket;
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.selfPeerId = null;
    this.lastAvatarSyncAt = 0;

    for (const trackedObject of this.sharedObjects.values()) {
      trackedObject.ownerPeerId = null;
      trackedObject.locallyOwned = false;
      trackedObject.lastRemoteState = null;
      trackedObject.setActive?.(false);
    }

    this.clearRemotePeers();

    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.reconnectTimeout = setTimeout(() => {
      this.connect();
    }, 1000);
  }

  private clearRemotePeers(): void {
    for (const remotePeer of this.remotePeers.values()) {
      remotePeer.visual.dispose();
    }

    this.remotePeers.clear();
  }

  private send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(message: ServerMessage): void {
    switch (message.type) {
      case "welcome": {
        this.selfPeerId = message.selfPeerId;

        const peerIds = new Set(message.peers.map((peer) => peer.peerId));

        for (const existingPeerId of this.remotePeers.keys()) {
          if (!peerIds.has(existingPeerId)) {
            this.removeRemotePeer(existingPeerId);
          }
        }

        for (const peer of message.peers) {
          if (!peer.pose) {
            if (!this.remotePeers.has(peer.peerId)) {
              this.remotePeers.set(peer.peerId, {
                avatarColor: peer.avatarColor,
                visual: this.createVisualForPeer(peer.peerId, peer.avatarColor),
                targetPose: this.createLocalAvatarPose(Date.now()),
                lastSequence: -1,
              });
            }
            continue;
          }

          this.updateRemotePeerPose(peer.peerId, peer.pose, peer.avatarColor);
        }

        for (const objectState of message.objects) {
          this.applyObjectState(objectState);
        }

        return;
      }
      case "peer-joined": {
        if (
          message.peerId !== this.selfPeerId &&
          !this.remotePeers.has(message.peerId)
        ) {
          this.remotePeers.set(message.peerId, {
            avatarColor: message.avatarColor,
            visual: this.createVisualForPeer(
              message.peerId,
              message.avatarColor,
            ),
            targetPose: this.createLocalAvatarPose(Date.now()),
            lastSequence: -1,
          });
        }

        return;
      }
      case "peer-left": {
        this.removeRemotePeer(message.peerId);
        return;
      }
      case "avatar-pose": {
        if (message.peerId !== this.selfPeerId) {
          this.updateRemotePeerPose(message.peerId, message.pose);
        }

        return;
      }
      case "object-grab": {
        const trackedObject = this.sharedObjects.get(message.objectId);

        if (!trackedObject) {
          return;
        }

        trackedObject.ownerPeerId = message.ownerPeerId;
        trackedObject.locallyOwned = message.ownerPeerId === this.selfPeerId;
        trackedObject.setActive?.(true);

        if (
          trackedObject.lastRemoteState &&
          message.ownerPeerId !== this.selfPeerId
        ) {
          this.applyRemoteTransform(
            trackedObject,
            trackedObject.lastRemoteState.transform,
          );
        }

        return;
      }
      case "object-release": {
        const trackedObject = this.sharedObjects.get(message.objectId);

        if (!trackedObject) {
          return;
        }

        trackedObject.ownerPeerId = null;
        trackedObject.locallyOwned = false;
        trackedObject.setActive?.(false);
        return;
      }
      case "object-state": {
        this.applyObjectState(message.state);
        return;
      }
    }
  }

  private removeRemotePeer(peerId: string): void {
    const remotePeer = this.remotePeers.get(peerId);

    if (!remotePeer) {
      return;
    }

    remotePeer.visual.dispose();
    this.remotePeers.delete(peerId);
  }

  private updateRemotePeerPose(
    peerId: string,
    pose: AvatarPoseState,
    avatarColor?: number,
  ): void {
    let remotePeer = this.remotePeers.get(peerId);

    if (!remotePeer) {
      remotePeer = {
        avatarColor: avatarColor ?? 0x3f7cff,
        visual: this.createVisualForPeer(peerId, avatarColor ?? 0x3f7cff),
        targetPose: pose,
        lastSequence: -1,
      };
      this.remotePeers.set(peerId, remotePeer);
    } else if (
      avatarColor !== undefined &&
      avatarColor !== remotePeer.avatarColor
    ) {
      remotePeer.avatarColor = avatarColor;
      setRemoteAvatarColor(remotePeer.visual, avatarColor);
    }

    if (pose.sequence <= remotePeer.lastSequence) {
      return;
    }

    remotePeer.targetPose = pose;
    remotePeer.lastSequence = pose.sequence;
  }

  private createVisualForPeer(
    peerId: string,
    avatarColor: number,
  ): RemoteAvatarVisual {
    const visual = createRemoteAvatar(this.world);

    visual.root.name = `remote-peer-${peerId}`;
    setRemoteAvatarColor(visual, avatarColor);

    return visual;
  }

  private publishLocalAvatar(now: number): void {
    if (
      !this.selfPeerId ||
      now - this.lastAvatarSyncAt < AVATAR_SYNC_INTERVAL_MS
    ) {
      return;
    }

    this.lastAvatarSyncAt = now;

    this.send({
      type: "avatar-pose",
      pose: this.createLocalAvatarPose(now),
    });
  }

  private createLocalAvatarPose(now: number): AvatarPoseState {
    this.avatarSequence += 1;

    return {
      immersive:
        this.world.visibilityState.peek() !== VisibilityState.NonImmersive,
      head: this.readWorldTransform(this.world.player.head),
      leftHand: this.readWorldTransform(this.world.player.gripSpaces.left),
      rightHand: this.readWorldTransform(this.world.player.gripSpaces.right),
      sequence: this.avatarSequence,
      timestamp: now,
    };
  }

  private syncSharedObjects(now: number): void {
    for (const trackedObject of this.sharedObjects.values()) {
      const currentTransform = this.readLocalTransform(trackedObject.object);
      const changed = !transformsEqual(
        currentTransform,
        trackedObject.lastObservedTransform,
      );

      trackedObject.lastObservedTransform = cloneTransform(currentTransform);

      if (
        trackedObject.ownerPeerId &&
        trackedObject.ownerPeerId !== this.selfPeerId
      ) {
        if (changed && trackedObject.lastRemoteState) {
          this.applyRemoteTransform(
            trackedObject,
            trackedObject.lastRemoteState.transform,
          );
        }

        continue;
      }

      if (trackedObject.locallyOwned) {
        if (
          changed ||
          now - trackedObject.lastSentAt >= OBJECT_SYNC_INTERVAL_MS
        ) {
          this.sendTrackedObjectState(trackedObject, currentTransform, now);
        }

        continue;
      }

      if (!changed) {
        continue;
      }

      trackedObject.lastLocalActivityAt = now;

      if (!this.claimObject(trackedObject, now)) {
        continue;
      }

      this.sendTrackedObjectState(trackedObject, currentTransform, now);
    }
  }

  private claimObject(
    trackedObject: TrackedSharedObject,
    now: number,
  ): boolean {
    if (!this.selfPeerId) {
      return false;
    }

    if (
      trackedObject.ownerPeerId &&
      trackedObject.ownerPeerId !== this.selfPeerId
    ) {
      if (trackedObject.lastRemoteState) {
        this.applyRemoteTransform(
          trackedObject,
          trackedObject.lastRemoteState.transform,
        );
      }

      return false;
    }

    if (trackedObject.locallyOwned) {
      return true;
    }

    trackedObject.ownerPeerId = this.selfPeerId;
    trackedObject.locallyOwned = true;
    trackedObject.lastLocalActivityAt = now;
    trackedObject.setActive?.(true);

    this.send({
      type: "object-grab",
      objectId: trackedObject.id,
      timestamp: now,
    });

    return true;
  }

  private releaseObject(trackedObject: TrackedSharedObject, now: number): void {
    if (
      !trackedObject.locallyOwned ||
      trackedObject.ownerPeerId !== this.selfPeerId
    ) {
      return;
    }

    trackedObject.ownerPeerId = null;
    trackedObject.locallyOwned = false;
    trackedObject.setActive?.(false);

    this.send({
      type: "object-release",
      objectId: trackedObject.id,
      timestamp: now,
    });
  }

  private sendTrackedObjectState(
    trackedObject: TrackedSharedObject,
    transform: TransformSnapshot,
    now: number,
  ): void {
    if (
      trackedObject.lastSentTransform &&
      transformsEqual(transform, trackedObject.lastSentTransform) &&
      now - trackedObject.lastSentAt < OBJECT_SYNC_INTERVAL_MS
    ) {
      return;
    }

    trackedObject.localSequence += 1;
    trackedObject.lastSentAt = now;
    trackedObject.lastSentTransform = cloneTransform(transform);

    this.send({
      type: "object-state",
      state: {
        objectId: trackedObject.id,
        active: trackedObject.locallyOwned,
        transform,
        sequence: trackedObject.localSequence,
        timestamp: now,
      },
    });
  }

  private applyObjectState(state: SharedObjectState): void {
    const trackedObject = this.sharedObjects.get(state.objectId);

    if (!trackedObject || state.sequence < trackedObject.lastAppliedSequence) {
      return;
    }

    trackedObject.lastAppliedSequence = state.sequence;
    trackedObject.lastRemoteState = state;
    trackedObject.ownerPeerId = state.ownerPeerId;
    trackedObject.setActive?.(state.active);

    if (state.ownerPeerId === this.selfPeerId) {
      trackedObject.locallyOwned = true;
      return;
    }

    trackedObject.locallyOwned = false;
    this.applyRemoteTransform(trackedObject, state.transform);
  }

  private applyRemoteTransform(
    trackedObject: TrackedSharedObject,
    transform: TransformSnapshot,
  ): void {
    trackedObject.object.position.set(
      transform.position[0],
      transform.position[1],
      transform.position[2],
    );
    trackedObject.object.quaternion.set(
      transform.quaternion[0],
      transform.quaternion[1],
      transform.quaternion[2],
      transform.quaternion[3],
    );
    trackedObject.object.scale.set(
      transform.scale[0],
      transform.scale[1],
      transform.scale[2],
    );

    trackedObject.lastObservedTransform = this.readLocalTransform(
      trackedObject.object,
    );
  }

  private bindObjectEvents(trackedObject: TrackedSharedObject): void {
    trackedObject.object.addEventListener("pointerdown", () => {
      this.claimObject(trackedObject, Date.now());
    });

    trackedObject.object.addEventListener("pointerup", () => {
      this.releaseObject(trackedObject, Date.now());
    });

    trackedObject.object.addEventListener("pointercancel", () => {
      this.releaseObject(trackedObject, Date.now());
    });
  }

  private readWorldTransform(object: Object3D): TransformSnapshot {
    object.getWorldPosition(this.tempPosition);
    object.getWorldQuaternion(this.tempQuaternion);
    object.getWorldScale(this.tempScale);

    return {
      position: [this.tempPosition.x, this.tempPosition.y, this.tempPosition.z],
      quaternion: [
        this.tempQuaternion.x,
        this.tempQuaternion.y,
        this.tempQuaternion.z,
        this.tempQuaternion.w,
      ],
      scale: [this.tempScale.x, this.tempScale.y, this.tempScale.z],
    };
  }

  private readLocalTransform(object: Object3D): TransformSnapshot {
    return {
      position: [object.position.x, object.position.y, object.position.z],
      quaternion: [
        object.quaternion.x,
        object.quaternion.y,
        object.quaternion.z,
        object.quaternion.w,
      ],
      scale: [object.scale.x, object.scale.y, object.scale.z],
    };
  }
}

export function enableMultiplayer(
  world: World,
  sharedObjects: NetworkedSharedObject[],
): void {
  managersByWorld.set(world, new MultiplayerManager(world, sharedObjects));

  if (!initializedWorlds.has(world)) {
    world.registerSystem(MultiplayerSystem, { priority: 5 });
    initializedWorlds.add(world);
  }
}

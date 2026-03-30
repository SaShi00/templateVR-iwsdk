export const MULTIPLAYER_PATH = "/multiplayer";
export const MULTIPLAYER_SERVER_PORT = 8787;
export const SHARED_OBJECT_IDS = ["model", "arrow"] as const;

export type SharedObjectId = (typeof SHARED_OBJECT_IDS)[number];
export type Vector3Tuple = [number, number, number];
export type QuaternionTuple = [number, number, number, number];

export interface TransformSnapshot {
  position: Vector3Tuple;
  quaternion: QuaternionTuple;
  scale: Vector3Tuple;
}

export interface AvatarPoseState {
  immersive: boolean;
  head: TransformSnapshot;
  leftHand: TransformSnapshot;
  rightHand: TransformSnapshot;
  sequence: number;
  timestamp: number;
}

export interface SharedObjectState {
  objectId: SharedObjectId;
  ownerPeerId: string | null;
  active: boolean;
  transform: TransformSnapshot;
  sequence: number;
  timestamp: number;
}

export interface PeerSnapshot {
  peerId: string;
  pose: AvatarPoseState | null;
}

export interface HelloMessage {
  type: "hello";
}

export interface WelcomeMessage {
  type: "welcome";
  selfPeerId: string;
  peers: PeerSnapshot[];
  objects: SharedObjectState[];
}

export interface PeerJoinedMessage {
  type: "peer-joined";
  peerId: string;
}

export interface PeerLeftMessage {
  type: "peer-left";
  peerId: string;
}

export interface AvatarPoseMessage {
  type: "avatar-pose";
  peerId: string;
  pose: AvatarPoseState;
}

export interface ClientObjectStateMessage {
  type: "object-state";
  state: Omit<SharedObjectState, "ownerPeerId">;
}

export interface ServerObjectStateMessage {
  type: "object-state";
  state: SharedObjectState;
}

export interface ClientObjectGrabMessage {
  type: "object-grab";
  objectId: SharedObjectId;
  timestamp: number;
}

export interface ServerObjectGrabMessage {
  type: "object-grab";
  objectId: SharedObjectId;
  ownerPeerId: string;
  timestamp: number;
}

export interface ClientObjectReleaseMessage {
  type: "object-release";
  objectId: SharedObjectId;
  timestamp: number;
}

export interface ServerObjectReleaseMessage {
  type: "object-release";
  objectId: SharedObjectId;
  timestamp: number;
}

export type ClientMessage =
  | HelloMessage
  | {
      type: "avatar-pose";
      pose: AvatarPoseState;
    }
  | ClientObjectStateMessage
  | ClientObjectGrabMessage
  | ClientObjectReleaseMessage;

export type ServerMessage =
  | WelcomeMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | AvatarPoseMessage
  | ServerObjectStateMessage
  | ServerObjectGrabMessage
  | ServerObjectReleaseMessage;

export const isSharedObjectId = (value: string): value is SharedObjectId =>
  (SHARED_OBJECT_IDS as readonly string[]).includes(value);

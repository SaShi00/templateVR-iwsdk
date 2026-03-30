import {
  CylinderGeometry,
  Euler,
  Group,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  Vector3,
  VisibilityState,
  World,
  createSystem,
} from "@iwsdk/core";

import type { AvatarPoseState } from "./multiplayerProtocol";

const BODY_COLOR = 0x3f7cff;
const AVATAR_COLOR_PALETTE = [
  0x3f7cff, 0xef476f, 0x06d6a0, 0xff9f1c, 0x118ab2, 0x8d5cf6, 0xf4a261,
  0xe63946,
] as const;
const BODY_RADIUS = 0.16;
const BODY_HEIGHT = 0.62;
const BODY_CENTER_Y_OFFSET = -0.72;
const LOCAL_BODY_BACK_OFFSET = 0.18;
const HIDDEN_SCALE = new Vector3(0.0001, 0.0001, 0.0001);
const VISIBLE_SCALE = new Vector3(1, 1, 1);
const REMOTE_YAW_EULER = new Euler(0, 0, 0, "YXZ");
const REMOTE_QUATERNION = new Quaternion();
const REMOTE_POSITION = new Vector3();

const avatarRootsByWorld = new WeakMap<
  World,
  {
    avatarColor: number;
    bodyRoot: Group;
  }
>();
const initializedWorlds = new WeakSet<World>();

const getPaletteColor = (seed: number): number =>
  AVATAR_COLOR_PALETTE[seed % AVATAR_COLOR_PALETTE.length];

const getRandomAvatarColor = (): number =>
  getPaletteColor(Math.floor(Math.random() * AVATAR_COLOR_PALETTE.length));

class UserAvatarSystem extends createSystem() {
  private bodyYaw = new Euler(0, 0, 0, "YXZ");
  private bodyOffset = new Vector3();

  update(): void {
    const avatarRoots = avatarRootsByWorld.get(this.world);

    if (!avatarRoots) {
      return;
    }

    const { bodyRoot } = avatarRoots;
    const isImmersive =
      this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const head = this.world.player.head;
    const headPosition = head.position;

    bodyRoot.scale.copy(isImmersive ? VISIBLE_SCALE : HIDDEN_SCALE);

    this.bodyYaw.setFromQuaternion(head.quaternion);
    this.bodyYaw.x = 0;
    this.bodyYaw.z = 0;

    this.bodyOffset.set(0, 0, LOCAL_BODY_BACK_OFFSET).applyEuler(this.bodyYaw);
    bodyRoot.position.set(
      headPosition.x + this.bodyOffset.x,
      Math.max(0.55, headPosition.y + BODY_CENTER_Y_OFFSET),
      headPosition.z + this.bodyOffset.z,
    );
    bodyRoot.rotation.copy(this.bodyYaw);
  }
}

const createMaterial = (color: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color });

const createBodyRoot = (color: number): Group => {
  const root = new Group();
  const torso = new Mesh(
    new CylinderGeometry(BODY_RADIUS, BODY_RADIUS, BODY_HEIGHT, 20),
    createMaterial(color),
  );

  root.add(torso);

  return root;
};

const attachUserAvatar = (world: World): void => {
  const avatarColor = getRandomAvatarColor();
  const bodyRoot = createBodyRoot(avatarColor);

  world.player.add(bodyRoot);
  avatarRootsByWorld.set(world, { avatarColor, bodyRoot });
};

export function createUserAvatar(world: World): void {
  attachUserAvatar(world);

  if (!initializedWorlds.has(world)) {
    world.registerSystem(UserAvatarSystem, { priority: 2 });
    initializedWorlds.add(world);
  }
}

export function getLocalAvatarColor(world: World): number {
  return avatarRootsByWorld.get(world)?.avatarColor ?? BODY_COLOR;
}

export interface RemoteAvatarVisual {
  root: Group;
  bodyRoot: Group;
  dispose: () => void;
}

const setVisualScale = (
  visual: RemoteAvatarVisual,
  immersive: boolean,
): void => {
  visual.bodyRoot.scale.copy(immersive ? VISIBLE_SCALE : HIDDEN_SCALE);
};

export function createRemoteAvatar(world: World): RemoteAvatarVisual {
  const root = new Group();
  const bodyRoot = createBodyRoot(BODY_COLOR);
  const entity = world.createTransformEntity(root, { persistent: true });

  root.add(bodyRoot);

  return {
    root,
    bodyRoot,
    dispose(): void {
      entity.dispose();
    },
  };
}

export function applyRemoteAvatarPose(
  visual: RemoteAvatarVisual,
  pose: AvatarPoseState,
  alpha = 1,
): void {
  const headPosition = pose.head.position;
  const headQuaternion = pose.head.quaternion;

  setVisualScale(visual, pose.immersive);

  REMOTE_POSITION.set(
    headPosition[0],
    Math.max(0.55, headPosition[1] + BODY_CENTER_Y_OFFSET),
    headPosition[2],
  );
  visual.bodyRoot.position.lerp(REMOTE_POSITION, alpha);

  REMOTE_QUATERNION.set(
    headQuaternion[0],
    headQuaternion[1],
    headQuaternion[2],
    headQuaternion[3],
  );
  REMOTE_YAW_EULER.setFromQuaternion(REMOTE_QUATERNION);
  REMOTE_YAW_EULER.x = 0;
  REMOTE_YAW_EULER.z = 0;
  visual.bodyRoot.rotation.y = REMOTE_YAW_EULER.y;
}

export function setRemoteAvatarColor(
  visual: RemoteAvatarVisual,
  color: number,
): void {
  visual.bodyRoot.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      if (material instanceof MeshBasicMaterial) {
        material.color.setHex(color);
      }
    }
  });
}

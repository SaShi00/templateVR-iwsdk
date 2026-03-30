import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TorusGeometry,
  Vector3,
  VisibilityState,
  World,
  Euler,
  Quaternion,
  createSystem,
} from "@iwsdk/core";

import type { AvatarPoseState } from "./multiplayerProtocol";

const BODY_COLOR = 0x3f7cff;
const HEAD_COLOR = 0xf4d35e;
const LEFT_HAND_COLOR = 0x2ec4b6;
const RIGHT_HAND_COLOR = 0xff7f50;

const HIDDEN_SCALE = new Vector3(0.0001, 0.0001, 0.0001);
const VISIBLE_SCALE = new Vector3(1, 1, 1);
const REMOTE_HEAD_OFFSET = new Vector3(0, 0.12, -0.12);
const REMOTE_YAW_EULER = new Euler(0, 0, 0, "YXZ");
const REMOTE_UPRIGHT_ROTATION = new Quaternion();
const REMOTE_OFFSET = new Vector3();

const avatarRootsByWorld = new WeakMap<
  World,
  {
    bodyRoot: Group;
    headHalo: Group;
    handRoots: Group[];
  }
>();
const initializedWorlds = new WeakSet<World>();

class UserAvatarSystem extends createSystem() {
  private bodyYaw = new Euler(0, 0, 0, "YXZ");
  private uprightRotation = new Quaternion();

  update(): void {
    const avatarRoots = avatarRootsByWorld.get(this.world);

    if (!avatarRoots) {
      return;
    }

    const { bodyRoot, headHalo, handRoots } = avatarRoots;
    const isImmersive =
      this.world.visibilityState.peek() !== VisibilityState.NonImmersive;

    const targetScale = isImmersive ? VISIBLE_SCALE : HIDDEN_SCALE;
    bodyRoot.scale.copy(targetScale);
    headHalo.scale.copy(targetScale);

    for (const handRoot of handRoots) {
      handRoot.scale.copy(targetScale);
    }

    const head = this.world.player.head;
    const headPosition = head.position;

    bodyRoot.position.set(
      headPosition.x,
      Math.max(0.85, headPosition.y - 0.55),
      headPosition.z,
    );

    this.bodyYaw.setFromQuaternion(head.quaternion);
    this.bodyYaw.x = 0;
    this.bodyYaw.z = 0;
    bodyRoot.rotation.copy(this.bodyYaw);

    headHalo.position.set(0, 0.12, -0.12);
    this.uprightRotation.setFromEuler(this.bodyYaw.set(0, 0, Math.PI / 2));
    headHalo.quaternion.copy(this.uprightRotation);
  }
}

const createMaterial = (color: number): MeshBasicMaterial =>
  new MeshBasicMaterial({ color });

const createBodyRoot = (): Group => {
  const root = new Group();
  const torso = new Mesh(
    new CylinderGeometry(0.2, 0.24, 0.62, 20),
    createMaterial(BODY_COLOR),
  );
  torso.position.y = -0.14;

  const hips = new Mesh(
    new SphereGeometry(0.18, 18, 18),
    createMaterial(BODY_COLOR),
  );
  hips.position.y = -0.45;

  root.add(torso);
  root.add(hips);

  return root;
};

const createHeadHalo = (): Group => {
  const halo = new Group();
  const ring = new Mesh(
    new TorusGeometry(0.12, 0.018, 12, 24),
    createMaterial(HEAD_COLOR),
  );

  halo.add(ring);
  return halo;
};

const createHandRoot = (color: number): Group => {
  const root = new Group();
  const palm = new Mesh(
    new SphereGeometry(0.055, 16, 16),
    createMaterial(color),
  );
  const pointer = new Mesh(
    new CylinderGeometry(0.014, 0.02, 0.14, 14),
    createMaterial(color),
  );

  pointer.rotation.x = Math.PI / 2;
  pointer.position.z = -0.08;

  root.add(palm);
  root.add(pointer);

  return root;
};

const attachUserAvatar = (world: World): void => {
  const bodyRoot = createBodyRoot();
  const headHalo = createHeadHalo();
  const leftHandRoot = createHandRoot(LEFT_HAND_COLOR);
  const rightHandRoot = createHandRoot(RIGHT_HAND_COLOR);

  world.player.add(bodyRoot);
  world.player.head.add(headHalo);
  world.player.gripSpaces.left.add(leftHandRoot);
  world.player.gripSpaces.right.add(rightHandRoot);

  avatarRootsByWorld.set(world, {
    bodyRoot,
    headHalo,
    handRoots: [leftHandRoot, rightHandRoot],
  });
};

export function createUserAvatar(world: World): void {
  attachUserAvatar(world);

  if (!initializedWorlds.has(world)) {
    world.registerSystem(UserAvatarSystem, { priority: 2 });
    initializedWorlds.add(world);
  }
}

export interface RemoteAvatarVisual {
  root: Group;
  bodyRoot: Group;
  headHalo: Group;
  handRoots: {
    left: Group;
    right: Group;
  };
  dispose: () => void;
}

const setVisualScale = (
  visual: RemoteAvatarVisual,
  immersive: boolean,
): void => {
  const targetScale = immersive ? VISIBLE_SCALE : HIDDEN_SCALE;

  visual.bodyRoot.scale.copy(targetScale);
  visual.headHalo.scale.copy(targetScale);
  visual.handRoots.left.scale.copy(targetScale);
  visual.handRoots.right.scale.copy(targetScale);
};

const lerpTuple3 = (
  target: Vector3,
  next: AvatarPoseState["head"]["position"],
  alpha: number,
): void => {
  target.lerp(new Vector3(next[0], next[1], next[2]), alpha);
};

const slerpTuple4 = (
  target: Quaternion,
  next: AvatarPoseState["head"]["quaternion"],
  alpha: number,
): void => {
  target.slerp(new Quaternion(next[0], next[1], next[2], next[3]), alpha);
};

export function createRemoteAvatar(world: World): RemoteAvatarVisual {
  const root = new Group();
  const bodyRoot = createBodyRoot();
  const headHalo = createHeadHalo();
  const leftHandRoot = createHandRoot(LEFT_HAND_COLOR);
  const rightHandRoot = createHandRoot(RIGHT_HAND_COLOR);
  const entity = world.createTransformEntity(root, { persistent: true });

  root.add(bodyRoot);
  root.add(headHalo);
  root.add(leftHandRoot);
  root.add(rightHandRoot);

  return {
    root,
    bodyRoot,
    headHalo,
    handRoots: {
      left: leftHandRoot,
      right: rightHandRoot,
    },
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
  const headPosition = new Vector3(
    pose.head.position[0],
    pose.head.position[1],
    pose.head.position[2],
  );
  const headQuaternion = new Quaternion(
    pose.head.quaternion[0],
    pose.head.quaternion[1],
    pose.head.quaternion[2],
    pose.head.quaternion[3],
  );

  setVisualScale(visual, pose.immersive);

  visual.bodyRoot.position.lerp(
    new Vector3(
      headPosition.x,
      Math.max(0.85, headPosition.y - 0.55),
      headPosition.z,
    ),
    alpha,
  );

  REMOTE_YAW_EULER.setFromQuaternion(headQuaternion);
  REMOTE_YAW_EULER.x = 0;
  REMOTE_YAW_EULER.z = 0;
  REMOTE_UPRIGHT_ROTATION.setFromEuler(REMOTE_YAW_EULER.set(0, 0, Math.PI / 2));

  visual.bodyRoot.rotation.y = REMOTE_YAW_EULER.y;

  REMOTE_OFFSET.copy(REMOTE_HEAD_OFFSET).applyQuaternion(headQuaternion);
  visual.headHalo.position.lerp(headPosition.clone().add(REMOTE_OFFSET), alpha);
  visual.headHalo.quaternion.slerp(REMOTE_UPRIGHT_ROTATION, alpha);

  lerpTuple3(visual.handRoots.left.position, pose.leftHand.position, alpha);
  slerpTuple4(
    visual.handRoots.left.quaternion,
    pose.leftHand.quaternion,
    alpha,
  );
  lerpTuple3(visual.handRoots.right.position, pose.rightHand.position, alpha);
  slerpTuple4(
    visual.handRoots.right.quaternion,
    pose.rightHand.quaternion,
    alpha,
  );
}

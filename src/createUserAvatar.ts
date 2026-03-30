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

const BODY_COLOR = 0x3f7cff;
const HEAD_COLOR = 0xf4d35e;
const LEFT_HAND_COLOR = 0x2ec4b6;
const RIGHT_HAND_COLOR = 0xff7f50;

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
  private hiddenScale = new Vector3(0.0001, 0.0001, 0.0001);
  private visibleScale = new Vector3(1, 1, 1);
  private uprightRotation = new Quaternion();

  update(): void {
    const avatarRoots = avatarRootsByWorld.get(this.world);

    if (!avatarRoots) {
      return;
    }

    const { bodyRoot, headHalo, handRoots } = avatarRoots;
    const isImmersive =
      this.world.visibilityState.peek() !== VisibilityState.NonImmersive;

    const targetScale = isImmersive ? this.visibleScale : this.hiddenScale;
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

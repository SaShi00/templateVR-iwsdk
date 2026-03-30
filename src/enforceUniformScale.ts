import { Object3D, World, createSystem } from "@iwsdk/core";

const trackedObjectsByWorld = new WeakMap<World, Set<Object3D>>();
const initializedWorlds = new WeakSet<World>();

const getTrackedObjects = (world: World): Set<Object3D> => {
  let trackedObjects = trackedObjectsByWorld.get(world);

  if (!trackedObjects) {
    trackedObjects = new Set<Object3D>();
    trackedObjectsByWorld.set(world, trackedObjects);
  }

  return trackedObjects;
};

const getUniformScaleValue = (object: Object3D): number => {
  const dominantScale = Math.max(
    Math.abs(object.scale.x),
    Math.abs(object.scale.y),
    Math.abs(object.scale.z),
  );

  return Math.max(Number.EPSILON, dominantScale);
};

const normalizeScale = (object: Object3D): void => {
  const uniformScale = getUniformScaleValue(object);

  if (
    object.scale.x === uniformScale &&
    object.scale.y === uniformScale &&
    object.scale.z === uniformScale
  ) {
    return;
  }

  object.scale.set(uniformScale, uniformScale, uniformScale);
};

class UniformScaleSystem extends createSystem() {
  update(): void {
    const trackedObjects = trackedObjectsByWorld.get(this.world);

    if (!trackedObjects) {
      return;
    }

    for (const object of trackedObjects) {
      normalizeScale(object);
    }
  }
}

export function enforceUniformScale(world: World, object: Object3D): void {
  getTrackedObjects(world).add(object);

  if (!initializedWorlds.has(world)) {
    world.registerSystem(UniformScaleSystem, { priority: 1 });
    initializedWorlds.add(world);
  }

  normalizeScale(object);
}

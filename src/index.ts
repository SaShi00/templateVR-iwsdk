import {
  AssetManifest,
  AssetType,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  SRGBColorSpace,
  AssetManager,
  World,
} from "@iwsdk/core";

import {
  AudioSource,
  DistanceGrabbable,
  MovementMode,
  Interactable,
  PanelUI,
  PlaybackMode,
  ScreenSpace,
} from "@iwsdk/core";

import { EnvironmentType, LocomotionEnvironment } from "@iwsdk/core";

import { createPointingArrow } from "./createPointingArrow";
import { createUserAvatar } from "./createUserAvatar";
import { enableMultiplayer } from "./enableMultiplayer";
import { enforceUniformScale } from "./enforceUniformScale";

const assets: AssetManifest = {
  environmentDesk: {
    url: "./gltf/environmentDesk/environmentDesk.gltf",
    type: AssetType.GLTF,
    priority: "critical",
  },

  model: {
    url: "./model.glb",
    type: AssetType.GLTF,
    priority: "critical",
  },
};

World.create(document.getElementById("scene-container") as HTMLDivElement, {
  assets,
  xr: {
    sessionMode: SessionMode.ImmersiveVR,
    offer: "always",
    // Optional structured features; layers/local-floor are offered by default
    features: { handTracking: true, layers: true },
  },
  features: {
    locomotion: { useWorker: true },
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  const { camera } = world;

  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  createUserAvatar(world);

  const { scene: envMesh } = AssetManager.getGLTF("environmentDesk")!;
  envMesh.rotateY(Math.PI);
  envMesh.position.set(0, -0.1, 0);
  world
    .createTransformEntity(envMesh)
    .addComponent(LocomotionEnvironment, { type: EnvironmentType.STATIC });

  const { scene: modelMesh } = AssetManager.getGLTF("model")!;

  modelMesh.position.set(0, 1.5, -1.8);
  modelMesh.name = "shared-model";
  enforceUniformScale(world, modelMesh);

  world.createTransformEntity(modelMesh).addComponent(DistanceGrabbable, {
    movementMode: MovementMode.MoveFromTarget,
  });

  const arrowController = createPointingArrow();
  const arrowMesh = arrowController.root;
  arrowMesh.name = "shared-arrow";
  arrowMesh.position.set(-1.3, 1, -2);

  world.createTransformEntity(arrowMesh).addComponent(DistanceGrabbable, {
    movementMode: MovementMode.MoveFromTarget,
    rotate: true,
    scale: true,
  });

  enableMultiplayer(world, [
    {
      id: "model",
      object: modelMesh,
    },
    {
      id: "arrow",
      object: arrowMesh,
      setActive: arrowController.setActive,
    },
  ]);
});

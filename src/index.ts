import {
  AssetManifest,
  AssetType,
  CanvasTexture,
  InputComponent,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SessionMode,
  AssetManager,
  World,
  createSystem,
} from "@iwsdk/core";

import {
  AudioSource,
  DistanceGrabbable,
  LocomotionSystem,
  MovementMode,
  TeleportSystem,
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

const CAMERA_VERTICAL_SPEED = 3;
const THUMBSTICK_DEADZONE = 0.1;

type InternalLocomotionSystem = {
  locomotor?: {
    position: {
      y: number;
    };
    targetPosition?: {
      y: number;
    };
    engine?: {
      gravity: number;
      playerPosition: {
        y: number;
      };
      playerVelocity?: {
        y: number;
      };
      isGrounded?: boolean;
    };
  };
};

const getLocomotionSystem = (
  world: World,
): InternalLocomotionSystem | undefined => {
  return (
    world as unknown as {
      getSystem: (system: typeof LocomotionSystem) => unknown;
    }
  ).getSystem(LocomotionSystem) as InternalLocomotionSystem | undefined;
};

const getVerticalThumbstickInput = (world: World): number => {
  const rightGamepad = world.input.gamepads.right;

  if (rightGamepad?.getButtonPressed(InputComponent.Squeeze)) {
    const rightAxes = rightGamepad.getAxesValues(InputComponent.Thumbstick);

    if (rightAxes && Math.abs(rightAxes.y) > THUMBSTICK_DEADZONE) {
      return -rightAxes.y;
    }
  }

  return 0;
};

class VerticalControllerMovementSystem extends createSystem() {
  private teleportDisabled = false;
  private lockedHeight: number | null = null;

  update(delta: number): void {
    if (!this.teleportDisabled) {
      const teleportSystem = (
        this.world as unknown as {
          getSystem: (system: typeof TeleportSystem) => unknown;
          unregisterSystem: (system: typeof TeleportSystem) => void;
        }
      ).getSystem(TeleportSystem);

      if (teleportSystem) {
        (
          this.world as unknown as {
            unregisterSystem: (system: typeof TeleportSystem) => void;
          }
        ).unregisterSystem(TeleportSystem);
        this.teleportDisabled = true;
      }
    }

    const verticalInput = getVerticalThumbstickInput(this.world);
    const locomotionSystem = getLocomotionSystem(this.world);
    const locomotor = locomotionSystem?.locomotor;
    const engine = locomotor?.engine;

    if (engine) {
      engine.gravity = 0;
    }

    if (!locomotor) {
      this.lockedHeight = null;
      return;
    }

    if (verticalInput !== 0) {
      const heightDelta = verticalInput * CAMERA_VERTICAL_SPEED * delta;
      const nextHeight = locomotor.position.y + heightDelta;

      this.lockedHeight = nextHeight;
    }

    if (this.lockedHeight === null) {
      this.lockedHeight = locomotor.position.y;
    }

    locomotor.position.y = this.lockedHeight;

    if (locomotor.targetPosition) {
      locomotor.targetPosition.y = this.lockedHeight;
    }

    if (engine) {
      engine.playerPosition.y = this.lockedHeight;

      if (engine.playerVelocity) {
        engine.playerVelocity.y = 0;
      }

      if (engine.isGrounded !== undefined) {
        engine.isGrounded = false;
      }
    }

    this.world.player.position.y = this.lockedHeight;
  }
}

const createFloorGridTexture = (): CanvasTexture => {
  const canvas = document.createElement("canvas");
  const size = 1024;
  const divisions = 20;
  const step = size / divisions;
  const context = canvas.getContext("2d");

  canvas.width = size;
  canvas.height = size;

  if (!context) {
    throw new Error("Failed to create floor grid texture");
  }

  context.fillStyle = "#c8c2b5";
  context.fillRect(0, 0, size, size);

  for (let index = 0; index <= divisions; index += 1) {
    const offset = Math.round(index * step);
    const isMajorLine = index % 5 === 0;

    context.strokeStyle = isMajorLine ? "#7b766d" : "#9c968b";
    context.lineWidth = isMajorLine ? 3 : 1;

    context.beginPath();
    context.moveTo(offset, 0);
    context.lineTo(offset, size);
    context.stroke();

    context.beginPath();
    context.moveTo(0, offset);
    context.lineTo(size, offset);
    context.stroke();
  }

  return new CanvasTexture(canvas);
};

const assets: AssetManifest = {
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
    locomotion: { useWorker: false },
    grabbing: true,
    physics: false,
    sceneUnderstanding: false,
    environmentRaycast: false,
  },
}).then((world) => {
  const { camera } = world;

  camera.position.set(-4, 1.5, -6);
  camera.rotateY(-Math.PI * 0.75);

  world.registerSystem(VerticalControllerMovementSystem, { priority: 6 });

  createUserAvatar(world);

  const floorTexture = createFloorGridTexture();

  const floorMesh = new Mesh(
    new PlaneGeometry(40, 40),
    new MeshBasicMaterial({ map: floorTexture }),
  );
  floorMesh.name = "ground-floor";
  floorMesh.rotation.x = -Math.PI / 2;
  floorMesh.position.y = 0;

  world
    .createTransformEntity(floorMesh)
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

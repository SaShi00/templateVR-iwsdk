import {
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  Object3D,
} from "@iwsdk/core";

const ARROW_IDLE_COLOR = 0xff0000;
const ARROW_ACTIVE_COLOR = 0x0000ff;

const setArrowColor = (object: Object3D, colorHex: number): void => {
  object.traverse((child) => {
    if (!(child instanceof Mesh)) {
      return;
    }

    const materials = Array.isArray(child.material)
      ? child.material
      : [child.material];

    for (const material of materials) {
      if (material instanceof MeshBasicMaterial) {
        material.color.setHex(colorHex);
      }
    }
  });
};

const createArrowVisual = (): Object3D => {
  const root = new Group();
  const visual = new Group();
  const material = new MeshBasicMaterial({ color: ARROW_IDLE_COLOR });

  const shaft = new Mesh(new CylinderGeometry(0.025, 0.025, 0.5, 18), material);
  shaft.position.y = -0.1;

  const tip = new Mesh(new ConeGeometry(0.07, 0.2, 18), material);
  tip.position.y = 0.25;

  visual.add(shaft);
  visual.add(tip);
  visual.rotation.x = -Math.PI / 2;

  root.add(visual);

  return root;
};

export function createPointingArrow(): Object3D {
  const arrow = createArrowVisual();

  arrow.addEventListener("pointerdown", () => {
    setArrowColor(arrow, ARROW_ACTIVE_COLOR);
  });

  arrow.addEventListener("pointerup", () => {
    setArrowColor(arrow, ARROW_IDLE_COLOR);
  });

  arrow.addEventListener("pointercancel", () => {
    setArrowColor(arrow, ARROW_IDLE_COLOR);
  });

  return arrow;
}

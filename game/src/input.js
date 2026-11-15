// DUSTLINE — threejs-fps-02
// Tanpa dependensi three: hanya DOM, keyboard, dan mouse.

export function createInput(canvas, callbacks = {}) {
  const keys = new Set();
  let lookX = 0;
  let lookY = 0;
  let leftHeld = false;
  let rightHeld = false;

  function isLocked() {
    return document.pointerLockElement === canvas;
  }

  function onKeyDown(e) {
    if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (callbacks.onKey) callbacks.onKey(e.code);
  }

  function onKeyUp(e) {
    keys.delete(e.code);
  }

  function onMouseMove(e) {
    if (!isLocked()) return;
    lookX += e.movementX || 0;
    lookY += e.movementY || 0;
  }

  function onMouseDown(e) {
    if (!isLocked()) return;
    if (e.button === 0) leftHeld = true;
    if (e.button === 2) rightHeld = true;
  }

  function onMouseUp(e) {
    if (e.button === 0) leftHeld = false;
    if (e.button === 2) rightHeld = false;
  }

  function onLockChange() {
    if (!isLocked()) {
      leftHeld = false;
      rightHeld = false;
    }
    if (callbacks.onLockChange) callbacks.onLockChange(isLocked());
  }

  function onClick() {
    if (isLocked()) return;
    try {
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch (err) {
      // Pointer lock ditolak (mis. terlalu cepat diklik ulang): abaikan,
      // klik berikutnya akan mencoba lagi.
    }
  }

  function onContextMenu(e) {
    e.preventDefault();
  }

  function onBlur() {
    keys.clear();
    leftHeld = false;
    rightHeld = false;
  }

  canvas.addEventListener('click', onClick);
  canvas.addEventListener('contextmenu', onContextMenu);
  document.addEventListener('keydown', onKeyDown);
  document.addEventListener('keyup', onKeyUp);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mouseup', onMouseUp);
  document.addEventListener('pointerlockchange', onLockChange);
  window.addEventListener('blur', onBlur);

  function consumeLook() {
    const out = { dx: lookX, dy: lookY };
    lookX = 0;
    lookY = 0;
    return out;
  }

  function move() {
    const fwd = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0)
      - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
    const strafe = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0)
      - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    const jump = keys.has('Space');
    return { forward: fwd, strafe, crouch, jump };
  }

  function walkHeld() {
    return keys.has('ShiftLeft') || keys.has('ShiftRight');
  }

  function dispose() {
    canvas.removeEventListener('click', onClick);
    canvas.removeEventListener('contextmenu', onContextMenu);
    document.removeEventListener('keydown', onKeyDown);
    document.removeEventListener('keyup', onKeyUp);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseup', onMouseUp);
    document.removeEventListener('pointerlockchange', onLockChange);
    window.removeEventListener('blur', onBlur);
    keys.clear();
    leftHeld = false;
    rightHeld = false;
    lookX = 0;
    lookY = 0;
  }

  return {
    keys,
    get firing() { return leftHeld && isLocked(); },
    get aiming() { return rightHeld && isLocked(); },
    get locked() { return isLocked(); },
    consumeLook,
    move,
    walkHeld,
    dispose,
  };
}

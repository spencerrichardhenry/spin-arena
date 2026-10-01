import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MechKit } from '../sim/rules.ts';
import type { TopLook } from '../net/protocol.ts';
import { applyKit, makeMech, makeTop } from './models.ts';

/** A small turntable in the lobby that shows your mech kit or your top. */
export class Preview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(35, 1.3, 0.1, 50);
  private turntable = new THREE.Group();
  private key = '';
  private generation = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
    this.renderer.setSize(canvas.width, canvas.height, false);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.6;
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x302838, 1.4));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(3, 5, 4);
    this.scene.add(key, this.turntable);
  }

  /** Shows a mech with a kit, or a top with a look. Unchanged requests do nothing. */
  show(what: { mech: MechKit } | { top: TopLook }): void {
    const key = JSON.stringify(what);
    if (key === this.key) return;
    this.key = key;
    const generation = ++this.generation;
    const make = 'mech' in what ? makeMech().then(m => { applyKit(m, what.mech); return m; }) : makeTop(what.top);
    void make.then(obj => {
      if (generation !== this.generation) return;
      this.turntable.clear();
      this.turntable.add(obj);
      const mech = 'mech' in what;
      this.camera.position.set(0, mech ? 3 : 1.1, mech ? 9.5 : 2.3);
      this.camera.lookAt(0, mech ? 2.2 : 0.35, 0);
    });
  }

  render(dt: number): void {
    this.turntable.rotation.y += dt * 0.8;
    this.renderer.render(this.scene, this.camera);
  }
}

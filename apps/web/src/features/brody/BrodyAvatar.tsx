import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/** Local CC0 asset. Rendering pauses offscreen; reduced motion is respected. */
export default function BrodyAvatar() {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true }); }
    catch { setFailed(true); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    renderer.setSize(144, 144);
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    camera.position.set(2.5, 1.5, 4);
    camera.lookAt(0, 0.9, 0);
    scene.add(new THREE.HemisphereLight(0xffffff, 0x6b7868, 2.5));
    const light = new THREE.DirectionalLight(0xffffff, 3);
    light.position.set(3, 5, 4); scene.add(light);
    let disposed = false, visible = true, model: THREE.Group | undefined, mixer: THREE.AnimationMixer | undefined;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const clock = new THREE.Clock();
    const disposeModel = (object: THREE.Object3D) => object.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
        for (const material of Array.isArray(child.material) ? child.material : [child.material]) {
          for (const value of Object.values(material)) if (value instanceof THREE.Texture) value.dispose();
          material.dispose();
        }
      }
    });
    new GLTFLoader().load('/models/brody/dino.glb', gltf => {
      if (disposed) { disposeModel(gltf.scene); return; }
      model = gltf.scene;
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const scale = 2.3 / Math.max(size.x, size.y, size.z);
      model.scale.setScalar(scale);
      model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
      scene.add(model);
      mixer = new THREE.AnimationMixer(model);
      const idle = gltf.animations.find(clip => clip.name.endsWith('|Idle'));
      if (idle) mixer.clipAction(idle).play();
      renderer.render(scene, camera);
    }, undefined, () => { if (!disposed) setFailed(true); });
    const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; });
    observer.observe(element);
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), 0.05);
      if (!visible || document.hidden || reduced.matches) return;
      mixer?.update(delta);
      renderer.render(scene, camera);
    });
    return () => {
      disposed = true; observer.disconnect(); renderer.setAnimationLoop(null);
      mixer?.stopAllAction(); if (model) { mixer?.uncacheRoot(model); disposeModel(model); }
      renderer.dispose(); renderer.domElement.remove();
    };
  }, []);
  return <div className="brody-avatar" ref={host} aria-hidden="true">{failed && <span className="brody-avatar-fallback">Brody</span>}</div>;
}

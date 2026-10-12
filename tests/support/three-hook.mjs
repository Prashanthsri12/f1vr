// Test-only module hook: resolve bare 'three' / 'three/addons/*' to a local three@0.160.0
// package so browser modules (import map in the app) can be unit-tested under Node.
// Usage: THREE_DIR=/path/to/three/package node --import ./tests/support/three-register.mjs --test
//        (get the package with: npm pack three@0.160.0 && tar -xzf three-0.160.0.tgz)
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const ROOT = process.env.THREE_DIR;

export async function resolve(spec, ctx, next) {
  if (ROOT && spec === 'three') return { url: pathToFileURL(join(ROOT, 'build/three.module.js')).href, shortCircuit: true };
  if (ROOT && spec.startsWith('three/addons/')) {
    return { url: pathToFileURL(join(ROOT, 'examples/jsm', spec.slice('three/addons/'.length))).href, shortCircuit: true };
  }
  return next(spec, ctx);
}

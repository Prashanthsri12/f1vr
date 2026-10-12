// Registers three-hook.mjs (see there). Tests that import three skip themselves without THREE_DIR.
import { register } from 'node:module';
register('./three-hook.mjs', import.meta.url);

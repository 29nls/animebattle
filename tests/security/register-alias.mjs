/**
 * Registrasi loader alias `@/` untuk integration test rute.
 * Dipisah dari loader-nya: `node --import` menuntut modul biasa.
 */
import { register } from 'node:module';

register('./alias-loader.mjs', import.meta.url);

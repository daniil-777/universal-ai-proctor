import { cp, mkdir } from "node:fs/promises";
const destination = new URL("../dist/media/fonts/", import.meta.url);
await mkdir(destination, { recursive: true });
await cp(new URL("../src/media/fonts/", import.meta.url), destination, { recursive: true });

#!/usr/bin/env node
import { register } from "node:module";

register("tsx/esm", import.meta.url);

const { default: start } = await import("../src/index.ts");
start();

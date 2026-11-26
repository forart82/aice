import { App } from "./app.js";

export function verifyAppBehavior(): number {
  const app = new App(2);
  const res = app.inc(3);
  return res.value + app.reset();
}

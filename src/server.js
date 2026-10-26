import { createApp } from "./app.js";

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
createApp().listen(port, "127.0.0.1", () => console.log(`link shortener listening on http://127.0.0.1:${port}`));

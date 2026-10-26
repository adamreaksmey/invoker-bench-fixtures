import { createApp } from "./app.js";

const DEFAULT_PORT = 3000;
const port = Number(process.env.PORT ?? DEFAULT_PORT);
const pagesDir = process.env.WIKI_PAGES_DIR ?? "pages";
createApp({ pagesDir }).listen(port, "127.0.0.1", () => console.log(`wiki listening on http://127.0.0.1:${port}`));

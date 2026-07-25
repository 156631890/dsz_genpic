import { config } from "dotenv";
import { createApp } from "./app.js";

config({ path: ".env.local" });
config();

const port = Number(process.env.PORT || 3001);
const app = createApp();

app.listen(port, "127.0.0.1", () => {
  console.log(`API server listening on http://127.0.0.1:${port}`);
});

import { app } from "./app";
import { env } from "./env";

app.listen(env.port, () => {
  console.log(`turn api listening on ${env.publicApiUrl} (port ${env.port})`);
});

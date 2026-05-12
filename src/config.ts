import { createMeshConfig } from "@baditaflorin/mesh-common";

export const config = createMeshConfig({
  appName: "mesh-eye-contact",
  description:
    "Two strangers held eye contact for N seconds — mutual face-detect mints an ephemeral 'we met' token",
  accentHex: "#eb4d4b",
  version: __APP_VERSION__,
  commit: __GIT_COMMIT__,
});

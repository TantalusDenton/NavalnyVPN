import { readFileSync } from "node:fs";
export function loadConfig(env = process.env) {
  const runtime = env.RUNTIME_CONFIG
    ? JSON.parse(readFileSync(env.RUNTIME_CONFIG, "utf8"))
    : {};
  const config = {
    production: env.NODE_ENV === "production",
    origin: env.APP_ORIGIN || runtime.origin || "http://localhost:5173",
    authMode: env.AUTH_MODE || runtime.authMode || "local",
    provisioner: env.PROVISIONER || runtime.provisioner || "disabled",
    dataDir: env.DATA_DIR || "./data",
    cognito: runtime.cognito,
    artifactBucket: runtime.artifactBucket,
    artifactRegion: runtime.artifactRegion || "us-east-1",
    regions: runtime.regions || [
      {
        id: "eu-central-1",
        name: "Frankfurt",
        country: "Germany",
        code: "DE",
        continent: "Europe",
      },
      {
        id: "us-east-1",
        name: "Virginia",
        country: "United States",
        code: "US",
        continent: "North America",
      },
      {
        id: "ap-southeast-1",
        name: "Singapore",
        country: "Singapore",
        code: "SG",
        continent: "Asia Pacific",
      },
    ],
  };
  if (
    !["local", "cognito"].includes(config.authMode) ||
    !["disabled", "aws"].includes(config.provisioner)
  )
    throw new Error("Invalid auth or provisioner mode");
  if (
    config.production &&
    (config.authMode !== "cognito" || !config.origin.startsWith("https://"))
  )
    throw new Error("Production requires Cognito and an HTTPS origin");
  if (config.authMode === "cognito" && !config.cognito)
    throw new Error("Missing Cognito configuration");
  if (
    config.provisioner === "aws" &&
    (!config.artifactBucket ||
      !config.regions.every((r) => r.instanceId && r.documentName))
  )
    throw new Error("Incomplete AWS gateway configuration");
  return config;
}

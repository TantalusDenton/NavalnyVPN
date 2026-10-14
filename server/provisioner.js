import {
  SSMClient,
  SendCommandCommand,
  GetCommandInvocationCommand,
} from "@aws-sdk/client-ssm";
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";

export function awsProvisioner(config) {
  const clients = new Map(
    config.regions.map((r) => [
      r.id,
      new SSMClient({ region: r.id, maxAttempts: 3 }),
    ]),
  );
  const storage = new S3Client({
    region: config.artifactRegion,
    maxAttempts: 3,
  });
  return {
    async start(action, profile) {
      const region = config.regions.find((r) => r.id === profile.region);
      const response = await clients.get(region.id).send(
        new SendCommandCommand({
          InstanceIds: [region.instanceId],
          DocumentName: region.documentName,
          Parameters: { Action: [action], ProfileId: [profile.id] },
          TimeoutSeconds: 120,
          CloudWatchOutputConfig: { CloudWatchOutputEnabled: false },
        }),
      );
      return response.Command.CommandId;
    },
    async status(profile) {
      try {
        const region = config.regions.find((r) => r.id === profile.region);
        const result = await clients
          .get(region.id)
          .send(
            new GetCommandInvocationCommand({
              CommandId: profile.command_id,
              InstanceId: region.instanceId,
            }),
          );
        if (result.Status === "Success") return "success";
        if (
          ["Failed", "Cancelled", "TimedOut", "Cancelling"].includes(
            result.Status,
          )
        )
          return "failed";
        return "pending";
      } catch (error) {
        if (error.name === "InvocationDoesNotExist") return "pending";
        throw error;
      }
    },
    async download(profile) {
      const object = await storage.send(
        new GetObjectCommand({
          Bucket: config.artifactBucket,
          Key: `profiles/${profile.region}/${profile.id}.ovpn`,
        }),
      );
      return object.Body.transformToByteArray();
    },
    async removeArtifact(profile) {
      await storage.send(
        new DeleteObjectCommand({
          Bucket: config.artifactBucket,
          Key: `profiles/${profile.region}/${profile.id}.ovpn`,
        }),
      );
    },
  };
}

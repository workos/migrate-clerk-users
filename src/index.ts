import { WorkOS } from "@workos-inc/node";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Queue from "p-queue";

import { ndjsonStream } from "./ndjson-stream";
import { ClerkExportedUser } from "./clerk-exported-user";

dotenv.config();

const USE_LOCAL_API = (process.env.NODE_ENV ?? "").startsWith("dev");

const workos = new WorkOS(
  process.env.WORKOS_SECRET_KEY,
  USE_LOCAL_API
    ? {
        https: false,
        apiHostname: "localhost",
        port: 7000,
      }
    : {},
);

async function findOrCreateUser(
  exportedUser: ClerkExportedUser,
  processMultiEmail: boolean,
) {
  // Clerk formats multiple email addresses by separating them with a pipe character
  // We unfortunately have no way of knowing which email is the primary one, so we only use the first email
  // if explicitly told to
  const emailAddresses = exportedUser.email_addresses.split("|");
  const email = emailAddresses[0];

  if (emailAddresses.length > 1 && !processMultiEmail) {
    console.log(
      `Multiple email addresses found for ${exportedUser.id} and multi email processing is disabled, skipping.`,
    );
    return false;
  }

  try {
    const passwordOptions = exportedUser.password_digest
      ? {
          passwordHash: exportedUser.password_digest,
          passwordHashType: "bcrypt" as const,
        }
      : {};

    return await workos.userManagement.createUser({
      email,
      firstName: exportedUser.first_name ?? undefined,
      lastName: exportedUser.last_name ?? undefined,
      ...passwordOptions,
    });
  } catch {
    const matchingUsers = await workos.userManagement.listUsers({
      email: email.toLowerCase(),
    });
    if (matchingUsers.data.length === 1) {
      return matchingUsers.data[0];
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number,
  processMultiEmail: boolean,
): Promise<boolean> {
  const exportedUser = ClerkExportedUser.parse(line);

  const workOsUser = await findOrCreateUser(exportedUser, processMultiEmail);
  if (!workOsUser) {
    console.error(
      `(${recordNumber}) Could not find or create user ${exportedUser.id}`,
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk user ${exportedUser.id} as WorkOS user ${workOsUser.id}`,
  );

  return true;
}

const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const {
    userExport: userFilePath,
    cleanupTempDb,
    processMultiEmail,
  } = await yargs(hideBin(process.argv))
    .option("user-export", {
      type: "string",
      required: true,
      description:
        "Path to the user and password export received from Clerk support.",
    })
    .option("process-multi-email", {
      type: "boolean",
      default: false,
      description:
        "In the case of a user with multiple email addresses, whether to use the first email provided or to skip processing the user.",
    })
    .version(false)
    .parse();

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;

  try {
    for await (const line of ndjsonStream(userFilePath)) {
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      queue.add(async () => {
        const successful = await processLine(
          line,
          recordCount,
          processMultiEmail,
        );
        if (successful) {
          completedCount++;
        }
      });
      recordCount++;
    }

    await queue.onIdle();

    console.log(
      `Done importing. ${completedCount} of ${recordCount} user records imported.`,
    );
  } finally {
  }
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

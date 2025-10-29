import { WorkOS, RateLimitExceededException } from "@workos-inc/node";
import dotenv from "dotenv";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import Queue from "p-queue";

import { userExportStream } from "./user-export-stream";
import { ClerkExportedUser } from "./clerk-exported-user";
import { sleep } from "./sleep";
import { createLogger } from "./ui/logger";
import fs from "fs";
import path from "path";

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
    : {}
);

type EmailVerifiedMode = "never" | "always" | "from-csv";

function shouldMarkEmailVerified(
  exportedUser: ClerkExportedUser,
  mode: EmailVerifiedMode
): boolean {
  if (mode === "always") return true;
  if (mode === "from-csv") return exportedUser.primary_email_verified === true;
  return false;
}

async function findOrCreateUser(
  exportedUser: ClerkExportedUser,
  processMultiEmail: boolean,
  emailVerifiedMode: EmailVerifiedMode
) {
  // Clerk formats multiple email addresses by separating them with a pipe character
  // We unfortunately have no way of knowing which email is the primary one, so we only use the first email
  // if explicitly told to
  const emailAddresses = exportedUser.email_addresses.split("|");
  const email = emailAddresses[0];

  if (emailAddresses.length > 1 && !processMultiEmail) {
    console.log(
      `Multiple email addresses found for ${exportedUser.id} and multi email processing is disabled, skipping.`
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

    const created = await workos.userManagement.createUser({
      email,
      firstName: exportedUser.first_name ?? undefined,
      lastName: exportedUser.last_name ?? undefined,
      ...passwordOptions,
    });
    if (shouldMarkEmailVerified(exportedUser, emailVerifiedMode)) {
      try {
        await workos.userManagement.updateUser({
          userId: created.id,
          emailVerified: true,
        });
      } catch (verifyErr) {
        if (verifyErr instanceof RateLimitExceededException) throw verifyErr;
        console.warn(
          `Failed to mark email verified for created user ${
            created.id
          }: ${String(verifyErr)}`
        );
      }
    }
    return created;
  } catch (error) {
    if (error instanceof RateLimitExceededException) {
      throw error;
    }

    const matchingUsers = await workos.userManagement.listUsers({
      email: email.toLowerCase(),
    });
    if (matchingUsers.data.length === 1) {
      const existingUser = matchingUsers.data[0];
      if (exportedUser.password_digest) {
        try {
          // Update password for existing user if provided in export
          await workos.userManagement.updateUser({
            userId: existingUser.id,
            passwordHash: exportedUser.password_digest,
            passwordHashType: "bcrypt",
          });
        } catch (updateError) {
          if (updateError instanceof RateLimitExceededException) {
            throw updateError;
          }
          console.warn(
            `Failed to update password for existing user ${
              existingUser.id
            }: ${String(updateError)}`
          );
        }
      }
      if (shouldMarkEmailVerified(exportedUser, emailVerifiedMode)) {
        try {
          await workos.userManagement.updateUser({
            userId: existingUser.id,
            emailVerified: true,
          });
        } catch (verifyErr) {
          if (verifyErr instanceof RateLimitExceededException) throw verifyErr;
          console.warn(
            `Failed to mark email verified for existing user ${
              existingUser.id
            }: ${String(verifyErr)}`
          );
        }
      }
      return existingUser;
    }
  }
}

async function processLine(
  line: unknown,
  recordNumber: number,
  processMultiEmail: boolean,
  emailVerifiedMode: EmailVerifiedMode
): Promise<boolean> {
  const exportedUser = ClerkExportedUser.parse(line);

  const workOsUser = await findOrCreateUser(
    exportedUser,
    processMultiEmail,
    emailVerifiedMode
  );
  if (!workOsUser) {
    console.error(
      `(${recordNumber}) Could not find or create user ${exportedUser.id}`
    );
    return false;
  }

  console.log(
    `(${recordNumber}) Imported Clerk user ${exportedUser.id} as WorkOS user ${workOsUser.id}`
  );

  return true;
}

const DEFAULT_RETRY_AFTER = 10;
const MAX_CONCURRENT_USER_IMPORTS = 10;

async function main() {
  const {
    userExport: userFilePath,
    processMultiEmail,
    emailVerified: emailVerifiedMode,
    quiet,
    errorsOut: errorsOutPath,
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
    .option("email-verified", {
      type: "string",
      default: "never",
      choices: ["never", "always", "from-csv"],
      description:
        "Whether to mark the primary email as verified: never (default), always, or from-csv (only if primary appears in verified_email_addresses).",
    })
    .option("quiet", {
      type: "boolean",
      default: false,
      description: "Suppress non-error output.",
    })
    .option("errors-out", {
      type: "string",
      description:
        "Optional path to write a detailed error report (CSV if *.csv, otherwise JSON).",
    })
    .version(false)
    .parse();

  const queue = new Queue({ concurrency: MAX_CONCURRENT_USER_IMPORTS });

  let recordCount = 0;
  let completedCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  const failures: Array<{
    recordNumber: number;
    clerkUserId?: string;
    email?: string;
    errorMessage: string;
    timestamp: string;
  }> = [];

  const logger = createLogger({
    quiet,
    useColor: !process.env.NO_COLOR,
    isTTY: process.stdout.isTTY ?? false,
  });

  const startTime = Date.now();
  logger.logHeader(`Importing users from ${userFilePath}`);

  try {
    for await (const line of userExportStream(userFilePath)) {
      await queue.onSizeLessThan(MAX_CONCURRENT_USER_IMPORTS);

      const recordNumber = recordCount + 1;
      recordCount++;
      const enqueueTask = () =>
        queue
          .add(async () => {
            logger.logStepStart(`Processing record #${recordNumber}`);
            let preview: ClerkExportedUser | null = null;
            try {
              preview = ClerkExportedUser.parse(line);
            } catch (zerr) {
              errorCount++;
              logger.logStepFail(`Failed record #${recordNumber}`);
              failures.push({
                recordNumber,
                clerkUserId: undefined,
                email: undefined,
                errorMessage: String(zerr),
                timestamp: new Date().toISOString(),
              });
              return;
            }

            const successful = await processLine(
              line,
              recordNumber,
              processMultiEmail,
              emailVerifiedMode as EmailVerifiedMode
            );
            if (successful) {
              completedCount++;
              logger.logStepSuccess(`Imported record #${recordNumber}`);
            } else {
              errorCount++;
              logger.logStepFail(`Failed record #${recordNumber}`);
              failures.push({
                recordNumber,
                clerkUserId: preview?.id,
                email: preview
                  ? preview.email_addresses.split("|")[0]
                  : undefined,
                errorMessage: "Could not find or create user",
                timestamp: new Date().toISOString(),
              });
            }
          })
          .catch(async (error: unknown) => {
            if (!(error instanceof RateLimitExceededException)) {
              errorCount++;
              logger.logError(String(error));
              // Best-effort preview to capture ID for the failure record
              let previewId: string | undefined;
              try {
                const p = ClerkExportedUser.parse(line);
                previewId = p.id;
              } catch (_) {}
              failures.push({
                recordNumber,
                clerkUserId: previewId,
                email: undefined,
                errorMessage: String(error),
                timestamp: new Date().toISOString(),
              });
              throw error;
            }

            const retryAfter = (error.retryAfter ?? DEFAULT_RETRY_AFTER) + 1;
            warningCount++;
            logger.logWarn(
              `Rate limit exceeded. Pausing queue for ${retryAfter} seconds.`
            );

            queue.pause();
            enqueueTask();

            await sleep(retryAfter * 1000);

            queue.start();
          });
      enqueueTask();
    }

    await queue.onIdle();

    const status =
      errorCount === 0 ? "Success" : completedCount > 0 ? "Partial" : "Failed";
    const durationMs = Date.now() - startTime;
    logger.printSummaryBox({
      status: status as "Success" | "Partial" | "Failed",
      durationMs,
      warnings: warningCount,
      errors: errorCount,
      imported: completedCount,
      total: recordCount,
    });

    if (errorCount > 0) {
      const failedIds = failures
        .map((f) => f.clerkUserId)
        .filter((v): v is string => Boolean(v));
      const sample = failedIds.slice(0, 5);
      if (sample.length > 0) {
        logger.logWarn(
          `Failed Clerk user ids (first ${sample.length}): ${sample.join(", ")}`
        );
      }
      if (errorsOutPath) {
        const ext = path.extname(errorsOutPath).toLowerCase();
        try {
          if (ext === ".csv") {
            const header = [
              "recordNumber",
              "clerkUserId",
              "email",
              "errorMessage",
              "timestamp",
            ].join(",");

            function escapeCsvField(field: unknown): string {
              const str = String(field ?? "");
              const escaped = str.replace(/"/g, '""');
              return `"${escaped}"`;
            }

            const rows = failures.map((f) =>
              [
                escapeCsvField(f.recordNumber),
                escapeCsvField(f.clerkUserId ?? ""),
                escapeCsvField(f.email ?? ""),
                escapeCsvField(f.errorMessage ?? ""),
                escapeCsvField(f.timestamp),
              ].join(",")
            );
            fs.writeFileSync(errorsOutPath, [header, ...rows].join("\n"), {
              encoding: "utf8",
            });
          } else {
            fs.writeFileSync(errorsOutPath, JSON.stringify(failures, null, 2));
          }
          logger.logInfo(`Wrote error report to ${errorsOutPath}`);
        } catch (writeErr) {
          logger.logError(`Failed to write error report: ${String(writeErr)}`);
        }
      }
    }
  } finally {
  }
}

export default function start() {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

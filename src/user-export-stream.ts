import fs from "fs";
import path from "path";
import { PassThrough } from "stream";
import { JSONParser } from "@streamparser/json";
import { parse as csvParse } from "csv-parse";
import { ClerkExportedUser } from "./clerk-exported-user";

function toNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  return s === "" ? null : s;
}

function splitList(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  const s = String(value).trim();
  if (s === "") return [];
  return s
    .split(/[|,;]\s*/)
    .map((v) => v.trim())
    .filter(Boolean);
}

function mergeEmails(
  primary: unknown,
  verified: unknown,
  unverified: unknown
): string {
  const emails: string[] = [];
  const seen = new Set<string>();
  const add = (arr: string[]) => {
    for (const e of arr) {
      const key = e.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        emails.push(e);
      }
    }
  };
  add(splitList(primary));
  add(splitList(verified));
  add(splitList(unverified));
  return emails.join("|");
}

function mapCsvRowToUser(row: Record<string, unknown>): ClerkExportedUser {
  const email_addresses = mergeEmails(
    row.primary_email_address,
    row.verified_email_addresses,
    row.unverified_email_addresses
  );

  const primary = toNull(row.primary_email_address)?.toLowerCase() ?? null;
  const verifiedSet = new Set(
    splitList(row.verified_email_addresses).map((e) => e.toLowerCase())
  );
  const primary_email_verified = primary ? verifiedSet.has(primary) : undefined;

  return {
    id: String(row.id ?? ""),
    first_name: toNull(row.first_name),
    last_name: toNull(row.last_name),
    username: toNull(row.username),
    email_addresses,
    phone_numbers: null, // importer ignores phones; keep null for parity
    totp_secret: toNull(row.totp_secret),
    password_digest: toNull(row.password_digest),
    password_hasher: toNull(row.password_hasher),
    primary_email_verified,
    unsafe_metadata: {},
    public_metadata: {},
    private_metadata: {},
  };
}

export async function* userExportStream(
  filePath: string
): AsyncIterable<unknown> {
  const ext = path.extname(filePath).toLowerCase();

  if (ext === ".csv") {
    const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
    const parser = fileStream.pipe(
      csvParse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
      })
    );

    for await (const record of parser) {
      // Map Clerk CSV schema to expected JSON object
      yield mapCsvRowToUser(record as Record<string, unknown>);
    }
    return;
  }

  // Default: treat as JSON array stream (existing behavior)
  const fileStream = fs.createReadStream(filePath, { encoding: "utf8" });
  const jsonParser = new JSONParser();
  const passThrough = new PassThrough();

  const queue: unknown[] = [];
  let deferredResolve: ((value?: unknown) => void) | null = null;
  let done = false;

  fileStream.on("error", (err) => passThrough.emit("error", err));
  passThrough.on("error", () => {
    // Wake any waiter to surface the error path
    if (deferredResolve) {
      deferredResolve();
      deferredResolve = null;
    }
  });

  jsonParser.onValue = ({ value, key }) => {
    if (!Number.isNaN(parseInt(key as string, 10))) {
      queue.push(value);
      if (deferredResolve) {
        deferredResolve();
        deferredResolve = null;
      }
    }
  };

  fileStream.pipe(passThrough);
  passThrough.on("data", (chunk) => {
    jsonParser.write(chunk);
  });
  passThrough.on("end", () => {
    done = true;
    if (deferredResolve) {
      deferredResolve();
      deferredResolve = null;
    }
  });

  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
      continue;
    }
    if (done) {
      break;
    }
    await new Promise((resolve) => {
      deferredResolve = resolve;
    });
  }
}

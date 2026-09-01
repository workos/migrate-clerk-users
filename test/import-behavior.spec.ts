import { describe, it, expect, vi, beforeEach } from "vitest";

const { createUser, updateUser, listUsers } = vi.hoisted(() => ({
  createUser: vi.fn(),
  updateUser: vi.fn(),
  listUsers: vi.fn(),
}));

vi.mock("@workos-inc/node", () => {
  class RateLimitExceededException extends Error {
    retryAfter = 1;
  }
  class WorkOS {
    userManagement = { createUser, updateUser, listUsers };
  }
  return { WorkOS, RateLimitExceededException };
});

import { findOrCreateUser } from "../src/index";
import { mapCsvRowToUser } from "../src/user-export-stream";

const BCRYPT_HASH =
  "$2a$10$30AaCxkcMPnz1NbSdgdOGu0d8FTN4kWIs8bIoMmLBrhLaZ1DIrg2W";

function csvRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user_1",
    first_name: "A",
    last_name: "B",
    username: "",
    primary_email_address: "",
    primary_phone_number: "",
    verified_email_addresses: "",
    unverified_email_addresses: "",
    verified_phone_numbers: "",
    unverified_phone_numbers: "",
    totp_secret: "",
    password_digest: "",
    password_hasher: "",
    ...overrides,
  };
}

beforeEach(() => {
  createUser.mockReset();
  updateUser.mockReset();
  listUsers.mockReset();
});

describe("mapCsvRowToUser", () => {
  it("does not include unverified email addresses in the identity field by default", () => {
    const user = mapCsvRowToUser(
      csvRow({
        primary_phone_number: "+15550001111",
        unverified_email_addresses: "someone-else@corp.com",
        password_digest: BCRYPT_HASH,
        password_hasher: "bcrypt",
      })
    );

    expect(user.email_addresses).not.toContain("someone-else@corp.com");
  });

  it("keeps primary and verified email addresses in the identity field", () => {
    const user = mapCsvRowToUser(
      csvRow({
        primary_email_address: "owner@corp.com",
        verified_email_addresses: "owner@corp.com|second@corp.com",
        unverified_email_addresses: "extra@corp.com",
      })
    );

    expect(user.email_addresses.split("|")).toEqual([
      "owner@corp.com",
      "second@corp.com",
    ]);
  });
});

describe("findOrCreateUser", () => {
  const exportedUser = {
    id: "user_1",
    first_name: "A",
    last_name: "B",
    username: null,
    email_addresses: "existing@corp.com",
    phone_numbers: null,
    totp_secret: null,
    password_digest: BCRYPT_HASH,
    password_hasher: "bcrypt",
    unsafe_metadata: {},
    public_metadata: {},
    private_metadata: {},
  };

  it("does not overwrite an existing user's password when creation fails", async () => {
    createUser.mockRejectedValue(new Error("email_not_available"));
    listUsers.mockResolvedValue({ data: [{ id: "user_existing" }] });

    const result = await findOrCreateUser(exportedUser, false, "never");

    expect(result).toEqual({ id: "user_existing" });
    expect(updateUser).not.toHaveBeenCalledWith(
      expect.objectContaining({ passwordHash: expect.anything() })
    );
  });
});

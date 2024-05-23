import { z } from 'zod';

export const ClerkExportedUser = z.object({
  id: z.string(),
  first_name: z.string().nullish(),
  last_name: z.string().nullish(),
  username: z.string().nullish(),
  email_addresses: z.string(),
  phone_numbers: z.string().nullish(),
  totp_secret: z.string().nullish(),
  password_digest: z.string().nullish(),
  password_hasher: z.string().nullish(),
  unsafe_metadata: z.optional(z.record(z.string(), z.unknown())),
  public_metadata: z.optional(z.record(z.string(), z.unknown())),
  private_metadata: z.optional(z.record(z.string(), z.unknown())),
});

export type ClerkExportedUser = z.infer<typeof ClerkExportedUser>;
